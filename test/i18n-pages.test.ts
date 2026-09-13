// The pages rendered in English, end to end — the half of the i18n guard that
// test/i18n.test.ts cannot express. The 今日 face first, then the three pages
// somebody meets before they have an account or a nav: the breathing page,
// the landing page and /mock.
//
// i18n.test.ts checks the *dictionary*: every t()/msg() source has an EN key,
// the placeholder sets match, no Chinese leaks into a translation. All of
// that stays green even if a page forgets to build a translator at all and
// renders its Chinese verbatim. So this file renders the real handlers in
// English — by `Accept-Language: en`, or, on /b, by the account's own
// `locale`, which is all an iOS Shortcut carries — and asserts on the HTML
// that comes back: `<html lang="en">`, no Chinese punctuation left in the
// page's <main>, and the particular sentences the design names.
//
// The last describe is the other direction and matters just as much: the same
// requests with no language header at all must still be Chinese, byte for
// byte what they were before any of this existed.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderBreathe } from '../src/ui/breathe'
import { renderLanding } from '../src/ui/landing'
import { renderMock } from '../src/ui/mock'
import { handleToday } from '../src/ui/today'
import { handleGoals } from '../src/ui/goals'
import { renderProgress } from '../src/ui/progress'
import { renderTodaySetup } from '../src/ui/todaysetup'
import { createGoal, createTask, shanghaiDate, toggleCheckin } from '../src/db'
import type { User } from '../src/types'

const BASE = 'https://yixi.test'
const NOW = Date.now()
const TODAY = shanghaiDate(NOW)

/** What a browser set to English actually sends. */
const EN = { 'accept-language': 'en-US,en;q=0.9' }
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh) Safari/605'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

const user: User = { id: 1, name: 'Alex', is_owner: 0, created_at: 0 }

/** Chinese punctuation — what a half-translated page leaves behind. */
const CHINESE_PUNCT = /[「」，。！？；：（）]/

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM goal_days'),
    env.DB.prepare('DELETE FROM goal_checkins'),
    env.DB.prepare('DELETE FROM goal_tasks'),
    env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.prepare(
    "INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, 'Alex', 'h1', 0, 0)",
  ).run()
}
beforeEach(reset)

// --- the four handlers, with and without the header ---------------------------

function headers(en: boolean, ua = MAC_SAFARI): Record<string, string> {
  return en ? { 'user-agent': ua, ...EN } : { 'user-agent': ua }
}

async function todayHtml(en = true, ua = MAC_SAFARI): Promise<string> {
  return await (await handleToday(new Request(`${BASE}/today`, { headers: headers(en, ua) }), env, user)).text()
}
async function goalsHtml(en = true): Promise<string> {
  return await (await handleGoals(new Request(`${BASE}/today/goals`, { headers: headers(en) }), env, user)).text()
}
async function progressHtml(en = true): Promise<string> {
  return await (await renderProgress(new Request(`${BASE}/today/review`, { headers: headers(en) }), env, user)).text()
}
async function setupHtml(en = true): Promise<string> {
  return await (await renderTodaySetup(new Request(`${BASE}/today/setup`, { headers: headers(en) }), env, user)).text()
}

function mainOf(html: string): string {
  const m = html.match(/<main>([\s\S]*?)<\/main>/)
  expect(m, 'no <main> found').toBeTruthy()
  return m![1]!
}

/**
 * /today/goals embeds src/ui/schemefield.ts, which belongs to a different
 * batch-1 task and is still Chinese — its copy would fail the punctuation
 * sweep below through no fault of this page. The field is always the block
 * between `<div class="field scheme"` and the `<div class="row">` that
 * goalFields puts after it, and nothing inside it carries that class, so
 * cutting it out is exact rather than approximate. Delete this helper (and
 * its call) the day schemefield.ts is converted.
 */
function withoutSchemeField(html: string): string {
  return html.replace(/<div class="field scheme"[\s\S]*?<div class="row">/g, '<div class="row">')
}

function seed(
  title: string,
  extra: Partial<{ target: string; label: string; cue: string }> = {},
): Promise<number> {
  return createGoal(env.DB, {
    userId: 1,
    title,
    cue: extra.cue ?? '',
    target: extra.target ?? '',
    targetLabel: extra.label ?? '',
    until: null,
    now: NOW,
  })
}

// ============================================================================
// /today
// ============================================================================

describe('/today in English', () => {
  it('declares the language and asks for one thing, in English', async () => {
    const html = await todayHtml()
    expect(html).toContain('<html lang="en">')
    const main = mainOf(html)
    expect(main).toContain('Write down the one thing that matters most.')
    expect(main).not.toMatch(CHINESE_PUNCT)
  })

  it('translates the day line and its two links', async () => {
    const main = mainOf(await todayHtml())
    expect(main).toContain('<a class="linky" href="/today/review">Review</a>')
    expect(main).toContain('<a class="linky" href="/today/goals">Edit goals</a>')
    // 「9 月 13 日 · 周日」 becomes 「Sep 13 · Sunday」 — no Chinese date parts.
    expect(main).not.toMatch(/月|日 ·|周/)
  })

  it('says Open {label} on a jump button, whether the label is Latin or not', async () => {
    await seed('健身', { target: 'bilibili://video/BV1', label: 'B 站' })
    await seed('阅读', { target: 'https://weread.qq.com/', label: '微信读书' })
    const main = mainOf(await todayHtml())
    expect(main).toMatch(/<button class="go" type="button" data-go [^>]*>[\s\S]*?Open B 站/)
    expect(main).toMatch(/<a class="go" href="https:\/\/weread\.qq\.com\/"[^>]*>[\s\S]*?Open 微信读书/)
    expect(main).not.toMatch(CHINESE_PUNCT)
  })

  it('says Go with no label, and offers to link an app with no target', async () => {
    await seed('写作', { target: 'bilibili://x' })
    await seed('散步')
    const main = mainOf(await todayHtml())
    expect(main).toMatch(/data-go[^>]*>[\s\S]*?Go</)
    expect(main).toContain('Link an app, and it opens with one tap')
  })

  it('translates the next step and the “{n} more” line, link and all', async () => {
    const g = await seed('健身')
    for (const t of ['warm up', 'run', 'stretch']) {
      await createTask(env.DB, { userId: 1, goalId: g, title: t, now: NOW })
    }
    const main = mainOf(await todayHtml())
    expect(main).toContain('<span class="nl">Next</span>')
    expect(main).toContain(`2 more — see them under <a href="/today/goals#goal-${g}">Goals</a>.`)
    expect(main).not.toMatch(CHINESE_PUNCT)
  })

  it('translates both closing lines once everything is checked', async () => {
    const g = await seed('健身')
    await toggleCheckin(env.DB, 1, g, TODAY, NOW)
    const main = mainOf(await todayHtml())
    expect(main).toContain('That is everything for today.')
    expect(main).toContain('The rest can wait until tomorrow.')
    expect(main).not.toMatch(/[!！]/)
  })

  it('translates the add-to-home-screen banner for iPhone Safari', async () => {
    const main = mainOf(await todayHtml(true, IPHONE_SAFARI))
    expect(main).toContain('<b>Add to Home Screen</b>, and it opens with one tap.')
    expect(main).toContain('Got it')
    expect(main).not.toMatch(CHINESE_PUNCT)
  })
})

// ============================================================================
// /today/goals, /today/review, /today/setup
// ============================================================================

describe('/today/goals in English', () => {
  it('translates the page, the add form and the field labels', async () => {
    const html = await goalsHtml()
    expect(html).toContain('<html lang="en">')

    // The scheme field's own three strings live in goals.ts (label, placeholder
    // and hint are passed *into* schemefield.ts), so they are this task's to
    // translate even though the component around them is not — assert them
    // before withoutSchemeField() cuts the block out below.
    const whole = mainOf(html)
    expect(whole).toContain('Where the button jumps · optional')
    expect(whole).toContain('placeholder="instagram:// or https://…"')
    expect(whole).toContain('Link <b>the exact lesson, the exact book</b>')

    const main = withoutSchemeField(whole)
    expect(main).toContain('<h1>Goals</h1>')
    expect(main).toContain('The top three show up on <a href="/today">Today</a>.')
    expect(main).toContain('Add a goal')
    expect(main).toContain('What the button calls it')
    expect(main).not.toMatch(CHINESE_PUNCT)
  })

  it('translates a goal row and its sub-task box', async () => {
    await seed('健身', { label: 'B 站' })
    const main = withoutSchemeField(mainOf(await goalsHtml()))
    expect(main).toContain('Ongoing')
    expect(main).toContain('Sub-tasks')
    expect(main).toContain('None yet.')
    expect(main).not.toMatch(CHINESE_PUNCT)
  })
})

describe('/today/review in English', () => {
  it('translates the empty state', async () => {
    const html = await progressHtml()
    expect(html).toContain('<html lang="en">')
    const main = mainOf(html)
    expect(main).toContain('Nothing to look back on yet.')
    expect(main).toContain('<a href="/today">Today</a>')
    expect(main).not.toMatch(CHINESE_PUNCT)
  })

  it('translates every section, the counts and the footnote', async () => {
    // Created nine days ago so the per-goal rate reads 「10 days」 rather than
    // the degenerate 「1 days」 a goal made today would produce.
    const g = await createGoal(env.DB, {
      userId: 1, title: '健身', cue: '', target: '', targetLabel: '', until: null,
      now: NOW - 9 * 86_400_000,
    })
    await toggleCheckin(env.DB, 1, g, TODAY, NOW)
    const main = mainOf(await progressHtml())
    expect(main).toContain('<h2>Today</h2>')
    expect(main).toContain('<h2>The last 30 days</h2>')
    expect(main).toContain('<h2>Each goal</h2>')
    expect(main).toContain('<h2>This week</h2>')
    expect(main).toContain('10 days · 1 checked')
    expect(main).toContain('Breathe keeps its own record under <a href="/review">Log</a>.')
    expect(main).not.toMatch(CHINESE_PUNCT)
    expect(main).not.toMatch(/[!！]/)
  })
})

describe('/today/setup in English', () => {
  it('translates the three ways in', async () => {
    const html = await setupHtml()
    expect(html).toContain('<html lang="en">')
    const main = mainOf(html)
    expect(main).toContain('<h1>Guide</h1>')
    expect(main).toContain('Add to Home Screen')
    expect(main).toContain('Shortcuts')
    expect(main).toContain(`${BASE}/today`)
    expect(main).not.toMatch(CHINESE_PUNCT)
    expect(main).not.toMatch(/[!！]/)
  })
})

// ============================================================================
// The nav, and the Chinese baseline
// ============================================================================

describe('the shared console header', () => {
  it('carries English tab labels on every page of the 今日 face', async () => {
    for (const html of [await todayHtml(), await goalsHtml(), await progressHtml(), await setupHtml()]) {
      const nav = html.match(/<nav aria-label="Navigation">([\s\S]*?)<\/nav>/)
      expect(nav, 'nav missing or still labelled in Chinese').toBeTruthy()
      for (const label of ['Today', 'Goals', 'Review', 'Guide', 'Account']) {
        expect(nav![1]).toContain(`<span class="lb">${label}</span>`)
      }
    }
  })

  it('offers the other face in English beside the brand, keeping the brand itself', async () => {
    const html = await todayHtml()
    expect(html).toContain('<span class="brand">一息</span><span class="facename">· Today</span>')
    expect(html).toMatch(/<a class="face" href="\/review">Breathe\s*›<\/a>/)
  })
})

describe('with no language header at all, nothing changed', () => {
  it('still renders Chinese on all four pages', async () => {
    await seed('健身', { target: 'bilibili://video/BV1', label: 'B 站' })

    const today = await todayHtml(false)
    expect(today).toContain('<html lang="zh-Hans">')
    expect(today).toContain('去 B 站')
    expect(today).toContain('<a class="linky" href="/today/goals">编辑目标</a>')

    expect(await goalsHtml(false)).toContain('<h1>目标</h1>')
    expect(await progressHtml(false)).toContain('<h1>回看</h1>')
    expect(await setupHtml(false)).toContain('<h1>怎么配</h1>')
  })

  it('still renders Chinese on the breathing page, the landing page and /mock', async () => {
    const sid = await seedBreathe(null)
    const breathe = await (await renderBreathe(new Request(`${BASE}/b?s=${sid}`), env)).text()
    expect(breathe).toContain('<html lang="zh-Hans">')
    expect(breathe).toContain('你正要打开<b>小红书</b>')
    expect(breathe).toContain('>算了<')
    expect(breathe).toContain('>继续打开<')
    expect(breathe).toContain('>吸气<')
    expect(configOf(breathe).leftSub).toBe('可以锁屏了。')
    expect(configOf(breathe).wentMain).toBe('正在打开小红书……')

    const landing = await renderLanding(new Request(`${BASE}/`)).text()
    expect(landing).toContain('<html lang="zh-Hans">')
    expect(landing).toContain('<p class="lede">在你打开一个 App 之前，先呼吸十秒。</p>')
    expect(landing).toContain('<a href="/mock?v=1">墨</a><a href="/mock?v=2">息</a>')

    const mock = await renderMock(new Request(`${BASE}/mock?v=1`)).text()
    expect(mock).toContain('<html lang="zh-Hans">')
    expect(mock).toContain('你正要打开<b>小红书</b>')
    expect(mock).toContain('>墨</a>')
    expect(mock).toContain('<span>预览</span>')
  })
})

// ============================================================================
// The breathing page, the landing page and /mock
// ============================================================================

/** The breathing page's config island: what its inline script actually runs on. */
function configOf(html: string): Record<string, unknown> {
  const m = html.match(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/)
  expect(m, 'config island missing').toBeTruthy()
  return JSON.parse(m![1]!) as Record<string, unknown>
}

/** The inline behaviour script (the one with no type attribute). */
function scriptOf(html: string): string {
  const m = html.match(/<script>([\s\S]*?)<\/script>/)
  expect(m, 'inline script missing').toBeTruthy()
  return m![1]!
}

/**
 * Only the part of a page a reader sees. The punctuation sweep cannot run over
 * whole documents here: both stylesheets carry comments naming the two skins,
 * 「墨」 and 「息」, and those are notes to the next programmer rather than copy.
 */
function inside(html: string, open: string): string {
  const m = html.match(new RegExp(open + '([\\s\\S]*?)</main>'))
  expect(m, `no ${open} found`).toBeTruthy()
  return m![1]!
}

/**
 * A real /b link: an app row, a live session, and the account's own language.
 * `locale` is what the whole point of this hangs on — an iOS Shortcut opens
 * the breathing page with no cookie of ours, so the stored column is the only
 * thing that can make the page English.
 */
async function seedBreathe(locale: string | null): Promise<string> {
  await env.DB.prepare('UPDATE users SET locale = ?1 WHERE id = 1').bind(locale).run()
  await env.DB.prepare(
    `INSERT OR REPLACE INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (1, 'xhs', '小红书', 'xhsdiscover://', 10, 90, 1)`,
  ).run()
  const sid = 'i18n-' + Math.random().toString(36).slice(2)
  await env.DB.prepare(
    'INSERT INTO sessions (sid, user_id, app, created_at, resolved_at) VALUES (?1, 1, ?2, ?3, NULL)',
  )
    .bind(sid, 'xhs', NOW)
    .run()
  return sid
}

describe('/b in English', () => {
  it('takes the language from the account, since the Shortcut brings nothing else', async () => {
    const sid = await seedBreathe('en')
    // No Accept-Language, no cookie: exactly what a Shortcut sends.
    const html = await (await renderBreathe(new Request(`${BASE}/b?s=${sid}`), env)).text()

    expect(html).toContain('<html lang="en">')
    const stage = inside(html, '<main class="stage">')
    // The label is the user's own data and is never translated.
    expect(stage).toContain('You are about to open <b>小红书</b>')
    expect(stage).toContain('>Never mind<')
    expect(stage).toContain('>Open it anyway<')
    expect(stage).toContain('>Inhale<')
    expect(stage).toContain('aria-label="Breathing guide"')
    expect(stage).not.toMatch(CHINESE_PUNCT)
    expect(html).toContain('This page needs JavaScript.')
  })

  it('hands both phase words and every closing line to the script as English', async () => {
    const sid = await seedBreathe('en')
    const cfg = configOf(await (await renderBreathe(new Request(`${BASE}/b?s=${sid}`), env)).text())

    expect(cfg.inhaleWord).toBe('Inhale')
    expect(cfg.exhaleWord).toBe('Exhale')
    expect(cfg.leftSub).toBe('You can lock the screen now.')
    expect(cfg.wentMain).toBe('Opening 小红书…')
    expect(cfg.wentSub).toBe('If nothing happens, go back to the home screen and open it yourself.')
    expect(String(cfg.leftMain)).not.toMatch(CHINESE_PUNCT)
    expect(String(cfg.leftMain)).not.toMatch(/[!！]/)
  })

  it('leaves the gesture-stack jump exactly as it was — one synchronous location.href', async () => {
    const sid = await seedBreathe('en')
    const js = scriptOf(await (await renderBreathe(new Request(`${BASE}/b?s=${sid}`), env)).text())

    // The one thing translation was never allowed to touch. Two assignments
    // would mean a second navigation path had appeared beside the real one.
    expect(js.match(/location\.href=/g) ?? []).toHaveLength(1)
    expect(js).toContain('if(SCHEME)location.href=SCHEME;')
    // The phase word now comes from the island, so the script itself is the
    // same bytes in either language.
    expect(js).toContain('var word=inhaling?cfg.inhaleWord:cfg.exhaleWord;')
    expect(js).not.toMatch(/吸气|呼气/)
  })

  it('answers a dead link in English too', async () => {
    const res = await renderBreathe(new Request(`${BASE}/b`, { headers: EN }), env)
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('This link has expired.')
    expect(html).toContain('Go back to the home screen and open it again.')
  })
})

describe('/ in English', () => {
  it('translates the page a stranger lands on, its title and its description', async () => {
    const html = await renderLanding(new Request(`${BASE}/`, { headers: EN })).text()

    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<title>一息 (yixi) — ten seconds of breathing before an app opens')
    expect(html).toMatch(/<meta name="description" content="Before an app like Instagram opens/)

    const doc = inside(html, '<main class="doc">')
    expect(doc).toContain('<h1>一息</h1>')
    expect(doc).toContain('Ten seconds of breathing before you open an app.')
    expect(doc).toContain('<h2>How it works</h2>')
    expect(doc).toContain('<h2>On privacy</h2>')
    // The examples turn into apps an English reader would name.
    expect(doc).toContain('Instagram')
    expect(doc).not.toContain('小红书')
    expect(doc).not.toMatch(CHINESE_PUNCT)
    expect(doc).not.toMatch(/[!！]/)
  })

  it('offers the other language in the footer, and never links the one being read', async () => {
    const en = await renderLanding(new Request(`${BASE}/`, { headers: EN })).text()
    expect(en).toContain('<p class="lang">English · <a href="?lang=zh">中文</a></p>')

    const zh = await renderLanding(new Request(`${BASE}/`)).text()
    expect(zh).toContain('<p class="lang"><a href="?lang=en">English</a> · 中文</p>')
  })

  it('keeps its cache, and tells every cache what the page varies on', async () => {
    const res = renderLanding(new Request(`${BASE}/`, { headers: EN }))
    expect(res.headers.get('cache-control')).toContain('max-age')
    // Without this a shared cache hands one visitor's language to the next,
    // and the switcher above looks broken for up to a minute in the visitor's
    // own browser.
    expect(res.headers.get('vary')).toBe('Accept-Language, Cookie')
  })
})

describe('/mock in English', () => {
  it('follows the request, names both skins in English and uses an English example', async () => {
    const html = await renderMock(new Request(`${BASE}/mock?v=1`, { headers: EN })).text()

    expect(html).toContain('<html lang="en">')
    expect(html).toContain('You are about to open <b>Instagram</b>')
    expect(html).toContain('<span>Preview</span>')
    expect(html).toContain('>Ink</a>')
    expect(html).toContain('>Breath</a>')
    expect(html).toContain('>Again</a>')
    expect(html).toContain('aria-label="Visual preview"')

    const cfg = configOf(html)
    expect(cfg.wentMain).toBe('This is where it would jump back to Instagram.')
    expect(cfg.wentSub).toBe('A preview page goes nowhere.')
  })

  it('still treats a label somebody typed as data, in either language', async () => {
    const html = await renderMock(new Request(`${BASE}/mock?v=1&label=微博`, { headers: EN })).text()
    expect(html).toContain('You are about to open <b>微博</b>')
    expect(configOf(html).wentMain).toBe('This is where it would jump back to 微博.')
  })
})
