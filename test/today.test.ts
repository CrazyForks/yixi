import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleToday } from '../src/ui/today'
import { addDays } from '../src/dates'
import { createGoal, createTask, listGoals, listTasks, shanghaiDate, toggleCheckin } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: 0 }
const other: User = { id: 2, name: '李四', is_owner: 0, created_at: 0 }
const NOW = Date.now()
const TODAY = shanghaiDate(NOW)
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'
const IPHONE_WECHAT = `${IPHONE_SAFARI} MicroMessenger/8.0.50 NetType/WIFI Language/zh_CN`

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM goal_checkins'),
    env.DB.prepare('DELETE FROM goal_tasks'),
    env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, '张三', 'h1', 0, 0)"),
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (2, '李四', 'h2', 0, 0)"),
  ])
}
beforeEach(reset)

function get(ua = 'Mozilla/5.0 (Macintosh) Safari/605', u: User = user): Promise<Response> {
  return handleToday(new Request('https://yixi.test/today', { headers: { 'user-agent': ua } }), env, u)
}
function post(fields: Record<string, string>, u: User = user): Promise<Response> {
  return handleToday(new Request('https://yixi.test/today', { method: 'POST', body: new URLSearchParams(fields) }), env, u)
}
async function html(ua?: string, u?: User): Promise<string> {
  return await (await get(ua, u)).text()
}
function seed(title: string, extra: Partial<{ target: string; label: string; cue: string; until: string }> = {}): Promise<number> {
  return createGoal(env.DB, {
    userId: 1, title, cue: extra.cue ?? '', target: extra.target ?? '', targetLabel: extra.label ?? '',
    until: extra.until ?? null, now: NOW,
  })
}
function scriptOf(h: string): string {
  const m = h.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)
  expect(m, 'inline script missing').toBeTruthy()
  return m![1]!
}
function stripComments(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('empty state', () => {
  it('is one input, and creating from it lands back on /today', async () => {
    const h = await html()
    expect(h).toContain('先写一件最重要的事')
    expect(h).toContain('name="op" value="quick_add"')
    const res = await post({ op: 'quick_add', title: '健身' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/today')
    const g = (await listGoals(env.DB, 1))[0]!
    expect(g.title).toBe('健身')
    // Unbound: the card offers the binding link instead of a jump button.
    const after = await html()
    expect(after).toContain(`href="/today/goals#goal-${g.id}"`)
    expect(after).not.toMatch(/<button class="go"/)
  })
  it('rejects an empty quick add', async () => {
    expect((await post({ op: 'quick_add', title: '  ' })).status).toBe(400)
  })
})

describe('the three cards', () => {
  it('shows the first three live goals, folds the rest, hides archived and expired', async () => {
    const ids = []
    for (const t of ['一', '二', '三', '四', '五']) ids.push(await seed(t))
    await seed('过期', { until: addDays(TODAY, -1) })
    const arch = await seed('归档')
    await env.DB.prepare('UPDATE goals SET archived_at = 1 WHERE id = ?1').bind(arch).run()
    const h = await html()
    for (const t of ['一', '二', '三']) expect(h).toMatch(new RegExp(`<article class="card goal[^"]*" data-goal="\\d+"[\\s\\S]*?<h3>${t}</h3>`))
    const fold = h.slice(h.indexOf('其余目标'))
    expect(fold).toContain('四')
    expect(fold).toContain('五')
    expect(h).not.toContain('过期')
    expect(h).not.toContain('归档')
    expect(h.match(/<article class="card goal/g)).toHaveLength(3)
  })

  it('makes the first goal the hero card and sinks checked cards below unchecked ones', async () => {
    const a = await seed('健身')
    const b = await seed('英语')
    const c = await seed('阅读')
    let h = await html()
    expect(h).toMatch(new RegExp(`<article class="card goal hero" data-goal="${a}"`))
    await toggleCheckin(env.DB, 1, a, TODAY, NOW)
    h = await html()
    const order = [...h.matchAll(/data-goal="(\d+)"/g)].map((m) => Number(m[1]))
    expect(order).toEqual([b, c, a])
    expect(h).toMatch(new RegExp(`<article class="card goal hero checked" data-goal="${a}"`))
  })

  it('shows the cue and only the first undone task as 下一步, with the rest folded', async () => {
    const a = await seed('健身', { cue: '早饭后' })
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    await createTask(env.DB, { userId: 1, goalId: a, title: '三', now: NOW })
    let h = await html()
    expect(h).toContain('早饭后')
    expect(h).toMatch(/class="next"[\s\S]*?<span class="nt">一<\/span>/)
    expect(h).not.toContain('<span class="nt">二</span>')
    expect(h).toContain('还有 2 条')
    await post({ op: 'task_done', task: String(t1) })
    h = await html()
    expect(h).toMatch(/class="next"[\s\S]*?<span class="nt">二<\/span>/)
    expect(h).toContain('还有 1 条')
    // done today: struck through, still visible; another day: gone.
    expect(h).toMatch(/class="done today"[^>]*>[\s\S]*?一/)
    await env.DB.prepare('UPDATE goal_tasks SET done_at = ?1 WHERE id = ?2').bind(NOW - 2 * 86_400_000, t1).run()
    h = await html()
    expect(h).not.toMatch(/class="done today"/)
    expect(t2).toBeGreaterThan(0)
  })

  it('draws seven dots per goal, today last, filled where checked', async () => {
    const a = await seed('健身')
    await toggleCheckin(env.DB, 1, a, TODAY, NOW)
    await toggleCheckin(env.DB, 1, a, addDays(TODAY, -3), NOW)
    const h = await html()
    const dots = h.match(/<i class="d(?: on)?"/g)!
    expect(dots).toHaveLength(7)
    expect(dots[6]).toBe('<i class="d on"')
    expect(dots[3]).toBe('<i class="d on"')
    expect(dots[5]).toBe('<i class="d"')
    // no streak arithmetic anywhere
    expect(h).not.toMatch(/连续/)
  })

  it('says one quiet line when every card is checked, and nothing otherwise', async () => {
    const a = await seed('健身')
    const b = await seed('英语')
    let h = await html()
    expect(h).not.toContain('今天的事都做了')
    await toggleCheckin(env.DB, 1, a, TODAY, NOW)
    await toggleCheckin(env.DB, 1, b, TODAY, NOW)
    h = await html()
    expect(h).toContain('今天的事都做了。')
    expect(h).toContain('其余的事，明天再说。')
    // 只查正文：CSS 里有 !important，脚本里有 !=，都不是文案。
    expect(h.slice(h.indexOf('<main>'), h.indexOf('</main>'))).not.toMatch(/[!！]/)
  })

  it('escapes titles, cues and labels, and never lets a target become markup', async () => {
    await createGoal(env.DB, { userId: 1, title: '<i>x</i>', cue: '"c"', target: 'foo://"><script>', targetLabel: '<b>', until: null, now: NOW })
    // The goal above is rejected outright by safeScheme (it never reaches
    // data-target), so it never exercises escapeHtml on a target string. A
    // second goal with a target safeScheme *accepts* — but that still needs
    // HTML-escaping — is the one that actually tests that path.
    await seed('合法目标', { target: 'foo://a&b' })
    const h = await html()
    expect(h).not.toContain('<i>x</i>')
    expect(h).not.toContain('"><script>')
    expect(h).toContain('&lt;i&gt;x&lt;/i&gt;')
    expect(h).toContain('data-target="foo://a&amp;b"')
    expect(h).not.toContain('data-target="foo://a&b"')
  })

  it('never shows another user’s goals', async () => {
    // Seeded title must not collide with the empty-state input's
    // placeholder="健身" copy, or the assertion below would false-negative
    // against the *other* user's own empty-state markup.
    await seed('张三的私事')
    expect(await html(undefined, other)).not.toContain('张三的私事')
  })
})

describe('the jump', () => {
  it('renders a custom scheme as a data-go button and https as a new-tab link', async () => {
    await seed('健身', { target: 'bilibili://video/BV1', label: 'B 站' })
    await seed('阅读', { target: 'https://weread.qq.com/', label: '微信读书' })
    const h = await html()
    expect(h).toMatch(/<button class="go" type="button" data-go data-target="bilibili:\/\/video\/BV1">[\s\S]*?去 B 站/)
    expect(h).toMatch(/<a class="go" href="https:\/\/weread\.qq\.com\/" target="_blank" rel="noopener">[\s\S]*?去微信读书/)
  })

  it('drops a forbidden scheme at the sink even if it reached the database', async () => {
    await env.DB.prepare(
      "INSERT INTO goals (user_id, title, cue, target, target_label, position, created_at) VALUES (1, 'x', '', 'javascript:alert(1)', 'y', 1, 0)",
    ).run()
    const h = await html()
    expect(h).not.toContain('javascript:')
    expect(h).not.toMatch(/<button class="go"/)
  })

  it('assigns location.href once, synchronously, with nothing awaited on the way', async () => {
    await seed('健身', { target: 'bilibili://' })
    const js = stripComments(scriptOf(await html()))
    expect(js).not.toMatch(/\bawait\b/)
    expect(js.match(/location\.href\s*=/g)).toHaveLength(1)
    const go = js.slice(js.indexOf('function go('), js.indexOf('}', js.indexOf('function go(')))
    expect(go).toContain("location.href = el.getAttribute('data-target')")
    expect(go).not.toMatch(/setTimeout|fetch|then\(/)
  })

  it('says 去做 when no label was given', async () => {
    await seed('冥想', { target: 'headspace://' })
    expect(await html()).toMatch(/data-go[^>]*>[\s\S]*?去做</)
  })
})

describe('check-in', () => {
  it('toggles by day, redirects, and refuses another user’s goal', async () => {
    const a = await seed('健身')
    let res = await post({ op: 'check', goal: String(a) })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/today')
    expect(await html()).toMatch(new RegExp(`data-goal="${a}"[\\s\\S]*?name="op" value="uncheck"`))
    res = await post({ op: 'uncheck', goal: String(a) })
    expect(res.status).toBe(303)
    expect(await html()).toMatch(new RegExp(`data-goal="${a}"[\\s\\S]*?name="op" value="check"`))
    expect((await post({ op: 'check', goal: String(a) }, other)).status).toBe(404)
    expect((await post({ op: 'check', goal: 'x' })).status).toBe(400)
  })

  it('task_done / task_undo respect ownership', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    expect((await post({ op: 'task_done', task: String(t) }, other)).status).toBe(404)
    expect((await post({ op: 'task_done', task: String(t) })).status).toBe(303)
    expect((await listTasks(env.DB, 1))[0]!.done_at).not.toBeNull()
    expect((await post({ op: 'task_undo', task: String(t) })).status).toBe(303)
    expect((await listTasks(env.DB, 1))[0]!.done_at).toBeNull()
  })

  it('ships the ink-bloom script and a check button with a spoken label', async () => {
    await seed('健身')
    const h = await html()
    expect(h).toMatch(/<button class="ck" type="submit" name="op" value="check" aria-label="健身，今天打卡">/)
    const js = scriptOf(h)
    expect(js).toContain('bloom')
    expect(js).toContain('requestSubmit')
    expect(js).toContain('prefers-reduced-motion')
  })

  it('guards the check button against a double tap firing two POSTs inside the bloom window', async () => {
    await seed('健身')
    const js = scriptOf(await html())
    expect(js).toContain("if(ck.classList.contains('bloom'))return;")
  })
})

describe('add-to-home-screen banner', () => {
  it('is rendered (hidden) for iPhone Safari, and the script decides on navigator.standalone', async () => {
    await seed('健身')
    const h = await html(IPHONE_SAFARI)
    expect(h).toMatch(/<aside class="a2hs" id="a2hs" hidden>/)
    expect(h).toContain('添加到主屏幕')
    expect(scriptOf(h)).toContain('navigator.standalone')
    expect(scriptOf(h)).toContain('yixi.a2hs')
  })
  it('is absent in an in-app browser and on desktop', async () => {
    await seed('健身')
    expect(await html(IPHONE_WECHAT)).not.toContain('id="a2hs"')
    expect(await html()).not.toContain('id="a2hs"')
  })
})

describe('dayline links', () => {
  it('gives 回看/编辑目标 a ≥44px tap target without moving the baseline', async () => {
    const h = await html()
    const m = h.match(/<style>([\s\S]*?)<\/style>/)
    expect(m, 'style block missing').toBeTruthy()
    const css = m![1]!
    expect(css).toContain('.dayline .dlinks a{padding:12px 0;margin:-12px 0;display:inline-block}')
  })
})

describe('44pt tap-target floor (design §9)', () => {
  it('never shrinks a .linky button below console.ts’s 44px floor, and keeps .tk at 44px', async () => {
    const h = await html()
    const m = h.match(/<style>([\s\S]*?)<\/style>/)
    expect(m, 'style block missing').toBeTruthy()
    const css = m![1]!
    const rules = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
    for (const rule of rules) {
      const i = rule.indexOf('{')
      const selector = rule.slice(0, i)
      const body = rule.slice(i + 1, -1)
      if (selector.includes('.linky')) expect(body, selector).not.toMatch(/min-height:\s*0\b/)
    }
    const tk = css.match(/\.tk\{[^}]*\}/)
    expect(tk, '.tk rule missing').toBeTruthy()
    expect(tk![0]).toContain('44px')
  })
})
