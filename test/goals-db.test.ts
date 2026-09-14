import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  countTaskCheckinsBetween, countTaskCheckinsOn, countTasksDoneBetween, countTasksDoneOn, createGoal, createTask,
  deleteGoal, deleteTask, getGoal, getTask, listCheckins, listGoalDays, listGoals, listTaskCheckins, listTasks,
  listUsersWithLiveGoals, moveGoal, setGoalArchived, setGoalTaskCheckins, setTaskCheckin, setTaskDone, shanghaiDate,
  syncGoalCheckin, toggleCheckin, updateGoal, updateTaskTarget, upsertGoalDay,
} from '../src/db'

const NOW = 1_800_000_000_000
const TODAY = shanghaiDate(NOW)

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM goal_task_checkins'),
    env.DB.prepare('DELETE FROM goal_days'),
    env.DB.prepare('DELETE FROM goal_checkins'),
    env.DB.prepare('DELETE FROM goal_tasks'),
    env.DB.prepare('DELETE FROM goals'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, 'a', 'h1', 0, 0)"),
    env.DB.prepare("INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (2, 'b', 'h2', 0, 0)"),
  ])
}
beforeEach(reset)

async function goal(userId: number, title: string): Promise<number> {
  return await createGoal(env.DB, { userId, title, cue: '', target: '', targetLabel: '', until: null, now: NOW })
}

describe('goals', () => {
  it('creates with increasing position and lists in that order', async () => {
    const a = await goal(1, '健身')
    const b = await goal(1, '英语')
    const rows = await listGoals(env.DB, 1)
    expect(rows.map((g) => g.id)).toEqual([a, b])
    expect(rows[1]!.position).toBeGreaterThan(rows[0]!.position)
  })

  it('never shows another user their neighbour’s goals', async () => {
    await goal(1, '健身')
    expect(await listGoals(env.DB, 2)).toEqual([])
    const rows = await listGoals(env.DB, 1)
    expect(await getGoal(env.DB, 2, rows[0]!.id)).toBeNull()
  })

  it('updates only the owner’s row', async () => {
    const id = await goal(1, '健身')
    expect(await updateGoal(env.DB, 2, id, { title: 'x', cue: '', target: '', targetLabel: '', until: null })).toBe(false)
    expect(await updateGoal(env.DB, 1, id, { title: '健身 20 分钟', cue: '早饭后', target: 'bilibili://', targetLabel: 'B 站', until: '2026-10-11' })).toBe(true)
    const g = await getGoal(env.DB, 1, id)
    expect(g).toMatchObject({ title: '健身 20 分钟', cue: '早饭后', target: 'bilibili://', target_label: 'B 站', until: '2026-10-11' })
  })

  it('archives, restores, and lists archived rows last', async () => {
    const a = await goal(1, '健身')
    const b = await goal(1, '英语')
    expect(await setGoalArchived(env.DB, 1, a, NOW)).toBe(true)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([b, a])
    expect(await setGoalArchived(env.DB, 1, a, null)).toBe(true)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([a, b])
    expect(await setGoalArchived(env.DB, 2, a, NOW)).toBe(false)
  })

  it('swaps position with the neighbour on move, and is a no-op at the edge', async () => {
    const a = await goal(1, '健身')
    const b = await goal(1, '英语')
    const c = await goal(1, '阅读')
    expect(await moveGoal(env.DB, 1, a, 'up', TODAY)).toBe(false)
    expect(await moveGoal(env.DB, 1, c, 'up', TODAY)).toBe(true)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([a, c, b])
    expect(await moveGoal(env.DB, 1, a, 'down', TODAY)).toBe(true)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([c, a, b])
    expect(await moveGoal(env.DB, 2, a, 'down', TODAY)).toBe(false)
  })

  it('move skips archived rows', async () => {
    const a = await goal(1, '健身')
    const b = await goal(1, '英语')
    const c = await goal(1, '阅读')
    await setGoalArchived(env.DB, 1, b, NOW)
    expect(await moveGoal(env.DB, 1, c, 'up', TODAY)).toBe(true)
    const live = (await listGoals(env.DB, 1)).filter((g) => g.archived_at === null).map((g) => g.id)
    expect(live).toEqual([c, a])
  })

  it('move skips an expired neighbour too, swapping with the nearest live goal', async () => {
    const a = await goal(1, '健身')
    const x = await goal(1, '过期')
    const c = await goal(1, '阅读')
    await updateGoal(env.DB, 1, x, { title: '过期', cue: '', target: '', targetLabel: '', until: '2000-01-01' })
    // order by position is [a, x(expired), c]; moving c up must swap with a,
    // skipping the expired x in between, or the button would silently do
    // nothing (x is still "in the way" positionally).
    expect(await moveGoal(env.DB, 1, c, 'up', TODAY)).toBe(true)
    expect((await listGoals(env.DB, 1)).map((g) => g.id)).toEqual([c, x, a])
  })

  it('delete takes tasks with it but keeps the check-in history', async () => {
    const id = await goal(1, '健身')
    await createTask(env.DB, { userId: 1, goalId: id, title: '买垫子', now: NOW })
    await toggleCheckin(env.DB, 1, id, '2026-09-13', NOW)
    expect(await deleteGoal(env.DB, 2, id)).toBe(false)
    expect(await deleteGoal(env.DB, 1, id)).toBe(true)
    expect(await getGoal(env.DB, 1, id)).toBeNull()
    expect(await listTasks(env.DB, 1)).toEqual([])
    expect(await listCheckins(env.DB, 1, '2026-09-01', '2026-09-30')).toEqual([{ goal_id: id, date: '2026-09-13' }])
  })
})

describe('tasks', () => {
  it('refuses a task on a goal the user does not own', async () => {
    const id = await goal(1, '健身')
    expect(await createTask(env.DB, { userId: 2, goalId: id, title: 'x', now: NOW })).toBeNull()
    expect(await createTask(env.DB, { userId: 1, goalId: id, title: '买垫子', now: NOW })).toEqual(expect.any(Number))
  })

  it('orders undone before done, then by position', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    const t3 = (await createTask(env.DB, { userId: 1, goalId: id, title: '三', now: NOW }))!
    expect(await setTaskDone(env.DB, 1, t1, NOW)).toBe(true)
    expect((await listTasks(env.DB, 1)).map((t) => t.id)).toEqual([t2, t3, t1])
    expect(await setTaskDone(env.DB, 2, t2, NOW)).toBe(false)
    expect(await setTaskDone(env.DB, 1, t1, null)).toBe(true)
    expect((await listTasks(env.DB, 1)).map((t) => t.id)).toEqual([t1, t2, t3])
  })

  it('deletes for the owner only', async () => {
    const id = await goal(1, '健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    expect(await deleteTask(env.DB, 2, t)).toBe(false)
    expect(await deleteTask(env.DB, 1, t)).toBe(true)
    expect(await listTasks(env.DB, 1)).toEqual([])
  })
})

describe('checkins', () => {
  it('toggles per day and never double counts', async () => {
    const id = await goal(1, '健身')
    expect(await toggleCheckin(env.DB, 1, id, '2026-09-13', NOW)).toBe('checked')
    expect(await toggleCheckin(env.DB, 1, id, '2026-09-13', NOW + 1)).toBe('unchecked')
    expect(await toggleCheckin(env.DB, 1, id, '2026-09-13', NOW + 2)).toBe('checked')
    expect(await toggleCheckin(env.DB, 1, id, '2026-09-12', NOW + 3)).toBe('checked')
    const rows = await listCheckins(env.DB, 1, '2026-09-07', '2026-09-13')
    expect(rows).toEqual(expect.arrayContaining([{ goal_id: id, date: '2026-09-13' }, { goal_id: id, date: '2026-09-12' }]))
    expect(rows).toHaveLength(2)
  })

  it('refuses a goal the user does not own', async () => {
    const id = await goal(1, '健身')
    expect(await toggleCheckin(env.DB, 2, id, '2026-09-13', NOW)).toBe('nogoal')
    expect(await listCheckins(env.DB, 2, '2026-09-01', '2026-09-30')).toEqual([])
  })

  it('range is inclusive on both ends', async () => {
    const id = await goal(1, '健身')
    await toggleCheckin(env.DB, 1, id, '2026-09-07', NOW)
    await toggleCheckin(env.DB, 1, id, '2026-09-13', NOW)
    await toggleCheckin(env.DB, 1, id, '2026-09-06', NOW)
    expect((await listCheckins(env.DB, 1, '2026-09-07', '2026-09-13')).map((r) => r.date).sort()).toEqual(['2026-09-07', '2026-09-13'])
  })

  it('two near-simultaneous toggles never throw and leave exactly one row', async () => {
    const id = await goal(1, '健身')
    const [r1, r2] = await Promise.all([
      toggleCheckin(env.DB, 1, id, '2026-09-13', NOW),
      toggleCheckin(env.DB, 1, id, '2026-09-13', NOW + 1),
    ])
    // 单 worker 的测试 D1 绑定下两次调用可能被串行化，具体谁先谁后不保证，
    // 只保证两者都是合法结果、都没抛异常。
    expect(['checked', 'unchecked']).toContain(r1)
    expect(['checked', 'unchecked']).toContain(r2)
    expect(await listCheckins(env.DB, 1, '2026-09-13', '2026-09-13')).toHaveLength(1)
  })
})

describe('goal_days', () => {
  it('upsert replaces the same day and lists an inclusive range in order', async () => {
    await upsertGoalDay(env.DB, { user_id: 1, date: '2026-09-10', shown: 3, done: 1, tasks_done: 0, ts: 1 })
    await upsertGoalDay(env.DB, { user_id: 1, date: '2026-09-10', shown: 3, done: 2, tasks_done: 1, ts: 2 })
    await upsertGoalDay(env.DB, { user_id: 1, date: '2026-09-12', shown: 2, done: 2, tasks_done: 0, ts: 3 })
    await upsertGoalDay(env.DB, { user_id: 2, date: '2026-09-11', shown: 1, done: 0, tasks_done: 0, ts: 4 })
    const rows = await listGoalDays(env.DB, 1, '2026-09-10', '2026-09-12')
    expect(rows.map((r) => [r.date, r.done, r.tasks_done])).toEqual([['2026-09-10', 2, 1], ['2026-09-12', 2, 0]])
  })
  it('lists users with live goals only once, and not archived-only users', async () => {
    const a = await goal(1, '健身'); await goal(1, '英语')
    const b = await goal(2, '阅读'); await setGoalArchived(env.DB, 2, b, NOW)
    expect(await listUsersWithLiveGoals(env.DB)).toEqual([1])
    expect(a).toBeGreaterThan(0)
  })
  it('counts tasks done on a Shanghai day', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    // 2026-09-13 23:30 Shanghai = 15:30 UTC; 2026-09-14 00:30 Shanghai = 16:30 UTC
    await setTaskDone(env.DB, 1, t1, Date.UTC(2026, 8, 13, 15, 30))
    await setTaskDone(env.DB, 1, t2, Date.UTC(2026, 8, 13, 16, 30))
    expect(await countTasksDoneOn(env.DB, 1, '2026-09-13')).toBe(1)
    expect(await countTasksDoneOn(env.DB, 1, '2026-09-14')).toBe(1)
    expect(await countTasksDoneOn(env.DB, 2, '2026-09-13')).toBe(0)
  })

  it('counts tasks done over an inclusive range of Shanghai days, both ends included and neither exceeded', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    const t3 = (await createTask(env.DB, { userId: 1, goalId: id, title: '三', now: NOW }))!
    const t4 = (await createTask(env.DB, { userId: 1, goalId: id, title: '四', now: NOW }))!
    const t5 = (await createTask(env.DB, { userId: 1, goalId: id, title: '五', now: NOW }))!
    // 2026-09-14 is a Monday, 2026-09-20 the Sunday ending that same week.
    // 2026-09-14 00:30 Shanghai = 2026-09-13 16:30 UTC (start of range, inclusive)
    await setTaskDone(env.DB, 1, t1, Date.UTC(2026, 8, 13, 16, 30))
    // 2026-09-20 23:30 Shanghai = 2026-09-20 15:30 UTC (end of range, inclusive)
    await setTaskDone(env.DB, 1, t2, Date.UTC(2026, 8, 20, 15, 30))
    // 2026-09-16 12:00 Shanghai = 2026-09-16 04:00 UTC (a day inside the range)
    await setTaskDone(env.DB, 1, t3, Date.UTC(2026, 8, 16, 4, 0))
    // 2026-09-13 23:30 Shanghai = 2026-09-13 15:30 UTC — the day before the
    // Monday start; must NOT be counted.
    await setTaskDone(env.DB, 1, t4, Date.UTC(2026, 8, 13, 15, 30))
    // 2026-09-21 00:30 Shanghai = 2026-09-20 16:30 UTC — the day after the
    // Sunday end; must NOT be counted either.
    await setTaskDone(env.DB, 1, t5, Date.UTC(2026, 8, 20, 16, 30))
    expect(await countTasksDoneBetween(env.DB, 1, '2026-09-14', '2026-09-20')).toBe(3)
    expect(await countTasksDoneBetween(env.DB, 2, '2026-09-14', '2026-09-20')).toBe(0)
    // Narrowing from = to = the mid-week day pins both ends independently: only t3 qualifies.
    expect(await countTasksDoneBetween(env.DB, 1, '2026-09-16', '2026-09-16')).toBe(1)
  })
})

describe('task targets', () => {
  it('starts empty and updates only the owner’s row', async () => {
    const id = await goal(1, '健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: id, title: '跟练 20 分钟', now: NOW }))!
    expect(await getTask(env.DB, 1, t)).toMatchObject({ goal_id: id, title: '跟练 20 分钟', target: '', target_label: '' })
    expect(await getTask(env.DB, 2, t)).toBeNull()
    expect(await updateTaskTarget(env.DB, 2, t, 'bilibili://', 'B 站')).toBe(false)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: '', target_label: '' })
    expect(await updateTaskTarget(env.DB, 1, t, 'bilibili://', 'B 站')).toBe(true)
    expect(await getTask(env.DB, 1, t)).toMatchObject({ target: 'bilibili://', target_label: 'B 站' })
    expect((await listTasks(env.DB, 1))[0]).toMatchObject({ target: 'bilibili://', target_label: 'B 站' })
  })
})

describe('task check-ins', () => {
  it('writes one row per task per day, is idempotent, and takes it away again', async () => {
    const id = await goal(1, '健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t, '2026-09-14', true, NOW)
    await setTaskCheckin(env.DB, 1, t, '2026-09-14', true, NOW + 1)
    expect(await listTaskCheckins(env.DB, 1, '2026-09-14', '2026-09-14')).toEqual([{ task_id: t, date: '2026-09-14' }])
    await setTaskCheckin(env.DB, 1, t, '2026-09-14', false, NOW)
    expect(await listTaskCheckins(env.DB, 1, '2026-09-14', '2026-09-14')).toEqual([])
  })

  it('refuses a task that belongs to somebody else, writing nothing for either side', async () => {
    const id = await goal(1, '健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    await setTaskCheckin(env.DB, 2, t, '2026-09-14', true, NOW)
    expect(await listTaskCheckins(env.DB, 2, '2026-09-14', '2026-09-14')).toEqual([])
    expect(await listTaskCheckins(env.DB, 1, '2026-09-14', '2026-09-14')).toEqual([])
  })

  it('checks and clears a whole goal at once, touching no other goal', async () => {
    const a = await goal(1, '健身')
    const b = await goal(1, '英语')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: a, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: a, title: '二', now: NOW }))!
    const t3 = (await createTask(env.DB, { userId: 1, goalId: b, title: '三', now: NOW }))!
    await setGoalTaskCheckins(env.DB, 1, a, '2026-09-14', true, NOW)
    const ids = (await listTaskCheckins(env.DB, 1, '2026-09-14', '2026-09-14')).map((r) => r.task_id).sort((x, y) => x - y)
    expect(ids).toEqual([t1, t2].sort((x, y) => x - y))
    await setGoalTaskCheckins(env.DB, 1, b, '2026-09-14', true, NOW)
    await setGoalTaskCheckins(env.DB, 1, a, '2026-09-14', false, NOW)
    expect((await listTaskCheckins(env.DB, 1, '2026-09-14', '2026-09-14')).map((r) => r.task_id)).toEqual([t3])
  })

  it('counts one check-in per task per day, so the same task on two days counts twice', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, '2026-09-14', true, NOW)
    await setTaskCheckin(env.DB, 1, t1, '2026-09-15', true, NOW)
    await setTaskCheckin(env.DB, 1, t2, '2026-09-15', true, NOW)
    expect(await countTaskCheckinsOn(env.DB, 1, '2026-09-14')).toBe(1)
    expect(await countTaskCheckinsOn(env.DB, 1, '2026-09-15')).toBe(2)
    expect(await countTaskCheckinsBetween(env.DB, 1, '2026-09-14', '2026-09-15')).toBe(3)
    expect(await countTaskCheckinsBetween(env.DB, 1, '2026-09-15', '2026-09-15')).toBe(2)
    expect(await countTaskCheckinsBetween(env.DB, 2, '2026-09-14', '2026-09-15')).toBe(0)
  })

  it('keeps the ledger when the task, or the whole goal, is deleted', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, '2026-09-14', true, NOW)
    await setTaskCheckin(env.DB, 1, t2, '2026-09-14', true, NOW)
    expect(await deleteTask(env.DB, 1, t1)).toBe(true)
    expect(await countTaskCheckinsOn(env.DB, 1, '2026-09-14')).toBe(2)
    expect(await deleteGoal(env.DB, 1, id)).toBe(true)
    expect(await countTaskCheckinsOn(env.DB, 1, '2026-09-14')).toBe(2)
  })
})

describe('syncGoalCheckin', () => {
  const DATE = '2026-09-14'

  async function checkedDates(goalId: number): Promise<string[]> {
    const rows = await listCheckins(env.DB, 1, '2026-09-01', '2026-09-30')
    return rows.filter((c) => c.goal_id === goalId).map((c) => c.date)
  }

  it('adds the goal check-in on the last sub-task, and removes it again when one is undone', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, DATE, true, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([])
    await setTaskCheckin(env.DB, 1, t2, DATE, true, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([DATE])
    await setTaskCheckin(env.DB, 1, t1, DATE, false, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([])
  })

  it('drops the check-in when a new sub-task lands under a fully checked goal', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, DATE, true, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([DATE])
    await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW })
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([])
  })

  it('adds the check-in when the last unchecked sub-task is deleted', async () => {
    const id = await goal(1, '健身')
    const t1 = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: id, title: '二', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t1, DATE, true, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([])
    await deleteTask(env.DB, 1, t2)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([DATE])
  })

  it('leaves a goal with no sub-tasks alone, manual check-in and all', async () => {
    const id = await goal(1, '冥想')
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([])
    await toggleCheckin(env.DB, 1, id, DATE, NOW)
    await syncGoalCheckin(env.DB, 1, id, DATE, NOW)
    expect(await checkedDates(id)).toEqual([DATE])
  })

  it('never reaches into another user’s goal', async () => {
    const id = await goal(1, '健身')
    const t = (await createTask(env.DB, { userId: 1, goalId: id, title: '一', now: NOW }))!
    await setTaskCheckin(env.DB, 1, t, DATE, true, NOW)
    await syncGoalCheckin(env.DB, 2, id, DATE, NOW)
    expect(await listCheckins(env.DB, 2, DATE, DATE)).toEqual([])
    expect(await checkedDates(id)).toEqual([])
  })
})
