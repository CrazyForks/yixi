// The signed-in pages are one surface, and this file is what keeps them that
// way. It exists because they stopped being one and nothing noticed.
//
// /review rendered its own <header>: three text-only tabs, no icons, a
// different layout, and — the part that actually hurt — no link to 「怎么配」,
// 「账号」 or 「发号」 at all. Tabbing to 回顾 changed the furniture and took
// three destinations away, with no way back except the browser's back button.
//
// test/icons.test.ts already asserted the nav had 回顾 among its tabs. It stayed
// green through all of it, because it only ever rendered pages that shared the
// nav. The bug lived in the page the test never asked about.
//
// So the assertion here is not "the nav is right on some page". It is that
// every signed-in page emits the SAME nav *as the rest of its own face*, diffed
// against every sibling, with the page list derived from the router rather than
// hand-copied. A page that renders its own chrome fails this file on the day it
// is added — and so does a page that quietly leaks the other face's tabs.
//
// --- two faces ---------------------------------------------------------------
//
// The nav is now two navs: 今日 (/today, /today/goals, /today/review,
// /today/setup) and 拦截 (/review, /settings, /setup). Only /today exists as a
// page today — the other three 今日 hrefs are asserted as links in the shared
// nav even though nothing serves them yet (tasks 4-5 build the pages; the nav
// shape is this task's job). So the shape-equality check runs within each
// face's own page set rather than across all six pages, and a handful of
// checks (which hrefs a face may and may not offer, the owner's extra tab, the
// a.face switch link) are asserted per face explicitly.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleToday } from '../src/ui/today'
import { handleGoals } from '../src/ui/goals'
import { handleSettings } from '../src/ui/settings'
import { renderReview } from '../src/ui/review'
import { renderSetup } from '../src/ui/setup'
import { handleAccount } from '../src/ui/account'
import { handleAdmin } from '../src/api/admin'
import { CONSOLE_CSS } from '../src/ui/console'
import { breathePage } from '../src/ui/breathe'
import { renderLanding } from '../src/ui/landing'
import { renderMock } from '../src/ui/mock'
import { DEFAULT_THEME } from '../src/ui/layout'
import { upsertUserApp } from '../src/db'
import type { User } from '../src/types'

const BASE = 'https://yixi.test'
const user: User = { id: 1, name: '张三', is_owner: 0, created_at: Date.now() }
const owner: User = { ...user, is_owner: 1 }

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM goal_checkins'),
    env.DB.prepare('DELETE FROM goal_tasks'),
    env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.prepare(
    'INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, ?1, ?2, 0, ?3)',
  )
    .bind('张三', 'hash-chrome', Date.now())
    .run()
  await upsertUserApp(env.DB, {
    user_id: 1,
    app: 'xhs',
    label: '小红书',
    scheme: 'xhsdiscover://',
    wait_seconds: 10,
    grace_seconds: 90,
    enabled: 1,
  })
}
beforeEach(reset)

type PageFn = (u: User) => Promise<Response>

/** The 今日 face. Only /today exists so far — tasks 4-5 add the other three. */
const TODAY_PAGES: Record<string, PageFn> = {
  today: (u) => handleToday(new Request(`${BASE}/today`, { headers: { 'user-agent': 'x' } }), env, u),
}

/** The 拦截 face — the original console. */
const BREATHE_PAGES: Record<string, PageFn> = {
  review: (u) => renderReview(new Request(`${BASE}/review`), env, u),
  settings: (u) => handleSettings(new Request(`${BASE}/settings`), env, u),
  setup: (u) => renderSetup(new Request(`${BASE}/setup`), env, u),
  account: (u) => handleAccount(new Request(`${BASE}/account`), env, u),
}

/** Every page reachable from either face's nav, for checks that don't care which face. */
const ALL_PAGES: Record<string, PageFn> = { ...TODAY_PAGES, ...BREATHE_PAGES }

async function html(pages: Record<string, PageFn>, name: string, u: User = user): Promise<string> {
  const res = await pages[name]!(u)
  return await res.text()
}

function navOf(page: string, where: string): string {
  const m = page.match(/<nav aria-label="导航">([\s\S]*?)<\/nav>/)
  expect(m, `${where}: no shared nav — is it rendering a <header> of its own?`).toBeTruthy()
  return m![1]!.trim()
}

/** The nav minus the current-tab marker, which is the one thing that may differ. */
function shape(nav: string): string {
  return nav.replace(/ class="on" aria-current="page"/g, '').replace(/\s+/g, ' ')
}

describe('one nav a face, on every signed-in page', () => {
  it('renders byte-identical tabs within a face, marker aside', async () => {
    for (const pages of [TODAY_PAGES, BREATHE_PAGES]) {
      const names = Object.keys(pages)
      const shapes = new Map<string, string>()
      for (const name of names) shapes.set(name, shape(navOf(await html(pages, name), name)))

      const [first, ...rest] = names
      for (const name of rest) {
        // Diffed against a sibling rather than a golden string: the point is
        // that they agree, not that they match something written down here.
        expect(shapes.get(name), `${name} nav differs from ${first}`).toBe(shapes.get(first!))
      }
    }
  })

  it('offers /account from every page, whichever face it is on', async () => {
    for (const name of Object.keys(ALL_PAGES)) {
      const nav = navOf(await html(ALL_PAGES, name), name)
      expect(nav, `${name} has no link to /account`).toContain('href="/account"')
    }
  })

  it('gives the 今日 face its four hrefs and none of 拦截’s', async () => {
    for (const name of Object.keys(TODAY_PAGES)) {
      const nav = navOf(await html(TODAY_PAGES, name), name)
      for (const href of ['/today', '/today/goals', '/today/review', '/today/setup']) {
        expect(nav, `${name} has no link to ${href}`).toContain(`href="${href}"`)
      }
      expect(nav, `${name} leaked a 拦截 href`).not.toMatch(/href="\/review"/)
      expect(nav, `${name} leaked a 拦截 href`).not.toMatch(/href="\/settings"/)
      expect(nav, `${name} leaked a 拦截 href`).not.toMatch(/href="\/setup"/)
      expect(nav.match(/<a /g), `${name} tab count`).toHaveLength(5)
    }
  })

  it('gives the 拦截 face its three hrefs and none of 今日’s', async () => {
    for (const name of Object.keys(BREATHE_PAGES)) {
      const nav = navOf(await html(BREATHE_PAGES, name), name)
      for (const href of ['/review', '/settings', '/setup']) {
        expect(nav, `${name} has no link to ${href}`).toContain(`href="${href}"`)
      }
      expect(nav, `${name} leaked a 今日 href`).not.toMatch(/href="\/today"/)
      expect(nav, `${name} leaked a 今日 href`).not.toMatch(/href="\/today\/goals"/)
      expect(nav, `${name} leaked a 今日 href`).not.toMatch(/href="\/today\/review"/)
      expect(nav, `${name} leaked a 今日 href`).not.toMatch(/href="\/today\/setup"/)
      expect(nav.match(/<a /g), `${name} tab count`).toHaveLength(4)
    }
  })

  it('marks the page you are on, and only that one', async () => {
    for (const name of Object.keys(ALL_PAGES)) {
      const nav = navOf(await html(ALL_PAGES, name), name)
      expect(nav.match(/aria-current="page"/g), `${name} current tab`).toHaveLength(1)
    }
  })

  it('offers a small a.face link to the other face’s home, beside the brand', async () => {
    for (const name of Object.keys(TODAY_PAGES)) {
      const page = await html(TODAY_PAGES, name)
      expect(page, `${name} a.face`).toMatch(/<a class="face" href="\/review">拦截\s*›<\/a>/)
    }
    for (const name of Object.keys(BREATHE_PAGES)) {
      const page = await html(BREATHE_PAGES, name)
      expect(page, `${name} a.face`).toMatch(/<a class="face" href="\/today">今日\s*›<\/a>/)
    }
  })

  it('gives the owner an extra 发号 tab only on the 拦截 face', async () => {
    for (const name of Object.keys(BREATHE_PAGES)) {
      const nav = navOf(await html(BREATHE_PAGES, name, owner), `${name} (owner)`)
      expect(nav.match(/<a /g), `${name} owner tab count`).toHaveLength(5)
      expect(nav, `${name} owner`).toContain('/admin')
    }
    for (const name of Object.keys(TODAY_PAGES)) {
      const nav = navOf(await html(TODAY_PAGES, name, owner), `${name} (owner)`)
      expect(nav.match(/<a /g), `${name} owner tab count`).toHaveLength(5)
      expect(nav, `${name} owner should have no 发号`).not.toContain('/admin')
    }
    const adminNav = navOf(await (await handleAdmin(new Request(`${BASE}/admin`), env, owner)).text(), 'admin')
    expect(adminNav.match(/<a /g)).toHaveLength(5)
    expect(adminNav).toContain('/admin')
  })

  it('draws an icon in every tab — a text-only nav is the old /review', async () => {
    for (const name of Object.keys(TODAY_PAGES)) {
      const nav = navOf(await html(TODAY_PAGES, name), name)
      expect(nav.match(/<svg /g), `${name} tab icons`).toHaveLength(5)
      expect(nav.match(/<span class="lb">/g), `${name} tab labels`).toHaveLength(5)
    }
    for (const name of Object.keys(BREATHE_PAGES)) {
      const nav = navOf(await html(BREATHE_PAGES, name), name)
      expect(nav.match(/<svg /g), `${name} tab icons`).toHaveLength(4)
      expect(nav.match(/<span class="lb">/g), `${name} tab labels`).toHaveLength(4)
    }
  })

  it('lets no page ship a second <header> of its own', async () => {
    for (const name of Object.keys(ALL_PAGES)) {
      const page = await html(ALL_PAGES, name)
      expect(page.match(/<header>/g), `${name} header count`).toHaveLength(1)
      // /review's private copy is gone; nobody may style the nav back down.
      expect(page.split('${')[0]).not.toMatch(/header nav\s*\{[^}]*font-size/)
    }
  })
})

describe('type scale', () => {
  /**
   * 9.5px nav labels shipped for weeks. Nothing was wrong with the code — it was
   * just too small to read on the device this product is only ever used on, and
   * no test has an opinion about that unless one is written down.
   *
   * 11px is Apple's own floor for any text in an iOS interface.
   */
  const FLOOR = 11

  async function everyStylesheet(): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = [['CONSOLE_CSS', CONSOLE_CSS]]
    const rendered: Array<[string, string]> = []
    for (const name of Object.keys(ALL_PAGES)) rendered.push([name, await html(ALL_PAGES, name)])
    // The two pages with no nav, and so not in ALL_PAGES — which is exactly why
    // the first version of this test missed them. They are the two pages a
    // user sees most: the breathing page every single interception, and the
    // landing page before they have an account.
    rendered.push([
      'breathe',
      await breathePage({
        theme: DEFAULT_THEME,
        label: '小红书',
        waitSeconds: 10,
        sid: 'shot',
        scheme: 'xhsdiscover://',
        farewell: '明天再看',
      }).text(),
    ])
    rendered.push(['landing', await renderLanding(new URL('https://yixi.example/')).text()])
    for (const [name, page] of rendered) {
      const styles = page.match(/<style>([\s\S]*?)<\/style>/g) ?? []
      styles.forEach((s, i) => out.push([`${name} <style> #${i + 1}`, s]))
    }
    return out
  }

  /**
   * px AND rem. The first version of this test only read px, which would have
   * let `font-size:.6rem` — 9.6px, the exact size being fixed here — walk
   * straight past it. The breathing page and the landing page are written
   * almost entirely in rem, so that hole covered the two pages people actually
   * look at most.
   *
   * rem resolves against the ROOT element, which nothing in this project sets,
   * so 1rem is the browser default of 16px.
   */
  const ROOT_PX = 16

  function sizesIn(css: string): Array<[string, number]> {
    const out: Array<[string, number]> = []
    for (const m of css.matchAll(/font-size:\s*([0-9.]+)(px|rem|em)/g)) {
      const n = Number(m[1])
      // `em` is relative to the parent, which this file cannot resolve from
      // the text alone. Every current use is one level inside body-sized prose
      // (inline <code>, which SHOULD scale with its sentence), so it is scored
      // against the root — conservative, since console body is 17px, not 16.
      // A nested em that this under-counts would fail here, not slip through.
      out.push([m[0]!, m[2] === 'px' ? n : n * ROOT_PX])
    }
    return out
  }

  it('renders nothing below 11px on any page, in px or rem', async () => {
    for (const [where, css] of await everyStylesheet()) {
      for (const [text, px] of sizesIn(css)) {
        expect(px, `${where}: ${text}`).toBeGreaterThanOrEqual(FLOOR)
      }
    }
  })

  it('sets body text at 17px, the size iOS itself uses', async () => {
    expect(CONSOLE_CSS).toContain('body{font-size:17px')
  })

  it('keeps every input at 16px, or mobile Safari zooms and never zooms back', async () => {
    // Not a readability rule like the others — this one is load-bearing.
    for (const m of CONSOLE_CSS.matchAll(/input[^{]*\{[^}]*font-size:\s*([0-9.]+)px/g)) {
      expect(Number(m[1]), `input at ${m[1]}px`).toBeGreaterThanOrEqual(16)
    }
  })
})

/**
 * Which pages a search engine may keep.
 *
 * The whole site used to be noindex, set once in pageHtml and never revisited
 * — including the landing page, the one page whose entire job is to be found
 * by somebody who has never heard of this. Promoting a URL that no crawler is
 * allowed to index means the only traffic it can ever get is traffic that was
 * pushed to it.
 *
 * The invariant now has two halves and this test pins both, because getting
 * only the first half right is how a session URL ends up in a search result:
 * the landing page is indexable, and everything else is not.
 */
describe('what may be indexed', () => {
  const ORIGIN = 'https://yixi.example'

  async function privatePages(): Promise<Array<[string, string]>> {
    const out: Array<[string, string]> = []
    for (const name of Object.keys(ALL_PAGES)) out.push([name, await html(ALL_PAGES, name)])
    out.push([
      'breathe',
      await breathePage({
        theme: DEFAULT_THEME,
        label: '小红书',
        waitSeconds: 10,
        sid: 'shot',
        scheme: 'xhsdiscover://',
        farewell: '明天再看',
      }).text(),
    ])
    out.push(['mock', await renderMock(new URL(`${ORIGIN}/mock?v=1`)).text()])
    out.push([
      'today',
      await (await handleToday(new Request(`${BASE}/today`, { headers: { 'user-agent': 'x' } }), env, user)).text(),
    ])
    out.push(['goals', await (await handleGoals(new Request(`${BASE}/goals`), env, user)).text()])
    return out
  }

  it('keeps noindex on every page that is not the front door', async () => {
    for (const [name, page] of await privatePages()) {
      expect(page, `${name} lost its noindex`).toMatch(
        /<meta name="robots" content="noindex,nofollow">/,
      )
    }
  })

  it('lets the landing page be found', async () => {
    const page = await renderLanding(new URL(`${ORIGIN}/`)).text()
    expect(page).not.toMatch(/name="robots"/)
    expect(page).toMatch(/<meta name="description" content="[^"]{40,}">/)
  })

  /**
   * The canonical URL and og:url must come from the request, not a constant.
   * A self-hosted copy that names the public instance as canonical is telling
   * every crawler to credit somebody else's domain with its content — and
   * every self-hoster would ship that bug without ever seeing it.
   */
  it('takes its canonical URL from whoever is being asked', async () => {
    const mine = await renderLanding(new URL('https://breathe.example.org/')).text()
    expect(mine).toContain('<link rel="canonical" href="https://breathe.example.org/">')
    expect(mine).toContain('<meta property="og:url" content="https://breathe.example.org/">')
    expect(mine).not.toContain('yixi-app.pages.dev')
  })

  /**
   * og:* is for pages meant to be shared. A chat client fetches these URLs
   * server-side to build the preview card, so emitting them on a session page
   * would mean a bot opening somebody's breathing session.
   */
  it('offers no unfurl for a private page', async () => {
    for (const [name, page] of await privatePages()) {
      expect(page, `${name} advertises og: tags`).not.toMatch(/property="og:/)
    }
  })
})
