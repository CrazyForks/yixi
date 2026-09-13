import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleGoals } from '../src/ui/goals'
import { addDays, isExpired } from '../src/dates'
import { createGoal, listGoals, listTasks, shanghaiDate } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: 0 }
const other: User = { id: 2, name: '李四', is_owner: 0, created_at: 0 }
const NOW = Date.now()
const TODAY = shanghaiDate(NOW)

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

  it('never lists another user’s goals', async () => {
    // Not '健身': that's also the add form's placeholder copy, so it would still
    // show up on other's empty page and this assertion would pass for the wrong reason.
    await seed('张三的私事')
    expect(await html(other)).not.toContain('张三的私事')
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

  it('answers an unknown op with 400, and a non-numeric id with 400', async () => {
    expect((await post({ op: 'explode' })).status).toBe(400)
    expect((await post({ op: 'archive', goal: 'abc' })).status).toBe(400)
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
