import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleToday } from '../src/ui/today'
import { addDays } from '../src/dates'
import { createGoal, createTask, listCheckins, listGoals, listTaskCheckins, shanghaiDate, toggleCheckin, updateTaskTarget } from '../src/db'
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
    env.DB.prepare('DELETE FROM goal_task_checkins'),
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
/** The same POST our own script sends: identical body, plus the marker header. */
function postFetch(fields: Record<string, string>, u: User = user): Promise<Response> {
  return handleToday(
    new Request('https://yixi.test/today', {
      method: 'POST',
      body: new URLSearchParams(fields),
      headers: { 'x-yixi': 'fetch' },
    }),
    env,
    u,
  )
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

  it('draws as many cards as the user asked for, and counts the fold from there', async () => {
    for (const t of ['一', '二', '三', '四', '五']) await seed(t)
    const one = await html(undefined, { ...user, today_goals: 1 })
    expect(one.match(/<article class="card goal/g)).toHaveLength(1)
    expect(one).toContain('<h3>一</h3>')
    expect(one).not.toContain('<h3>二</h3>')
    // 折叠里是剩下的四个，数字也是四。
    expect(one).toContain('其余目标 · 4')
    const fold = one.slice(one.indexOf('其余目标'))
    for (const t of ['二', '三', '四', '五']) expect(fold).toContain(t)

    const five = await html(undefined, { ...user, today_goals: 5 })
    expect(five.match(/<article class="card goal/g)).toHaveLength(5)
    expect(five).not.toContain('其余目标')
  })

  it('falls back to three cards for a user who has never chosen, or stored something impossible', async () => {
    for (const t of ['一', '二', '三', '四', '五']) await seed(t)
    for (const u of [user, { ...user, today_goals: null }, { ...user, today_goals: 0 }, { ...user, today_goals: 99 }]) {
      const h = await html(undefined, u)
      expect(h.match(/<article class="card goal/g), JSON.stringify(u)).toHaveLength(3)
      expect(h).toContain('其余目标 · 2')
    }
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

  it('lists every sub-task as its own row, in position order, and a checked row does not move', async () => {
    const a = await seed('健身', { cue: '早饭后' })
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    const t3 = (await createTask(env.DB, { userId: 1, goalId: a, title: '三', now: NOW }))!
    let h = await html()
    expect(h).toContain('早饭后')
    expect([...h.matchAll(/<span class="tkt">(.)<\/span>/g)].map((m) => m[1])).toEqual(['一', '二', '三'])
    expect(h).not.toContain('<span class="nl">')
    expect(h).not.toContain('还有')

    expect((await post({ op: 'task_check', task: String(t1) })).status).toBe(303)
    h = await html()
    // 勾过的行标 .done，位置不变——列表不跳。
    expect([...h.matchAll(/<span class="tkt">(.)<\/span>/g)].map((m) => m[1])).toEqual(['一', '二', '三'])
    expect(h).toMatch(/<li class="tkr done">[\s\S]*?<span class="tkt">一<\/span>/)
    expect(h).toMatch(/<li class="tkr">[\s\S]*?<span class="tkt">二<\/span>/)
    expect(t2 + t3).toBeGreaterThan(0)
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
    // 这一行现在一直在 DOM 里，只是没做完时带 hidden——脚本要能把它亮出来。
    expect(h).toContain('<p class="fin" hidden>')
    await toggleCheckin(env.DB, 1, a, TODAY, NOW)
    await toggleCheckin(env.DB, 1, b, TODAY, NOW)
    h = await html()
    expect(h).toContain('<p class="fin">')
    expect(h).not.toContain('<p class="fin" hidden>')
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

  it('puts the jump inline on every sub-task row, three ways, and takes the bottom button away', async () => {
    const a = await seed('健身', { target: 'bilibili://video/BV1', label: 'B 站' })
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '拉伸', now: NOW }))!
    await updateTaskTarget(env.DB, 1, t2, 'https://weread.qq.com/', '微信读书')
    const h = await html()
    // 没有自己的 target：继承目标的 scheme 与 label。
    expect(h).toMatch(/<button class="chip" type="button" data-go data-target="bilibili:\/\/video\/BV1">[\s\S]*?去 B 站/)
    // 有自己的 https target：新标签页打开，用自己的 label。
    expect(h).toMatch(/<a class="chip" href="https:\/\/weread\.qq\.com\/" target="_blank" rel="noopener">[\s\S]*?去微信读书/)
    // 有子任务时卡片底部的大按钮与绑定提示都不渲染。
    expect(h).not.toMatch(/class="go"/)
    expect(h).not.toContain('去绑一个 App，一按就开')
    expect(t1).toBeGreaterThan(0)
  })

  it('gives a row no chip when neither it nor its goal has a target, and says 去做 for a labelless own target', async () => {
    const a = await seed('阅读')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '记录体重', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '冥想', now: NOW }))!
    await updateTaskTarget(env.DB, 1, t2, 'headspace://', '')
    const h = await html()
    expect(h).toMatch(/<span class="tkt">记录体重<\/span>\s*<\/li>/)
    expect(h).toMatch(/data-target="headspace:\/\/">[\s\S]*?去做</)
    expect(t1).toBeGreaterThan(0)
  })

  it('drops a forbidden scheme at the row sink, whether it is the row’s own or inherited', async () => {
    // 自己的 target 被禁。
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    await env.DB.prepare('UPDATE goal_tasks SET target = ?1 WHERE id = ?2').bind('javascript:alert(1)', t).run()
    // 继承来的 target 被禁：目标那一行直接写进 D1，绕过写入端的校验。
    await env.DB.prepare(
      "INSERT INTO goals (user_id, title, cue, target, target_label, position, created_at) VALUES (1, '阅读', '', 'javascript:alert(2)', 'y', 9, 0)",
    ).run()
    const b = (await listGoals(env.DB, 1)).find((g) => g.title === '阅读')!
    await createTask(env.DB, { userId: 1, goalId: b.id, title: '二', now: NOW })
    const h = await html()
    expect(h).not.toContain('javascript:')
    expect(h).not.toContain('class="chip"')
    // 被 safeScheme 拦下的 target 等于没绑：卡片上没有一处能跳，提示得留着。
    expect(h).toContain('去绑一个 App，一按就开')
  })

  it('keeps the bottom button on a goal that has no sub-tasks at all', async () => {
    await seed('冥想', { target: 'headspace://', label: 'Headspace' })
    const h = await html()
    expect(h).toMatch(/<button class="go" type="button" data-go data-target="headspace:\/\/">/)
  })

  it('keeps the binding prompt on a card whose goal and sub-tasks all have nowhere to jump', async () => {
    const a = await seed('阅读')
    await createTask(env.DB, { userId: 1, goalId: a, title: '读十页', now: NOW })
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '写一句', now: NOW }))!
    const h = await html()
    expect(h).toContain('去绑一个 App，一按就开')
    expect(h).toContain(`href="/today/goals#goal-${a}"`)
    expect(h).not.toMatch(/class="go"/)
    // 一处能跳就够，提示退场——底部大按钮仍然不回来。
    await updateTaskTarget(env.DB, 1, t2, 'headspace://', '')
    const after = await html()
    expect(after).not.toContain('去绑一个 App，一按就开')
    expect(after).not.toMatch(/class="go"/)
    expect(after).toMatch(/<button class="chip" type="button" data-go data-target="headspace:\/\/">/)
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
    // A well-formed number for a goal nobody owns is the same answer as a goal
    // somebody else owns: 404 either way, so the page never tells them apart.
    expect((await post({ op: 'check', goal: '999999' })).status).toBe(404)
  })

  it('task_check / task_uncheck respect ownership and toggle exactly one day', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    expect((await post({ op: 'task_check', task: String(t) }, other)).status).toBe(404)
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    expect(await listTaskCheckins(env.DB, 2, TODAY, TODAY)).toEqual([])
    expect((await post({ op: 'task_check', task: String(t) })).status).toBe(303)
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ task_id: t, date: TODAY }])
    expect((await post({ op: 'task_uncheck', task: String(t) })).status).toBe(303)
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    expect((await post({ op: 'task_check', task: 'x' })).status).toBe(400)
    expect((await post({ op: 'task_done', task: String(t) })).status).toBe(400)
  })

  it('derives the goal check-in from its sub-tasks: the last one checked fills the circle, undoing one empties it', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    await post({ op: 'task_check', task: String(t1) })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    await post({ op: 'task_check', task: String(t2) })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ goal_id: a, date: TODAY }])
    expect(await html()).toMatch(new RegExp(`data-goal="${a}"[\\s\\S]*?name="op" value="uncheck"`))
    await post({ op: 'task_uncheck', task: String(t1) })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
  })

  it('the circle on a goal with sub-tasks checks them all, and unchecking clears them all', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    expect((await post({ op: 'check', goal: String(a) })).status).toBe(303)
    expect((await listTaskCheckins(env.DB, 1, TODAY, TODAY)).map((r) => r.task_id).sort((x, y) => x - y))
      .toEqual([t1, t2].sort((x, y) => x - y))
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ goal_id: a, date: TODAY }])
    expect((await post({ op: 'uncheck', goal: String(a) })).status).toBe(303)
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    expect((await post({ op: 'check', goal: String(a) }, other)).status).toBe(404)
  })

  it('ships the ink-bloom script and a check button with a spoken label', async () => {
    await seed('健身')
    const h = await html()
    expect(h).toMatch(
      /<button class="ck" type="submit" name="op" value="check" aria-label="健身，今天打卡" data-on="健身，已打卡，点击取消" data-off="健身，今天打卡">/,
    )
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

interface CheckinJson {
  goal: { id: number; checked: boolean }
  allDone: boolean
}

/**
 * The instant-check-in contract. The header is a marker our own script sends,
 * not a security boundary — so every one of these asserts the *same* writes
 * happened as on the 303 path, and that the state comes back read from the
 * database rather than guessed.
 */
describe('check-in over fetch', () => {
  async function body(res: Response): Promise<CheckinJson> {
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    return (await res.json()) as CheckinJson
  }

  it('lights the circle only when the last sub-task lands, and empties it again', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!

    expect(await body(await postFetch({ op: 'task_check', task: String(t1) })))
      .toEqual({ goal: { id: a, checked: false }, allDone: false })
    // 同一次请求既要写库又要把写完的状态读回来。
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ task_id: t1, date: TODAY }])

    expect(await body(await postFetch({ op: 'task_check', task: String(t2) })))
      .toEqual({ goal: { id: a, checked: true }, allDone: true })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ goal_id: a, date: TODAY }])

    expect(await body(await postFetch({ op: 'task_uncheck', task: String(t1) })))
      .toEqual({ goal: { id: a, checked: false }, allDone: false })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
  })

  it('answers the circle on a goal with sub-tasks, and still writes every row', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!

    expect(await body(await postFetch({ op: 'check', goal: String(a) })))
      .toEqual({ goal: { id: a, checked: true }, allDone: true })
    expect((await listTaskCheckins(env.DB, 1, TODAY, TODAY)).map((r) => r.task_id).sort((x, y) => x - y))
      .toEqual([t1, t2].sort((x, y) => x - y))

    expect(await body(await postFetch({ op: 'uncheck', goal: String(a) })))
      .toEqual({ goal: { id: a, checked: false }, allDone: false })
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
  })

  it('answers the circle on a goal that has no sub-tasks at all', async () => {
    const a = await seed('冥想')
    expect(await body(await postFetch({ op: 'check', goal: String(a) })))
      .toEqual({ goal: { id: a, checked: true }, allDone: true })
    expect(await body(await postFetch({ op: 'uncheck', goal: String(a) })))
      .toEqual({ goal: { id: a, checked: false }, allDone: false })
  })

  it('counts allDone over the cards /today would draw, not over every goal', async () => {
    const a = await seed('一')
    const b = await seed('二')
    const c = await seed('三')
    // 第四个目标进不了卡片区，只在折叠里——它没勾也不该拦住那句话。
    const d = await seed('四')

    expect((await body(await postFetch({ op: 'check', goal: String(a) }))).allDone).toBe(false)
    expect((await body(await postFetch({ op: 'check', goal: String(b) }))).allDone).toBe(false)
    expect((await body(await postFetch({ op: 'check', goal: String(c) }))).allDone).toBe(true)
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).not.toContainEqual({ goal_id: d, date: TODAY })

    expect((await body(await postFetch({ op: 'uncheck', goal: String(a) }))).allDone).toBe(false)
  })

  it('counts allDone against the user’s own card limit, not a constant three', async () => {
    const a = await seed('一')
    await seed('二')
    await seed('三')
    const one = { ...user, today_goals: 1 }
    // 只放一张卡时，勾掉第一个就是今天全做完了——后面两个连卡片都没有。
    expect((await body(await postFetch({ op: 'check', goal: String(a) }, one))).allDone).toBe(true)
    // 同一份数据，默认三张卡的人还差两个。
    expect((await body(await postFetch({ op: 'uncheck', goal: String(a) }, one))).allDone).toBe(false)
    expect((await body(await postFetch({ op: 'check', goal: String(a) }))).allDone).toBe(false)
  })

  it('still 303s for the very same POSTs when the header is absent', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const same: Record<string, string>[] = [
      { op: 'task_check', task: String(t) },
      { op: 'task_uncheck', task: String(t) },
      { op: 'check', goal: String(a) },
      { op: 'uncheck', goal: String(a) },
    ]
    for (const fields of same) {
      const res = await post(fields)
      expect(res.status, JSON.stringify(fields)).toBe(303)
      expect(res.headers.get('location')).toBe('/today')
    }
  })

  it('leaks nothing to a fetch aimed at somebody else’s row, or at nothing at all', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!

    const stolen = await postFetch({ op: 'task_check', task: String(t) }, other)
    expect(stolen.status).toBe(404)
    expect(stolen.headers.get('content-type') ?? '').not.toContain('json')
    expect(await stolen.text()).toBe('not found')
    expect(await listTaskCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    expect(await listTaskCheckins(env.DB, 2, TODAY, TODAY)).toEqual([])

    expect((await postFetch({ op: 'check', goal: String(a) }, other)).status).toBe(404)
    expect((await postFetch({ op: 'check', goal: '999999' })).status).toBe(404)
    expect((await postFetch({ op: 'check', goal: 'x' })).status).toBe(400)
    expect((await postFetch({ op: 'task_done', task: String(t) })).status).toBe(400)
  })
})

describe('what the optimistic script is handed', () => {
  it('renders both spoken labels on both kinds of check button', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW }))!
    const h = await html()
    expect(h).toContain('data-on="健身，已打卡，点击取消" data-off="健身，今天打卡"')
    expect(h).toContain('data-on="跟练，已勾上，点击取消" data-off="跟练，今天勾上"')
    // 勾过之后两个属性都不变，变的只有 aria-label 与 value。
    expect((await post({ op: 'task_check', task: String(t) })).status).toBe(303)
    const after = await html()
    expect(after).toContain('data-on="跟练，已勾上，点击取消" data-off="跟练，今天勾上"')
    expect(after).toContain('aria-label="跟练，已勾上，点击取消"')
  })

  it('escapes a title inside the two new attributes as well as inside aria-label', async () => {
    await createGoal(env.DB, { userId: 1, title: '"x"', cue: '', target: '', targetLabel: '', until: null, now: NOW })
    const h = await html()
    expect(h).toContain('data-off="&quot;x&quot;，今天打卡"')
    expect(h).not.toContain('data-off=""x"')
  })

  it('takes the submit over with fetch, and leaves the synchronous jump alone', async () => {
    await seed('健身')
    const js = stripComments(scriptOf(await html()))
    expect(js).toContain("addEventListener('submit'")
    expect(js).toContain("'x-yixi'")
    expect(js).toContain('fetch(')
    // 两个监听器各管各的：点击那段仍然只有它自己那一次同步跳转。
    expect(js.match(/location\.href\s*=/g)).toHaveLength(1)
    expect(js).not.toMatch(/\bawait\b/)
    expect(js.match(/addEventListener\('click'/g)).toHaveLength(1)
  })

  /**
   * 这一条是结构性的，只能证明那几行代码在脚本里，证明不了它们在浏览器里做了
   * 什么——这个套件跑在 workerd 里，没有 DOM。行为那一层由 Chromium 实测覆盖
   * （task-7 报告 Fix round 1），这里守的是「有人把它删了会红」。
   */
  it('keeps the per-card receipt sequence, and sends in the tap’s own tick', async () => {
    await seed('健身')
    const js = stripComments(scriptOf(await html()))
    expect(js).toContain('yxSeq')
    expect(js).toContain('seq===card.yxSeq')
    // 打卡请求不再等那 260ms 的墨点动画：requestSubmit 就在这一跳里发出去。
    expect(js).toContain('form.requestSubmit(ck);')
    expect(js).not.toMatch(/setTimeout\([\s\S]{0,60}requestSubmit/)
    // 动画本身还在，只是它现在只是装饰。
    expect(js).toContain('bloom')
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
  it('never shrinks a .linky button below console.ts’s 44px floor, and keeps .tk/.chip at 44px', async () => {
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
    const chip = css.match(/\.chip\{[^}]*\}/)
    expect(chip, '.chip rule missing').toBeTruthy()
    expect(chip![0]).toContain('44px')
  })
})
