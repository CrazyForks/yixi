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
import { APPS, appForScheme, deriveFromBundleId, findApps, suggestKey } from '../src/schemes'
import type { User } from '../src/types'

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

  // appForScheme resolves a protocol to exactly one row and lets the first
  // writer win. That is only honest while no two rows claim the same protocol —
  // if a later snapshot introduces one, counting would silently file some
  // people's app under someone else's name, and this is where it surfaces.
  it('never lets two apps claim the same scheme', () => {
    const owner = new Map<string, string>()
    for (const a of APPS) {
      for (const c of a.candidates) {
        const proto = c.scheme.slice(0, c.scheme.indexOf(':')).toLowerCase()
        const held = owner.get(proto)
        expect(held ?? a.name, `${proto} is claimed by both ${held ?? ''} and ${a.name}`).toBe(a.name)
        owner.set(proto, a.name)
      }
    }
  })
})

describe('scheme -> app', () => {
  // The whole reason this lookup exists. Both keys are real rows in production:
  // one person typed `dy`, the next typed `douyin`, and counting by the key
  // reported 抖音 twice at 4 and 3 people instead of once at 7.
  it('lands two different app keys on one app when they share a scheme', () => {
    expect(appForScheme('snssdk1128://')?.name).toBe('抖音')
  })

  it('ignores case and a missing slash, because stored rows vary in both', () => {
    expect(appForScheme('qdreader://')?.name).toBe('起点读书')
    expect(appForScheme('QDReader:')?.name).toBe('起点读书')
    expect(appForScheme('  XHSDiscover://  ')?.name).toBe('小红书')
  })

  // `wechat://` is configured by someone in production and is in neither
  // collection. Resolving it to 微信 on the strength of the name looking right
  // would be a guess presented as an answer; undefined keeps the row separate
  // and therefore visible.
  it('returns undefined for a scheme no collection recorded', () => {
    expect(appForScheme('wechat://')).toBeUndefined()
    expect(appForScheme('firefox://')).toBeUndefined()
    expect(appForScheme('')).toBeUndefined()
  })

  it('resolves every scheme in the table back to the row that carries it', () => {
    for (const a of APPS) {
      for (const c of a.candidates) {
        expect(appForScheme(c.scheme)?.name, `${a.name} ${c.scheme}`).toBe(a.name)
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

/**
 * A caveat is the sentence that keeps a guess from being read as an answer, and
 * the picker on /settings renders it verbatim out of this JSON — so it is copy,
 * and it has to arrive in the language the rest of the page is in. Everything
 * else in the payload is data: schemes, bundle ids, source labels and the app
 * names a search matches against are the same bytes in both languages.
 */
describe('handleCandidates — the caveats follow the reader', () => {
  const QIDIAN = itunes([{ trackName: '起点读书', bundleId: 'm.qidian.QDReaderAppStore' }])

  const signedIn = (locale: string | null): User => ({
    id: 1,
    name: 'Alex',
    is_owner: 0,
    created_at: 0,
    locale,
  })

  async function hits(
    q: string,
    o: { headers?: Record<string, string>; user?: User; fetchImpl?: typeof fetch } = {},
  ): Promise<SearchOut> {
    const res = await handleCandidates(
      new Request(`https://yixi.test/api/candidates?q=${encodeURIComponent(q)}`, {
        headers: o.headers ?? {},
      }),
      { fetchImpl: o.fetchImpl ?? NEVER_CALLED },
      o.user ?? null,
    )
    return (await res.json()) as SearchOut
  }

  function caveats(out: SearchOut): string[] {
    if (out.state !== 'table' && out.state !== 'derived') return []
    return out.hits.flatMap((h) => h.candidates.map((c) => c.caveat ?? ''))
  }

  function notes(out: SearchOut): string[] {
    if (out.state !== 'table' && out.state !== 'derived') return []
    return out.hits.flatMap((h) => h.candidates.map((c) => c.verifiedNote ?? ''))
  }

  it('answers a derived candidate in English when the browser asks in English', async () => {
    const out = await hits('foobarbaz', {
      headers: { 'accept-language': 'en-US,en;q=0.9' },
      fetchImpl: QIDIAN,
    })
    expect(out.state).toBe('derived')
    const all = caveats(out)
    expect(all.length).toBeGreaterThan(0)
    expect(all).toContain('The last segment of the bundle id, as it stands.')
    for (const c of all) expect(c, c).not.toMatch(/[一-鿿]/)
  })

  it('takes the language from the cookie the switcher wrote, and from the account', async () => {
    const viaCookie = caveats(
      await hits('foobarbaz', { headers: { cookie: 'yixi_lang=en' }, fetchImpl: QIDIAN }),
    )
    const viaAccount = caveats(await hits('foobarbaz', { user: signedIn('en'), fetchImpl: QIDIAN }))
    expect(viaCookie).toContain('The last segment of the bundle id, as it stands.')
    expect(viaAccount).toContain('The last segment of the bundle id, as it stands.')
  })

  it('leaves the Chinese exactly as the table writes it when nothing asks otherwise', async () => {
    // Byte for byte the source string, both for a guess and for a table row —
    // the Chinese answer must not move because English exists.
    expect(caveats(await hits('foobarbaz', { fetchImpl: QIDIAN }))).toContain('bundle id 的最后一段，原样。')
    expect(caveats(await hits('搜狐视频'))).toContain('两份清单不一致，差一个 -iphone 后缀。')
  })

  it('translates the caveat and nothing else about a table hit', async () => {
    const zh = await hits('搜狐视频')
    const en = await hits('搜狐视频', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    expect(en.state).toBe('table')
    expect(caveats(en)).toContain('The two collections disagree, by one -iphone suffix.')
    if (zh.state !== 'table' || en.state !== 'table') return
    // The app name, the key, the schemes and the source links are data.
    expect(en.hits.map((h) => h.name)).toEqual(zh.hits.map((h) => h.name))
    expect(en.hits.map((h) => h.key)).toEqual(zh.hits.map((h) => h.key))
    expect(en.hits.flatMap((h) => h.candidates.map((c) => c.scheme))).toEqual(
      zh.hits.flatMap((h) => h.candidates.map((c) => c.scheme)),
    )
    expect(en.hits.flatMap((h) => h.candidates.flatMap((c) => c.sources.map((x) => x.url)))).toEqual(
      zh.hits.flatMap((h) => h.candidates.flatMap((c) => c.sources.map((x) => x.url))),
    )
  })

  /**
   * `verifiedNote` sits directly above the caveat in the picker
   * (src/ui/schemefield.ts) and is the one line in the payload that records an
   * observation rather than a transcription — the sentence that says a real
   * phone made this jump. Leaving it Chinese under an English caveat is how a
   * reader ends up unable to tell which of two candidates was actually tried.
   */
  it('answers the verified note in the reader’s language too', async () => {
    const en = await hits('小红书', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    expect(en.state).toBe('table')
    const written = notes(en).filter((n) => n !== '')
    expect(written.length).toBeGreaterThan(0)
    expect(written).toContain(
      'Tapping “Open it anyway” on the breathing page jumped successfully, on the author’s iPhone',
    )
    for (const n of written) expect(n, n).not.toMatch(/[一-鿿]/)
    // The date beside it is a date, not copy.
    if (en.state === 'table') {
      expect(en.hits.flatMap((h) => h.candidates.map((c) => c.verifiedOn ?? ''))).toContain('2026-08-31')
    }
  })

  it('leaves the verified note in Chinese, byte for byte, when nothing asks otherwise', async () => {
    expect(notes(await hits('小红书'))).toContain('作者的 iPhone 上从呼吸页点「继续」跳转成功')
    expect(notes(await hits('起点读书'))).toContain('作者的 iPhone 上从呼吸页点「继续」跳转成功')
  })

  it('leaves the shared table untouched, so the next request does not inherit a language', async () => {
    await hits('搜狐视频', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    // Straight off the module-level constant, not through the endpoint.
    const sohu = APPS.find((a) => a.key === 'sohuvideo')
    expect(sohu?.candidates.map((c) => c.caveat)).toContain('两份清单不一致，差一个 -iphone 后缀。')

    await hits('小红书', { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    const xhs = APPS.find((a) => a.key === 'xhs')
    expect(xhs?.candidates.map((c) => c.verifiedNote)).toContain('作者的 iPhone 上从呼吸页点「继续」跳转成功')
  })
})
