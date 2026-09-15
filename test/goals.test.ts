import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleGoals } from '../src/ui/goals'
import { addDays, isExpired } from '../src/dates'
import { createGoal, createTask, getTask, listCheckins, listGoals, listTasks, setTaskCheckin, shanghaiDate, syncGoalCheckin } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: 0 }
const other: User = { id: 2, name: '李四', is_owner: 0, created_at: 0 }
const NOW = Date.now()
const TODAY = shanghaiDate(NOW)

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

function get(u: User = user): Promise<Response> {
  return handleGoals(new Request('https://yixi.test/goals'), env, u)
}
function post(fields: Record<string, string>, u: User = user): Promise<Response> {
  return handleGoals(new Request('https://yixi.test/goals', { method: 'POST', body: new URLSearchParams(fields) }), env, u)
}
async function html(u: User = user): Promise<string> {
  return await (await get(u)).text()
}
function seed(title: string, extra: Partial<{ until: string | null; target: string }> = {}): Promise<number> {
  return createGoal(env.DB, { userId: 1, title, cue: '', target: extra.target ?? '', targetLabel: '', until: extra.until ?? null, now: NOW })
}

describe('helpers', () => {
  it('addDays crosses month ends', () => {
    expect(addDays('2026-09-13', 28)).toBe('2026-10-11')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('isExpired is strict: today is still live', () => {
    const g = { until: TODAY } as never
    expect(isExpired(g, TODAY)).toBe(false)
    expect(isExpired({ until: addDays(TODAY, -1) } as never, TODAY)).toBe(true)
    expect(isExpired({ until: null } as never, TODAY)).toBe(false)
  })
})

describe('GET /goals', () => {
  it('wears the shared chrome with 目标 as the current tab', async () => {
    const h = await html()
    expect(h).toContain('<nav aria-label="导航">')
    expect(h).toMatch(/<a href="\/today\/goals" class="on" aria-current="page"/)
  })

  it('shows an empty state and the add form when there is nothing', async () => {
    const h = await html()
    expect(h).toContain('还没有目标')
    expect(h).toContain('name="op" value="add"')
  })

  it('lists live goals as collapsed rows, archived ones folded at the bottom', async () => {
    const a = await seed('健身')
    const b = await seed('英语')
    await post({ op: 'archive', goal: String(b) })
    const h = await html()
    expect(h).toContain(`id="goal-${a}"`)
    expect(h.indexOf('已归档')).toBeGreaterThan(h.indexOf(`id="goal-${a}"`))
    expect(h).toContain(`id="goal-${b}"`)
    expect(h).toContain('name="op" value="restore"')
  })

  it('lifts expired goals to the top with 续四周 and 归档', async () => {
    await seed('健身')
    const old = await seed('旧的', { until: addDays(TODAY, -1) })
    const h = await html()
    expect(h).toContain('到期了')
    expect(h.indexOf('到期了')).toBeLessThan(h.indexOf('id="goal-'))
    expect(h).toContain(`value="${old}"`)
    expect(h).toContain('name="op" value="extend"')
    expect(h).not.toContain('失败')
  })

  it('escapes titles and cues', async () => {
    await createGoal(env.DB, { userId: 1, title: '<b>x</b>', cue: '"q"', target: '', targetLabel: '', until: null, now: NOW })
    const h = await html()
    expect(h).not.toContain('<b>x</b>')
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(h).toContain('&quot;q&quot;')
  })

  it('reuses the scheme field for the jump target, optional', async () => {
    const h = await html()
    expect(h).toContain('name="target"')
    expect(h).toContain('data-try')
    expect(h).toContain('data-label-for="target_label"')
    expect(h).not.toMatch(/<input[^>]*name="target"[^>]*\brequired\b/)
  })

  it('keeps the archived-row delete confirm honest about what deleteGoal actually keeps', async () => {
    const a = await seed('健身')
    await post({ op: 'archive', goal: String(a) })
    const h = await html()
    const archived = h.slice(h.indexOf('<details class="archived">'))
    expect(archived).toContain('删掉这个目标？子任务会一起删，打卡记录保留。')
    expect(archived).not.toContain('打卡记录会一起删')
  })

  it('never lists another user’s goals', async () => {
    // A title no other part of the page could ever print on its own, so this
    // cannot pass because the string simply is not in the template anywhere.
    await seed('张三的私事')
    expect(await html(other)).not.toContain('张三的私事')
  })

  it('heads the sub-task box with the daily wording and counts today, not what is left', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW })
    expect(await html()).toContain('子任务 · 每天都做')
    expect(await html()).toContain('今天 0/2')
    await setTaskCheckin(env.DB, 1, t1, TODAY, true, NOW)
    expect(await html()).toContain('今天 1/2')
  })

  it('gives every sub-task its own folded scheme field, and shows the app it is bound to', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW }))!
    let h = await html()
    expect(h).toContain(`id="f-t${t}-target"`)
    expect(h).toContain(`id="f-t${t}-target_label"`)
    expect(h).toContain('name="op" value="task_save"')
    await post({ op: 'task_save', task: String(t), target: 'bilibili://video/BV1', target_label: 'B 站' })
    h = await html()
    expect(h).toContain('value="bilibili://video/BV1"')
    expect(h).toContain('<span class="skey">B 站</span>')
  })

  it('says the same thing on a sub-task fold bound or not — the row itself already shows the app', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW }))!
    const unbound = await html()
    // 目标自己的跳转折叠也是 details.tapp，所以从子任务那张卡片切起，别切到它。
    const foldOf = (h: string): string => h.slice(h.indexOf('<div class="card tasks">'))
    expect(foldOf(unbound)).toContain('跳去哪')
    await post({ op: 'task_save', task: String(t), target: 'bilibili://video/BV1', target_label: 'B 站' })
    const bound = await html()
    expect(foldOf(bound)).toContain('跳去哪')
    // 两种状态都不再说「绑 App」或「改」：绑没绑看标题旁那枚 App 名。
    for (const h of [unbound, bound]) {
      expect(h).not.toContain('绑 App')
      expect(h).not.toContain('>改<')
    }
  })
})

describe('POST /goals', () => {
  it('adds and redirects to the new row', async () => {
    const res = await post({ op: 'add', title: '健身', cue: '早饭后', target: 'bilibili://', target_label: 'B 站', until: addDays(TODAY, 28) })
    expect(res.status).toBe(303)
    const rows = await listGoals(env.DB, 1)
    expect(rows).toHaveLength(1)
    expect(res.headers.get('location')).toBe(`/today/goals#goal-${rows[0]!.id}`)
    expect(rows[0]).toMatchObject({ title: '健身', cue: '早饭后', target: 'bilibili://', target_label: 'B 站' })
  })

  it('rejects an empty title with 400 and keeps the draft', async () => {
    const res = await post({ op: 'add', title: '', cue: '早饭后', target: '', target_label: '', until: '' })
    expect(res.status).toBe(400)
    const h = await res.text()
    expect(h).toContain('class="banner bad"')
    expect(h).toContain('value="早饭后"')
    expect(await listGoals(env.DB, 1)).toEqual([])
  })

  it('rejects a forbidden or malformed target, accepts https', async () => {
    expect((await post({ op: 'add', title: 'x', cue: '', target: 'javascript:alert(1)', target_label: '', until: '' })).status).toBe(400)
    expect((await post({ op: 'add', title: 'x', cue: '', target: 'not a scheme', target_label: '', until: '' })).status).toBe(400)
    expect((await post({ op: 'add', title: 'x', cue: '', target: 'https://b23.tv/abc', target_label: 'B 站', until: '' })).status).toBe(303)
  })

  it('rejects a malformed date', async () => {
    expect((await post({ op: 'add', title: 'x', cue: '', target: '', target_label: '', until: '2026-13-40' })).status).toBe(400)
    expect((await post({ op: 'add', title: 'x', cue: '', target: '', target_label: '', until: '13/9' })).status).toBe(400)
  })

  it('saves, archives, restores, moves, extends — for the owner only', async () => {
    const a = await seed('健身')
    const b = await seed('英语')
    expect((await post({ op: 'save', goal: String(a), title: '健身 20 分钟', cue: '', target: '', target_label: '', until: '' })).status).toBe(303)
    expect((await listGoals(env.DB, 1))[0]!.title).toBe('健身 20 分钟')

    expect((await post({ op: 'save', goal: String(a), title: '劫持', cue: '', target: '', target_label: '', until: '' }, other)).status).toBe(404)
    expect((await listGoals(env.DB, 1))[0]!.title).toBe('健身 20 分钟')

    expect((await post({ op: 'down', goal: String(a) })).status).toBe(303)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([b, a])
    // at the edge: still a redirect, never an error page
    expect((await post({ op: 'down', goal: String(a) })).status).toBe(303)

    expect((await post({ op: 'archive', goal: String(b) })).status).toBe(303)
    expect((await listGoals(env.DB, 1)).find((g) => g.id === b)!.archived_at).not.toBeNull()
    expect((await post({ op: 'restore', goal: String(b) })).status).toBe(303)
    expect((await listGoals(env.DB, 1)).find((g) => g.id === b)!.archived_at).toBeNull()

    expect((await post({ op: 'extend', goal: String(a) })).status).toBe(303)
    expect((await listGoals(env.DB, 1)).find((g) => g.id === a)!.until).toBe(addDays(TODAY, 28))
  })

  it('deletes only archived goals, and only the owner’s', async () => {
    const a = await seed('健身')
    expect((await post({ op: 'delete', goal: String(a) })).status).toBe(400) // 未归档不能删
    await post({ op: 'archive', goal: String(a) })
    expect((await post({ op: 'delete', goal: String(a) }, other)).status).toBe(404)
    const res = await post({ op: 'delete', goal: String(a) })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/today/goals')
    expect(await listGoals(env.DB, 1)).toEqual([])
  })

  it('adds and deletes tasks under a goal the user owns', async () => {
    const a = await seed('健身')
    expect((await post({ op: 'task_add', goal: String(a), title: '买垫子' })).status).toBe(303)
    expect((await post({ op: 'task_add', goal: String(a), title: '' })).status).toBe(400)
    expect((await post({ op: 'task_add', goal: String(a), title: '劫持' }, other)).status).toBe(404)
    const tasks = await listTasks(env.DB, 1)
    expect(tasks).toHaveLength(1)
    expect((await post({ op: 'task_delete', task: String(tasks[0]!.id) }, other)).status).toBe(404)
    expect((await post({ op: 'task_delete', task: String(tasks[0]!.id) })).status).toBe(303)
    expect(await listTasks(env.DB, 1)).toEqual([])
  })

  it('task_save validates the target the same way a goal does, and is refused for another user', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    expect((await post({ op: 'task_save', task: String(t), target: 'javascript:alert(1)', target_label: '' })).status).toBe(400)
    expect((await post({ op: 'task_save', task: String(t), target: 'not a scheme', target_label: '' })).status).toBe(400)
    // LABEL_MAX 是 12，这里正好 13 个字。
    expect((await post({ op: 'task_save', task: String(t), target: '', target_label: '十三个字十三个字十三个字长' })).status).toBe(400)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: '', target_label: '' })
    expect((await post({ op: 'task_save', task: String(t), target: 'bilibili://', target_label: 'B 站' }, other)).status).toBe(404)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: '' })
    const res = await post({ op: 'task_save', task: String(t), target: 'bilibili://', target_label: 'B 站' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`/today/goals#goal-${a}`)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: 'bilibili://', target_label: 'B 站' })
    expect((await post({ op: 'task_save', task: 'x', target: '', target_label: '' })).status).toBe(400)
  })

  it('hands a rejected task_save back with what was typed, open, in that task’s own fold', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW }))!
    const res = await post({ op: 'task_save', task: String(t), target: 'not a scheme', target_label: '哔哩哔哩' })
    expect(res.status).toBe(400)
    const h = await res.text()
    expect(h).toContain('value="not a scheme"')
    expect(h).toContain('value="哔哩哔哩"')
    // 两层都得张开：折叠在收起来的目标行里，行收着就等于什么都没说。
    expect(h).toContain(`<details class="app" id="goal-${a}" open>`)
    expect(h).toContain('<details class="tapp" open>')
    // 报错句子只挂在这条子任务自己的表单里、输入框上面，页面顶上不再重复一遍。
    const beforeFold = h.slice(0, h.indexOf('<details class="tapp" open>'))
    expect(beforeFold).not.toContain('<p class="banner bad">')
    const fold = h.slice(h.indexOf('<details class="tapp" open>'))
    const aboveTheFields = fold.slice(0, fold.indexOf('<div class="field scheme"'))
    expect(aboveTheFields).toContain('<p class="banner bad">')
    expect(aboveTheFields).toContain('跳转目标要长成')
    // 退回来就是没存：库里那两列还是空的。
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: '', target_label: '' })
  })

  it('leaves every other sub-task’s fold shut and showing what is stored', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    await post({ op: 'task_save', task: String(t2), target: 'bilibili://', target_label: 'B 站' })
    const h = await (await post({ op: 'task_save', task: String(t1), target: 'not a scheme', target_label: '' })).text()
    expect(h).toContain(`id="f-t${t1}-target"`)
    expect(h).toContain('value="not a scheme"')
    // t2 没被碰过：折叠仍旧收着，格子里仍旧是存下来的那个 scheme。
    expect(h).toContain('<details class="tapp">')
    expect(h).toContain('value="bilibili://"')
  })

  it('task_save clears a binding back to nothing, and 404s on a task id nobody owns', async () => {
    const a = await seed('健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    expect((await post({ op: 'task_save', task: String(t), target: 'bilibili://', target_label: 'B 站' })).status).toBe(303)
    expect((await post({ op: 'task_save', task: String(t), target: '', target_label: '' })).status).toBe(303)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: '', target_label: '' })
    // 形状没问题但根本不存在的编号，和别人的编号给同一个答案。
    expect((await post({ op: 'task_save', task: '999999', target: 'bilibili://', target_label: '' })).status).toBe(404)
  })

  it('re-derives today’s goal check-in when a sub-task is added or deleted', async () => {
    const a = await seed('健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, TODAY, true, NOW)
    // 这一步把目标置于「今天做完了」：唯一那条子任务勾上了，派生打卡也在。
    // 不先摆成这个样子，下面加一条没勾的就无从退回，断言也就证明不了什么。
    await syncGoalCheckin(env.DB, 1, a, TODAY, NOW)
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ goal_id: a, date: TODAY }])
    // 加一条没勾的：今天从「做完了」退回「没做完」。
    await post({ op: 'task_add', goal: String(a), title: '二' })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([])
    // 把那条没勾的删掉：今天又变回「做完了」。
    const fresh = (await listTasks(env.DB, 1)).find((tk) => tk.title === '二')!
    await post({ op: 'task_delete', task: String(fresh.id) })
    expect(await listCheckins(env.DB, 1, TODAY, TODAY)).toEqual([{ goal_id: a, date: TODAY }])
  })

  it('answers an unknown op with 400, and a non-numeric id with 400', async () => {
    expect((await post({ op: 'explode' })).status).toBe(400)
    expect((await post({ op: 'archive', goal: 'abc' })).status).toBe(400)
  })
})

describe('the goal form’s jump section', () => {
  it('folds the two jump fields behind 「跳去哪」 and leaves 做到哪天 outside it', async () => {
    const a = await seed('健身')
    const h = await html()
    const row = h.slice(h.indexOf(`id="goal-${a}"`))
    const form = row.slice(0, row.indexOf('</form>'))
    const fold = form.slice(form.indexOf('<details class="tapp">'), form.indexOf(`<label for="f-g${a}-until"`))
    expect(fold).toContain('跳去哪')
    expect(fold).toContain(`id="f-g${a}-target"`)
    expect(fold).toContain(`id="f-g${a}-target_label"`)
    // 折叠在 until 之前就关上了，「做到哪天」是它后面独立的一格。
    expect(form).toMatch(new RegExp(`</details>\\s*<div class="field">\\s*<label for="f-g${a}-until"`))
    // 原先「按钮上叫它什么」和「做到哪天」并排的那两栏没有了。
    expect(h).not.toContain('<div class="row">')
  })

  it('keeps the fold shut for a stored target — the row’s own summary already names the app', async () => {
    const a = await seed('健身', { target: 'bilibili://video/BV1' })
    const h = await html()
    const row = h.slice(h.indexOf(`id="goal-${a}"`))
    expect(row.slice(0, row.indexOf('</form>'))).toContain('<details class="tapp">')
    expect(row.slice(0, row.indexOf('</form>'))).not.toContain('<details class="tapp" open>')
  })

  it('opens the fold on a rejected draft, in the row that was rejected and nowhere else', async () => {
    const a = await seed('健身')
    await seed('英语')
    const res = await post({ op: 'save', goal: String(a), title: '健身', cue: '', target: 'not a scheme', target_label: '', until: '' })
    expect(res.status).toBe(400)
    const h = await res.text()
    const row = h.slice(h.indexOf(`id="goal-${a}"`))
    expect(row.slice(0, row.indexOf('</form>'))).toContain('<details class="tapp" open>')
    expect(row).toContain('value="not a scheme"')
    // 加一个目标那张表单没被退回来，它的折叠照旧收着。
    const addForm = h.slice(h.indexOf('class="card addform"'), h.indexOf(`id="goal-${a}"`))
    expect(addForm).toContain('<details class="tapp">')
    expect(addForm).not.toContain('<details class="tapp" open>')
  })

  it('opens the add form’s own fold when the new goal is the one rejected', async () => {
    const res = await post({ op: 'add', title: 'x', cue: '', target: 'javascript:alert(1)', target_label: '', until: '' })
    expect(res.status).toBe(400)
    const h = await res.text()
    const addForm = h.slice(h.indexOf('class="card addform"'))
    expect(addForm.slice(0, addForm.indexOf('</form>'))).toContain('<details class="tapp" open>')
  })

  it('offers no example answers in any box — a placeholder read as a default value', async () => {
    const a = await seed('健身')
    await createTask(env.DB, { userId: 1, goalId: a, title: '跟练', now: NOW })
    const h = await html()
    for (const example of ['placeholder="健身"', 'placeholder="早饭后"', 'placeholder="B 站"']) {
      expect(h, example).not.toContain(example)
    }
    // 留下的两个是格子自己的标签和格式提示，不是示例答案。
    expect(h).toContain('placeholder="加一条子任务"')
    expect(h).toContain('placeholder="bilibili:// 或 https://…"')
  })
})

describe('今日页放几个目标', () => {
  async function stored(id: number): Promise<number | null> {
    const row = await env.DB.prepare('SELECT today_goals FROM users WHERE id = ?1').bind(id).first<{ today_goals: number | null }>()
    return row?.today_goals ?? null
  }

  it('renders a 1…9 picker between the goals and the archive, with the stored value selected', async () => {
    const a = await seed('健身')
    await post({ op: 'archive', goal: String(a) })
    const h = await html({ ...user, today_goals: 5 })
    expect(h).toContain('今日页放几个目标')
    expect(h).toContain('name="op" value="limit"')
    expect(h).toContain('<option value="5" selected>5</option>')
    expect(h).toContain('<option value="3">3</option>')
    expect((h.match(/<option value="\d"/g) ?? [])).toHaveLength(9)
    expect(h.indexOf('name="op" value="limit"')).toBeLessThan(h.indexOf('已归档'))
  })

  it('shows the default selected for a user who has never chosen', async () => {
    expect(await html()).toContain('<option value="3" selected>3</option>')
  })

  it('stores a number in range and sends the reader back to the page', async () => {
    const res = await post({ op: 'limit', n: '5' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/today/goals')
    expect(await stored(1)).toBe(5)
    // 存过一次之后还能再改。
    expect((await post({ op: 'limit', n: '1' })).status).toBe(303)
    expect(await stored(1)).toBe(1)
  })

  it('refuses anything outside 1…9 with a 400 and writes nothing', async () => {
    await post({ op: 'limit', n: '4' })
    for (const n of ['0', '10', '99', 'abc', '', '-1', '3.5', ' ']) {
      const res = await post({ op: 'limit', n })
      expect(res.status, JSON.stringify(n)).toBe(400)
      expect(await (await post({ op: 'limit', n })).text()).toContain('class="banner bad"')
      expect(await stored(1), JSON.stringify(n)).toBe(4)
    }
  })

  it('is one user’s setting only', async () => {
    expect((await post({ op: 'limit', n: '7' }, other)).status).toBe(303)
    expect(await stored(2)).toBe(7)
    expect(await stored(1)).toBeNull()
  })
})

describe('44pt tap-target floor (design §9)', () => {
  it('never shrinks a .linky button below console.ts’s 44px floor', async () => {
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
  })
})
