// The candidate table, and the JSON endpoint the /settings picker fetches.
//
// This file is test/lookup.test.ts minus the page that no longer exists. The
// rendering assertions went with it; the ones that mattered did not, because
// none of them were ever about the page:
//
//   - nothing in the shipped table may claim to be verified without evidence,
//     and every listed line must carry a source link. This project's two worst
//     bugs were both an unverified string being read as an answer; a table that
//     can quietly grow a `verified` row would reintroduce that at scale.
//   - the App Store lookup is best-effort. When it is down the caller still
//     gets an answer that says so, and it never invents a scheme instead. The
//     three failure causes stay distinguishable — collapsing them is what sent
//     me hunting a timeout that never happened, when production was actually
//     being refused by Apple for using Cloudflare's egress addresses.
//   - a derived candidate is labelled derived, carries no source, and says what
//     produced it.
//
// The jump — the one thing that can actually settle whether a scheme works —
// now lives in test/settings.test.ts with the field it belongs to.

import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleCandidates, searchCandidates, type SearchOut } from '../src/api/candidates'
import { safeScheme } from '../src/scheme'
import { APPS, deriveFromBundleId, findApps, suggestKey } from '../src/schemes'

/** A fetch stand-in, so no test in this file can reach itunes.apple.com. */
function stubFetch(handler: () => Promise<Response> | Response): typeof fetch {
  return (async () => await handler()) as unknown as typeof fetch
}

const itunes = (results: unknown[]): typeof fetch =>
  stubFetch(
    () => new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 }),
  )

const NEVER_CALLED: typeof fetch = stubFetch(() => {
  throw new Error('the App Store must not be consulted for a name that is in the table')
})

function search(q: string, fetchImpl: typeof fetch = NEVER_CALLED): Promise<SearchOut> {
  return searchCandidates(q, { fetchImpl })
}

// ---------------------------------------------------------------------------

describe('the table itself', () => {
  it('carries enough apps to be worth searching, with unique keys', () => {
    expect(APPS.length).toBeGreaterThanOrEqual(40)
    const keys = APPS.map((a) => a.key)
    expect(new Set(keys).size, 'duplicate app key would silently repoint a row').toBe(keys.length)
    for (const a of APPS) {
      expect(a.key, a.name).toMatch(/^[a-z0-9_-]{1,32}$/)
      expect(a.candidates.length, a.name).toBeGreaterThan(0)
    }
  })

  it('never guesses in the shipped table', () => {
    // `derived` means "invented here from a bundle id". That belongs to the live
    // App Store fallback, which labels it as a guess; a transcribed table must
    // not contain any.
    const derived = APPS.flatMap((a) => a.candidates.filter((c) => c.confidence === 'derived'))
    expect(derived).toEqual([])
  })

  it('makes every "verified" claim carry its evidence', () => {
    // The guard's job is to stop the tier from becoming a louder `listed`. A
    // claim that cannot say when it was observed, and on what, is not evidence.
    const claims = APPS.flatMap((a) =>
      a.candidates.filter((c) => c.confidence === 'verified').map((c) => ({ app: a.name, c })),
    )
    for (const { app, c } of claims) {
      expect(c.verifiedOn, `${app} ${c.scheme}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.verifiedNote?.length ?? 0, `${app} ${c.scheme}`).toBeGreaterThan(8)
      // Promotion does not erase where the string came from.
      expect(c.sources.length, `${app} ${c.scheme}`).toBeGreaterThan(0)
    }
  })

  it('gives every listed candidate a traceable source and a navigable scheme', () => {
    for (const a of APPS) {
      for (const c of a.candidates) {
        expect(c.sources.length, `${a.name} ${c.scheme}`).toBeGreaterThan(0)
        for (const s of c.sources) {
          expect(s.url).toMatch(/^https:\/\/github\.com\//)
          expect(s.label.length).toBeGreaterThan(0)
        }
        // Must survive the same gate the breathing page applies at the sink.
        expect(safeScheme(c.scheme), `${a.name} ${c.scheme}`).toBe(c.scheme)
      }
    }
  })
})

describe('fuzzy match', () => {
  it('finds an app by a fragment of its Chinese name', () => {
    const hit = findApps('起点')
    expect(hit[0]?.name).toBe('起点读书')
    expect(hit[0]?.candidates[0]?.scheme).toBe('QDReader://')
  })

  it('finds an app by alias, abbreviation and English spelling', () => {
    expect(findApps('xhs')[0]?.name).toBe('小红书')
    expect(findApps('b站')[0]?.name).toBe('哔哩哔哩')
    expect(findApps('bilibili')[0]?.name).toBe('哔哩哔哩')
    expect(findApps('kuaishou')[0]?.name).toBe('快手')
  })

  it('prefers the exact name over a longer one containing it', () => {
    expect(findApps('抖音')[0]?.name).toBe('抖音')
    expect(findApps('快手')[0]?.name).toBe('快手')
  })

  it('returns nothing for a name it has never heard of', () => {
    expect(findApps('foobarbaz')).toEqual([])
    expect(findApps('')).toEqual([])
  })
})

describe('searchCandidates — the table path', () => {
  it('answers from the table without touching the App Store', async () => {
    const out = await search('小红书')
    expect(out.state).toBe('table')
    if (out.state !== 'table') return
    expect(out.hits[0]?.name).toBe('小红书')
    expect(out.hits[0]?.key).toBe('xhs')
    expect(out.hits[0]?.candidates.some((c) => c.scheme === 'xhsdiscover://')).toBe(true)
  })

  it('carries the tier, the sources and the evidence through to the wire', async () => {
    const out = await search('起点')
    if (out.state !== 'table') throw new Error('expected a table hit')
    const c = out.hits[0]!.candidates.find((x) => x.scheme === 'QDReader://')
    expect(c).toBeTruthy()
    expect(c!.confidence).toBe('verified')
    // The picker renders these three; dropping any of them turns a weighable
    // claim back into an unlabelled string.
    expect(c!.verifiedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(c!.verifiedNote!.length).toBeGreaterThan(8)
    expect(c!.sources.length).toBeGreaterThan(0)
  })

  it('says whether both collections agree, without upgrading the tier for it', async () => {
    const out = await search('微博')
    if (out.state !== 'table') throw new Error('expected a table hit')
    const agreed = out.hits[0]!.candidates.filter((c) => c.corroborated)
    for (const c of agreed) {
      // Two transcriptions agreeing rules out one of them mistyping it. It is
      // still not evidence that any phone answers to the string.
      expect(c.confidence).not.toBe('verified')
    }
  })

  it('returns idle for an empty query rather than searching for nothing', async () => {
    expect((await search('')).state).toBe('idle')
    expect((await search('   ')).state).toBe('idle')
  })
})

describe('searchCandidates — the App Store fallback', () => {
  it('derives candidates off the bundle id and labels every one a guess', async () => {
    const out = await search(
      'foobarbaz',
      itunes([{ trackName: '起点读书', bundleId: 'm.qidian.QDReaderAppStore' }]),
    )
    expect(out.state).toBe('derived')
    if (out.state !== 'derived') return
    const hit = out.hits[0]!
    expect(hit.bundleId).toBe('m.qidian.QDReaderAppStore')
    expect(hit.candidates.map((c) => c.scheme)).toContain('QDReader://')
    for (const c of hit.candidates) {
      expect(c.confidence).toBe('derived')
      expect(c.sources).toEqual([])
      // The App Store never publishes a scheme. Every line here is assembled
      // from the bundle id, and each has to say what produced it.
      expect(c.caveat).toBeTruthy()
    }
  })

  it('says the app is unknown when the App Store has no such app, and invents nothing', async () => {
    expect((await search('foobarbaz', itunes([]))).state).toBe('unknown')
  })

  it('keeps the three failure causes apart', async () => {
    // Collapsing these into one "unavailable" is what sent me hunting a timeout
    // that never happened: production was being refused by Apple, which turns
    // away Cloudflare's egress addresses, while a laptop worked fine.
    const cases: Array<[typeof fetch, string]> = [
      [stubFetch(() => new Response('nope', { status: 503 })), 'refused'],
      [stubFetch(() => new Response('not json at all', { status: 200 })), 'unreadable'],
      [
        stubFetch(() => new Response(JSON.stringify({ results: 'wat' }), { status: 200 })),
        'unreadable',
      ],
      [
        stubFetch(() => {
          throw new Error('boom')
        }),
        'unreadable',
      ],
    ]
    for (const [impl, reason] of cases) {
      const out = await search('foobarbaz', impl)
      expect(out.state).toBe('unchecked')
      if (out.state === 'unchecked') expect(out.reason, reason).toBe(reason)
    }
  })

  it('gives up on a timeout, and calls it a timeout', async () => {
    const out = await searchCandidates('foobarbaz', {
      timeoutMs: 5,
      // Honours the signal, because a stub that ignores it is not simulating a
      // timeout — it is simulating a slow reply that fails for its own reasons,
      // which is a different branch.
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const t = setTimeout(() => reject(new Error('too slow')), 200)
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(t)
            reject(new Error('aborted by signal'))
          })
        })) as unknown as typeof fetch,
    })
    expect(out.state).toBe('unchecked')
    if (out.state === 'unchecked') expect(out.reason).toBe('timeout')
  })

  it('does not spend an outbound request on a one-character name', async () => {
    const out = await search('屮', NEVER_CALLED)
    expect(out.state).toBe('unchecked')
    if (out.state === 'unchecked') expect(out.reason).toBe('too-short')
  })
})

describe('derivation rules', () => {
  it('reduces a bundle id to the shapes that have actually been schemes', () => {
    const got = deriveFromBundleId('m.qidian.QDReaderAppStore').map((c) => c.scheme)
    expect(got).toContain('QDReader://')
    expect(got).toContain('qidian://')
    expect(got).toContain('m.qidian.QDReaderAppStore://')
    expect(deriveFromBundleId('com.zhihu.ios').map((c) => c.scheme)).toContain('zhihu://')
  })

  it('labels every derivation as a guess with no source behind it', () => {
    for (const c of deriveFromBundleId('com.example.SomethingApp')) {
      expect(c.confidence).toBe('derived')
      expect(c.sources).toEqual([])
      expect(c.caveat).toBeTruthy()
    }
  })

  it('drops segments that cannot legally be a scheme', () => {
    // A leading digit and an underscore are both illegal in a URL scheme, and
    // `javascript` must never come out of here whatever the bundle id says.
    const got = deriveFromBundleId('com.115.some_thing').map((c) => c.scheme)
    expect(got).not.toContain('115://')
    expect(got.some((s) => s.includes('_'))).toBe(false)
    expect(deriveFromBundleId('x.javascript').map((c) => c.scheme)).not.toContain('javascript://')
  })

  it('suggests an app key /settings would accept', () => {
    expect(suggestKey('m.qidian.QDReaderAppStore', 'x')).toBe('qdreader')
    expect(suggestKey('', 'Fallback Name')).toMatch(/^[a-z0-9_-]{1,32}$/)
  })
})

describe('GET /api/candidates', () => {
  async function get(q: string, fetchImpl: typeof fetch = NEVER_CALLED): Promise<Response> {
    return await handleCandidates(
      new Request(`https://yixi.test/api/candidates?q=${encodeURIComponent(q)}`),
      { fetchImpl },
    )
  }

  it('answers JSON the picker can render', async () => {
    const res = await get('小红书')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = (await res.json()) as SearchOut
    expect(body.state).toBe('table')
  })

  it('never lets a shared cache hold an answer fetched with a session cookie', async () => {
    const cc = (await get('小红书')).headers.get('cache-control') ?? ''
    expect(cc).toContain('private')
    expect(cc).not.toContain('public')
  })

  it('truncates an absurd query instead of putting it in an outbound URL', async () => {
    const res = await get('x'.repeat(500), NEVER_CALLED)
    // 40 is /settings' own cap on a display name. Past that it is not a search.
    expect(res.status).toBe(200)
    const body = (await res.json()) as SearchOut
    expect(body.state).toBe('unchecked')
  })

  it('treats a missing q as idle rather than as an error', async () => {
    const res = await handleCandidates(new Request('https://yixi.test/api/candidates'))
    expect(res.status).toBe(200)
    expect(((await res.json()) as SearchOut).state).toBe('idle')
  })
})
