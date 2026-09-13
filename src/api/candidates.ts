// GET /api/candidates?q=<app name> — the candidate list, as JSON.
//
// This is what /lookup used to be. That page was a destination: you had to know
// it existed, guess what 「候选」 meant, and go there BEFORE filling in the form
// that needed the answer — and if you went mid-form, the form was gone when you
// came back. The whole thing now renders inside the URL scheme field on
// /settings, which is the one place anybody ever wants it.
//
// It answers JSON rather than HTML on purpose. The page fetching it is already
// open and already holds the user's half-typed form; replacing it with a server
// render would throw that away, which is the failure being fixed.
//
// The App Store fallback moved here with it. Two things about it that cost real
// debugging time, kept verbatim from where it used to live:
//
//   - Apple refuses Cloudflare's egress addresses with HTTP 429. This path
//     therefore fails in production while working from a laptop, so `reason`
//     distinguishes refused / timeout / unreadable rather than collapsing them
//     into "unavailable" — collapsing them sent me chasing a timeout that never
//     happened.
//   - The timeout is detected by our own flag, not by the rejection's name.
//     Whether an aborted fetch rejects with something called AbortError is the
//     runtime's business; this only needs to know whether we gave up.
//
// Nothing here ever invents a scheme to fill a gap. A failed lookup says it
// failed. A `derived` candidate is labelled derived and carries the reasoning
// that produced it, because the reader is the one who has to decide whether to
// trust a guess assembled from a bundle id.

import type { Candidate, Confidence } from '../schemes'
import { deriveFromBundleId, findApps, isCorroborated, suggestKey } from '../schemes'
import type { User } from '../types'
import { localeOf, translator, type T } from '../i18n'

// --- wire format -----------------------------------------------------------

interface CandidateOut {
  scheme: string
  confidence: Confidence
  /** More than one independent transcription records this exact string. */
  corroborated: boolean
  sources: { label: string; url: string }[]
  caveat?: string
  verifiedOn?: string
  verifiedNote?: string
}

interface HitOut {
  name: string
  /** What /settings would accept as an app key, pre-filled for the reader. */
  key: string
  category?: string
  bundleId?: string
  candidates: CandidateOut[]
}

export type SearchOut =
  /** Found in the curated table. */
  | { state: 'table'; hits: HitOut[] }
  /**
   * Not in the table, but the App Store knows the app, so the candidates are
   * assembled from its bundle id. Every one of them is `derived`.
   */
  | { state: 'derived'; hits: HitOut[] }
  /** The App Store answered and has no such app. */
  | { state: 'unknown' }
  /** Nothing was asked. */
  | { state: 'idle' }
  /**
   * We could not check. Never conflated with 'unknown' — "Apple says no such
   * app" and "we could not reach Apple" call for different next steps, and only
   * one of them is a reason to stop looking.
   */
  | { state: 'unchecked'; reason: 'refused' | 'timeout' | 'unreadable' | 'too-short' }

function toOut(c: Candidate): CandidateOut {
  const out: CandidateOut = {
    scheme: c.scheme,
    confidence: c.confidence,
    corroborated: isCorroborated(c),
    sources: c.sources.map((s) => ({ label: s.label, url: s.url })),
  }
  if (c.caveat !== undefined) out.caveat = c.caveat
  if (c.verifiedOn !== undefined) out.verifiedOn = c.verifiedOn
  if (c.verifiedNote !== undefined) out.verifiedNote = c.verifiedNote
  return out
}

// --- App Store fallback ----------------------------------------------------

export interface CandidateDeps {
  fetchImpl?: typeof fetch
  /** How long to wait on the App Store before giving up and saying so. */
  timeoutMs?: number
}

interface StoreApp {
  name: string
  bundleId: string
}

type StoreResult =
  | { state: 'ok'; apps: StoreApp[] }
  | { state: 'empty' }
  | { state: 'unavailable'; why: 'refused' | 'timeout' | 'unreadable' }
  | { state: 'skipped' }

const DEFAULT_TIMEOUT_MS = 2500

async function searchAppStore(term: string, deps: CandidateDeps): Promise<StoreResult> {
  if (term.length < 2 || term.length > 40) return { state: 'skipped' }

  const f = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const url =
      'https://itunes.apple.com/search?term=' +
      encodeURIComponent(term) +
      '&country=cn&entity=software&limit=5'
    const res = await f(url, {
      // Repeat lookups of the same name are common and the answer changes
      // roughly never; one cached edge copy spares both sides the round trip.
      signal: controller.signal,
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
    if (!res.ok) return { state: 'unavailable', why: 'refused' }

    const body: unknown = await res.json()
    const results = (body as { results?: unknown }).results
    if (!Array.isArray(results)) return { state: 'unavailable', why: 'unreadable' }

    const apps: StoreApp[] = []
    for (const r of results) {
      if (typeof r !== 'object' || r === null) continue
      const rec = r as Record<string, unknown>
      const name = typeof rec.trackName === 'string' ? rec.trackName : ''
      const bundleId = typeof rec.bundleId === 'string' ? rec.bundleId : ''
      if (name === '' || bundleId === '') continue
      apps.push({ name, bundleId })
      if (apps.length >= 3) break
    }
    return apps.length === 0 ? { state: 'empty' } : { state: 'ok', apps }
  } catch {
    return timedOut
      ? { state: 'unavailable', why: 'timeout' }
      : { state: 'unavailable', why: 'unreadable' }
  } finally {
    clearTimeout(timer)
  }
}

// --- search ----------------------------------------------------------------

export async function searchCandidates(q: string, deps: CandidateDeps = {}): Promise<SearchOut> {
  const term = q.trim()
  if (term === '') return { state: 'idle' }

  const table = findApps(term, 4)
  if (table.length > 0) {
    return {
      state: 'table',
      hits: table.map((a) => {
        const hit: HitOut = {
          name: a.name,
          key: a.key,
          category: a.category,
          candidates: a.candidates.map(toOut),
        }
        if (a.bundleId !== undefined) hit.bundleId = a.bundleId
        return hit
      }),
    }
  }

  const store = await searchAppStore(term, deps)
  if (store.state === 'skipped') return { state: 'unchecked', reason: 'too-short' }
  if (store.state === 'unavailable') return { state: 'unchecked', reason: store.why }
  if (store.state === 'empty') return { state: 'unknown' }

  const hits: HitOut[] = []
  for (const app of store.apps) {
    const candidates = deriveFromBundleId(app.bundleId)
    if (candidates.length === 0) continue
    hits.push({
      name: app.name,
      key: suggestKey(app.bundleId, app.name),
      bundleId: app.bundleId,
      candidates: candidates.map(toOut),
    })
  }
  return hits.length === 0 ? { state: 'unknown' } : { state: 'derived', hits }
}

/**
 * The two parts of the answer that are copy rather than data: the caveat
 * arguing against a candidate, and the note recording what was actually
 * observed on a phone. Everything else — schemes, bundle ids, source labels,
 * dates, app names — is the same bytes in both languages.
 *
 * It happens here and not in `searchCandidates` for two reasons. The table in
 * src/schemes.ts is a module-level constant shared by every request an isolate
 * serves, so nothing may translate a `Candidate` in place; `toOut` has already
 * made a per-request copy by the time this runs, and it is that copy this
 * rewrites. And `searchCandidates` is what the tests assert the *table* through
 * — a function that answered in whatever language the last caller asked for
 * would make those assertions depend on a header.
 *
 * `t` on a string with no entry in the dictionary returns the string, so a
 * caveat somebody adds without translating it degrades to Chinese on an English
 * page rather than vanishing.
 */
function localiseCopy(out: SearchOut, t: T): SearchOut {
  if (out.state !== 'table' && out.state !== 'derived') return out
  const hits = out.hits.map((h) => ({
    ...h,
    candidates: h.candidates.map((c) => ({
      ...c,
      ...(c.caveat === undefined ? {} : { caveat: t(c.caveat) }),
      ...(c.verifiedNote === undefined ? {} : { verifiedNote: t(c.verifiedNote) }),
    })),
  }))
  return out.state === 'table' ? { state: 'table', hits } : { state: 'derived', hits }
}

// --- route -----------------------------------------------------------------

export async function handleCandidates(
  request: Request,
  deps: CandidateDeps = {},
  user: User | null = null,
): Promise<Response> {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  // 40 is /settings' own cap on a display name; a longer string is not a search,
  // and passing it on would put it in an outbound URL.
  const out = await searchCandidates(q.slice(0, 40), deps)
  return new Response(JSON.stringify(localiseCopy(out, translator(localeOf(request, user)))), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Authenticated route: the answer is not user-specific, but the request
      // carries a session cookie and must not land in a shared cache.
      'cache-control': 'private, max-age=300',
      // The copy (caveat, verifiedNote) follows the language, which the browser
      // cache cannot see in the URL: same query, switched language, five
      // minutes — without this the picker shows the previous language's text.
      vary: 'Accept-Language, Cookie',
    },
  })
}
