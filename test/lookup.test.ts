// Coverage for /lookup — the page that hands out URL schemes nobody has tested,
// and, since /probe merged into it, the page that tries them too.
//
// The tests that matter here are not the rendering ones. They are:
//
//   - nothing in the shipped table may claim to be verified, and every listed
//     line must carry a source link. This project's two worst bugs were both an
//     unverified string being read as an answer; a table that can quietly grow
//     a `verified` row would reintroduce that at scale. The tier assertions go
//     through `class="sig verified"` rather than through the words next to it:
//     the legend names all three tiers on every render, so a page-wide search
//     for a tier's label can no longer tell you what a row claims.
//   - exactly one jump, and it must be the mechanism the breathing page uses.
//     A jump that works here but not there would certify schemes that fail in
//     the only place it counts, and it would look fine in every other test.
//     This used to be a byte comparison against /probe's copy of the function;
//     with one page there is one copy, so the guard became "no other navigation
//     exists on the page" — which is what the two-page comparison was really
//     protecting.
//   - everything /probe could do still happens here: a button per configured
//     app, a box for a string that is saved nowhere, and an id per app so an old
//     /probe#app-xhs bookmark still lands on the right card.
//   - writing a candidate into user_apps must not disturb the numbers a user
//     chose, and must never repoint an unrelated app.
//   - the App Store lookup is best-effort. When it is down the page still
//     renders and says so; it never invents a scheme instead.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleLookup } from '../src/ui/lookup'
import { renderBreathe } from '../src/ui/breathe'
import { getUserApp, listUserApps, upsertUserApp } from '../src/db'
import { safeScheme } from '../src/scheme'
import { APPS, deriveFromBundleId, findApps, suggestKey } from '../src/schemes'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: Date.now() }

async function reset(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_apps'), env.DB.prepare('DELETE FROM users')])
  await env.DB.prepare('INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, ?1, ?2, 0, ?3)')
    .bind('张三', 'hash-lookup', Date.now())
    .run()
}
beforeEach(reset)

/** A fetch stand-in, so no test in this file can reach itunes.apple.com. */
function stubFetch(handler: () => Promise<Response> | Response): typeof fetch {
  return (async () => await handler()) as unknown as typeof fetch
}

const itunes = (results: unknown[]): typeof fetch =>
  stubFetch(() => new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 }))

const NEVER_CALLED: typeof fetch = stubFetch(() => {
  throw new Error('the App Store must not be consulted for a name that is in the table')
})

async function get(path: string, fetchImpl: typeof fetch = NEVER_CALLED): Promise<Response> {
  return await handleLookup(new Request(`https://yixi.test${path}`), env, user, { fetchImpl })
}

async function html(path: string, fetchImpl: typeof fetch = NEVER_CALLED): Promise<string> {
  return await (await get(path, fetchImpl)).text()
}

async function post(fields: Record<string, string>): Promise<Response> {
  return await handleLookup(
    new Request('https://yixi.test/lookup', { method: 'POST', body: new URLSearchParams(fields) }),
    env,
    user,
    { fetchImpl: NEVER_CALLED },
  )
}

/** The inline behaviour script (the one without a type attribute). */
function scriptOf(page: string): string {
  const m = page.match(/<script>([\s\S]*?)<\/script>/)
  expect(m, 'inline script missing').toBeTruthy()
  return m![1]!
}

/** The JSON island the inline script jumps from. */
function islandOf(page: string): string[] {
  const m = page.match(/<script type="application\/json" id="lookup-data">([\s\S]*?)<\/script>/)
  expect(m, 'jump island missing').toBeTruthy()
  return JSON.parse(m![1]!) as string[]
}

/**
 * Strips comments so assertions about the code are about the code. Same helper
 * as breathe.test.ts: this file's scripts carry comments containing the very
 * words being searched for, and a naive match would go green on the bug.
 * The `[^:]` guard keeps `https://` from reading as a line comment.
 */
function codeOnly(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
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
    // This guard used to forbid the tier outright, because at the time nothing
    // had been tested on a device and an unearned 「实测跳通过」 label is worse
    // than no label. Now that some entries are earned, the guard's job changes:
    // stop the tier from becoming a louder `listed`. A claim that cannot say
    // when it was observed, and on what, is not evidence.
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

describe('GET /lookup', () => {
  it('renders the search box and the "these are only candidates" warning', async () => {
    const page = await html('/lookup')
    expect(page).toContain('action="/lookup"')
    expect(page).toContain('name="q"')
    // The warning is now one visible line plus a fold. Both halves must exist:
    // the claim, and the reason it is not safe to skip the try.
    expect(page).toContain('没验证过')
    expect(page).toContain('猜错不会报错')
    expect(page).toContain('候选') // the nav tab
    expect(page).not.toContain('data-i=') // no candidate and no app yet
  })

  it('carries both halves of the merged page even with nothing configured', async () => {
    const page = await html('/lookup')
    // 找字符串
    expect(page).toContain('id="q"')
    // 试字符串 — the hand-typed box is not gated on having any app saved, which
    // is the case /probe existed for: a string copied off a forum, tried before
    // it is written anywhere.
    expect(page).toContain('id="manual"')
    expect(page).toContain('id="manual-go"')
    expect(page).toContain('还没有配置任何 App')
  })

  it('lists candidates with their tier and their source link', async () => {
    const page = await html('/lookup?q=起点')
    expect(page).toContain('起点读书')
    expect(page).toContain('QDReader://')
    expect(page).toContain('m.qidian.QDReaderAppStore')
    // The tier is a mark on the row, not a sentence in it.
    expect(page).toContain('class="sig verified"')
    expect(page).toContain('跳通过')
    // promotion does not erase provenance — a reader can still see where the
    // string was transcribed from before anyone put it on a phone
    expect(page).toContain('https://github.com/WengYuehTing/iOS-app-info')
    expect(page).toContain('iOS-app-info')
  })

  it('shows when and on what a verified candidate was observed', async () => {
    const page = await html('/lookup?q=起点')
    // Assert the elements the verification actually adds, not a bare date: the
    // first version of this test looked for '2026-08-31' and passed while the
    // UI rendered no evidence at all, because SNAPSHOT_DATE happened to be the
    // same day. A page-wide substring search is not a rendering assertion.
    expect(page).toMatch(/<span class="mk when">[\s\S]{0,400}?\d{4}-\d{2}-\d{2}\s*<\/span>/)
    expect(page).toMatch(/<p class="evidence">[^<]*iPhone[^<]*<\/p>/)
  })

  it('shows both sides when the two collections disagree', async () => {
    const page = await html('/lookup?q=快手')
    expect(page).toContain('kwai://')
    expect(page).toContain('gifshow://')
    expect(page).toContain('两份清单在这个 App 上不一致')
    expect(page).toContain('https://github.com/lu2412/iOS-URL-Scheme')
  })

  it('marks a candidate both collections agree on, without upgrading its tier', async () => {
    const page = await html('/lookup?q=微博')
    expect(page).toContain('sinaweibo://')
    expect(page).toContain('两份清单一致')
    expect(page).toContain('class="sig listed"')
    expect(page).not.toContain('class="sig verified"')
  })

  it('explains the three tiers once per page instead of once per row', async () => {
    const page = await html('/lookup?q=微博')
    // The gloss used to be repeated inside every pill. One legend, and the rows
    // carry a seal plus two or three characters.
    expect(page).toContain('class="tiers"')
    expect(page).toContain('清单里抄来的，可能已经失效')
    expect(page).toContain('照 bundle id 硬推的，跳不通是常态')
    // Said once. Two occurrences would mean the legend came back per card.
    expect(page.split('清单里抄来的，可能已经失效').length - 1).toBe(1)
  })

  it('offers a 试一下 button and a 就用这个 form per candidate, island in order', async () => {
    const page = await html('/lookup?q=爱奇艺')
    expect(page).toContain('data-i="0"')
    expect(page).toContain('data-i="1"')
    expect(islandOf(page)).toEqual(['iqiyi://', 'qiyi-iphone://'])
    expect(page).toContain('name="op" value="use"')
    // The ordinals are the ordering rule — 试跳 first, 存进 only after the phone
    // really jumped — moved out of a paragraph and into the buttons that obey
    // it. Losing them loses the rule, so they are asserted, and in order.
    expect(page).toContain('试跳「爱奇艺」')
    expect(page).toContain('跳通了 · 存进')
    const tryAt = page.indexOf('试跳「爱奇艺」')
    const saveAt = page.indexOf('跳通了 · 存进')
    expect(tryAt).toBeGreaterThan(-1)
    expect(saveAt).toBeGreaterThan(tryAt)
    expect(page).toMatch(/<span class="ord">1<\/span>/)
    expect(page).toMatch(/<span class="ord">2<\/span>/)
  })

  it('flags a candidate the user already wrote down, still as unverified', async () => {
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'weibo',
      label: '微博',
      scheme: 'sinaweibo://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
    // Deliberately an app nobody has put on a phone yet: writing a string into
    // your own config is not evidence that the phone answers to it, and the tier
    // must not drift upwards just because someone saved it.
    const page = await html('/lookup?q=微博')
    expect(page).toContain('已写进 weibo')
    expect(page).toContain('class="sig listed"')
    expect(page).not.toContain('class="sig verified"')
  })

  it('escapes whatever the user typed', async () => {
    const page = await html('/lookup?q=' + encodeURIComponent('<script>alert(1)</script>'), itunes([]))
    expect(page).not.toContain('<script>alert(1)</script>')
    expect(page).toContain('&lt;script&gt;')
  })

  it('405s on PUT', async () => {
    const res = await handleLookup(
      new Request('https://yixi.test/lookup', { method: 'PUT' }),
      env,
      user,
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, POST')
  })
})

describe('the jump mechanism', () => {
  it('never awaits anything before assigning location.href', async () => {
    const code = codeOnly(scriptOf(await html('/lookup?q=小红书')))
    const at = code.indexOf('location.href')
    expect(at).toBeGreaterThan(-1)
    // Not just "nothing before the jump" — an await anywhere in this handler
    // chain moves the navigation off the gesture stack and Safari drops it.
    expect(code).not.toContain('await')
    expect(code).not.toContain('fetch(')
    expect(code).not.toContain('setTimeout')
    expect(code).toContain("addEventListener('click'")
  })

  it('routes every jumpable thing on the page through one jump()', async () => {
    // /probe used to hold a second copy of this function, and a test compared
    // the two byte for byte. The copies are gone; what is left to protect is
    // that the candidates, the configured apps and the hand-typed box did not
    // each grow their own navigation. One assignment to location.href on the
    // whole page is the strongest form of that.
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
    const code = codeOnly(scriptOf(await html('/lookup?q=小红书')))

    expect(code.match(/function jump\(scheme\)/g)).toHaveLength(1)
    expect(code.match(/location\.href/g)).toHaveLength(1)
    expect(code).toContain('location.href = scheme;')
    // Everything that can jump goes through it.
    expect(code).toContain("querySelectorAll('button[data-i]')")
    expect(code).toContain('jump(v)')
  })

  it('jumps the way the breathing page jumps', async () => {
    // The whole worth of trying a scheme here is that it exercises the exact
    // mechanism 「继续」 uses. Safari only opens a custom scheme from inside the
    // synchronous call stack of a real gesture: a bare assignment to
    // location.href in a click handler, with nothing awaited on the way to it.
    // An <a href>, a setTimeout, or a promise chain is a different mechanism
    // and would certify schemes that then fail where it counts.
    const grab = (js: string): string => {
      const m = codeOnly(js).match(/location\.href\s*=\s*[A-Za-z]+;/)
      expect(m, 'no synchronous assignment to location.href').toBeTruthy()
      return m![0].replace(/\s+/g, '')
    }

    const sid = crypto.randomUUID().replace(/-/g, '')
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
    await env.DB.prepare(
      'INSERT INTO sessions (sid, user_id, app, created_at, resolved_at) VALUES (?1, 1, ?2, ?3, NULL)',
    )
      .bind(sid, 'xhs', Date.now())
      .run()

    const breathe = await (await renderBreathe(new Request(`https://yixi.test/b?s=${sid}`), env)).text()

    // Same statement, same shape, only the name of the variable holding the
    // scheme differs.
    expect(grab(scriptOf(await html('/lookup?q=小红书')))).toBe('location.href=scheme;')
    expect(grab(scriptOf(breathe))).toBe('location.href=SCHEME;')
  })
})

describe('the probe region — everything /probe used to be', () => {
  const app = (over: Partial<Parameters<typeof upsertUserApp>[1]> = {}): Promise<void> =>
    upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
      ...over,
    })

  it('gives every configured app a button and an id, disabled ones included', async () => {
    await app()
    await app({ app: 'dy', label: '抖音', scheme: 'dyscheme://', enabled: 0 })

    const page = await html('/lookup')
    expect(page).toContain('id="app-xhs"')
    expect(page).toContain('id="app-dy"')
    // Hiding a disabled row would leave the reader wondering why nothing fires.
    expect(page).toContain('已停用')
    expect(page).toContain('data-i="0"')
    expect(page).toContain('data-i="1"')
    // island order matches button order (listUserApps orders by app: dy, xhs)
    expect(islandOf(page)).toEqual(['dyscheme://', 'xhsdiscover://'])
    expect(page).toContain('href="/settings#app-xhs"')
  })

  it('numbers the two regions from one island, candidates first', async () => {
    // The indices are positional, and the candidate rows render before the app
    // cards. Get this wrong and a button jumps to somebody else's scheme —
    // silently, because every string here is a plausible one.
    await app()
    const page = await html('/lookup?q=爱奇艺')
    expect(islandOf(page)).toEqual(['iqiyi://', 'qiyi-iphone://', 'xhsdiscover://'])
    expect(page).toContain('data-i="2"')
  })

  it('escapes a scheme containing a tag-closer in the JSON island', async () => {
    await app({ app: 'x', label: 'x', scheme: 'a://</script><img>' })
    const page = await html('/lookup')
    expect(page).not.toContain('</script><img>')
    expect(page).toContain('\\u003c/script')
  })

  it('keeps the "only a real jump counts" rule and the how-to-read-it list', async () => {
    await app()
    const page = await html('/lookup')
    expect(page).toContain('iPhone 的 Safari 里')
    expect(page).toContain('跳得动才算数')
    expect(page).toContain('Safari 打不开该网页')
    expect(page).toContain('放弃拦截')
  })

  it('says what to do when nothing is configured rather than showing an empty list', async () => {
    const page = await html('/lookup')
    expect(page).toContain('没什么可试的')
    expect(page).toContain('/settings')
  })
})

describe('when the table has never heard of the name', () => {
  const term = '/lookup?q=foobarbaz'

  it('derives candidates off the bundle id and says they are guesses', async () => {
    const page = await html(
      term,
      itunes([{ trackName: '起点读书', bundleId: 'm.qidian.QDReaderAppStore' }]),
    )
    expect(page).toContain('表里没有「foobarbaz」')
    expect(page).toContain('下面全是<b>猜的</b>')
    expect(page).toContain('class="sig derived"')
    expect(page).toContain('大概不对')
    expect(page).toContain('m.qidian.QDReaderAppStore')
    expect(page).toContain('QDReader://')
    // The App Store never publishes a scheme; saying so is the whole point.
    expect(page).toContain('没有告诉任何人 URL scheme 是什么')
    expect(page).not.toContain('清单收录')
  })

  it('says so when the App Store has no such app, and invents nothing', async () => {
    const page = await html(term, itunes([]))
    expect(page).toContain('App Store 里也搜不到')
    expect(page).not.toContain('data-i=')
    expect(islandOf(page)).toEqual([])
  })

  it('survives the App Store throwing', async () => {
    const res = await get(
      term,
      stubFetch(() => {
        throw new Error('boom')
      }),
    )
    expect(res.status).toBe(200)
    const page = await res.text()
    expect(page).toContain('读不懂')
    expect(page).toContain('不会替你编一个 scheme 出来')
    // and it points at the box on this page rather than at the retired /probe
    expect(page).toContain('手输框')
    expect(islandOf(page)).toEqual([])
  })

  it('survives the App Store returning an error status or junk', async () => {
    const bad: typeof fetch[] = [
      stubFetch(() => new Response('nope', { status: 503 })),
      stubFetch(() => new Response('not json at all', { status: 200 })),
      stubFetch(() => new Response(JSON.stringify({ results: 'wat' }), { status: 200 })),
    ]
    // Each of these fails for a different reason and must say so. Collapsing
    // them into one message is what sent me hunting a timeout that never
    // happened: production was getting HTTP 403 from Apple, which refuses
    // datacenter egress, while a laptop on a home connection worked fine.
    const expected = ['拒绝了这次查询', '读不懂', '读不懂']
    for (let i = 0; i < bad.length; i++) {
      const res = await get(term, bad[i]!)
      expect(res.status).toBe(200)
      expect(await res.text(), `case ${i}`).toContain(expected[i]!)
    }
  })

  it('gives up on a timeout rather than hanging the page', async () => {
    const res = await handleLookup(new Request(`https://yixi.test${term}`), env, user, {
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
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('超时')
  })

  it('does not spend an outbound request on a one-character name', async () => {
    const page = await html('/lookup?q=' + encodeURIComponent('屮'), NEVER_CALLED)
    expect(page).toContain('没法去 App Store 核对')
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

describe('POST /lookup — 就用这个', () => {
  const useXhs = {
    op: 'use',
    q: '小红书',
    key: 'xhs',
    label: '小红书',
    scheme: 'xhsdiscover://',
  }

  it('writes a new row with the default wait and grace', async () => {
    const res = await post(useXhs)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/lookup?q=%E5%B0%8F%E7%BA%A2%E4%B9%A6&saved=xhs&mode=new')

    const rows = await listUserApps(env.DB, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
  })

  it('reports back what actually landed in the row', async () => {
    await post(useXhs)
    const page = await html('/lookup?q=小红书&saved=xhs&mode=new')
    expect(page).toContain('已把')
    expect(page).toContain('xhsdiscover://')
    // Used to send the reader to /probe; the card is on this page now.
    expect(page).toContain('href="#app-xhs"')
    expect(page).toContain('id="app-xhs"')
  })

  it('changes only the scheme of a row that already exists', async () => {
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '小红书',
      scheme: 'wrong://',
      wait_seconds: 25,
      grace_seconds: 300,
      enabled: 0,
    })
    const res = await post(useXhs)
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toContain('mode=update')

    const row = await getUserApp(env.DB, 1, 'xhs')
    expect(row).toMatchObject({
      scheme: 'xhsdiscover://',
      wait_seconds: 25,
      grace_seconds: 300,
      enabled: 0,
    })
  })

  it('refuses to repoint an app key that belongs to something else', async () => {
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '别的东西',
      scheme: 'other://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
    const res = await post(useXhs)
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('别的东西')
    // untouched
    expect((await getUserApp(env.DB, 1, 'xhs'))?.scheme).toBe('other://')
  })

  it('rejects a scheme that would execute rather than navigate', async () => {
    for (const scheme of ['javascript:alert(1)', 'data:text/html,x', 'about:blank', 'notascheme', '']) {
      const res = await post({ ...useXhs, scheme })
      expect(res.status, scheme).toBe(400)
      expect(await listUserApps(env.DB, 1)).toHaveLength(0)
    }
  })

  it('rejects a malformed app key, label or operation', async () => {
    const bad: Record<string, string>[] = [
      { ...useXhs, key: 'XHS' },
      { ...useXhs, key: '' },
      { ...useXhs, key: 'a'.repeat(33) },
      { ...useXhs, label: '' },
      { ...useXhs, label: 'x'.repeat(41) },
      { ...useXhs, op: 'delete' },
    ]
    for (const f of bad) {
      const res = await post(f)
      expect(res.status, JSON.stringify(f)).toBe(400)
      expect(await listUserApps(env.DB, 1)).toHaveLength(0)
    }
  })

  it('re-renders with the error rather than losing the search', async () => {
    const page = await (await post({ ...useXhs, scheme: 'javascript:alert(1)' })).text()
    expect(page).toContain('banner bad')
    expect(page).toContain('value="小红书"')
  })
})
