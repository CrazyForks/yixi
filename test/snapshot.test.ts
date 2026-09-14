import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { snapshotDate, snapshotGoalDays, snapshotUser, SNAPSHOT_CRON } from '../src/snapshot'
import { createGoal, createTask, listGoalDays, setGoalArchived, setTaskCheckin, toggleCheckin } from '../src/db'

// Fixture date picked far from the real date on purpose, so this file never
// coincidentally passes only because it happens to run on 2031-03-09.
// 2031-03-09 16:00:30 UTC = 2031-03-10 00:00:30 Shanghai → 快照 2031-03-09
const MIDNIGHT = Date.UTC(2031, 2, 9, 16, 0, 30)
const DAY = '2031-03-09'

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

describe('snapshotDate', () => {
  it('names the day that just ended', () => {
    expect(snapshotDate(MIDNIGHT)).toBe(DAY)
    expect(snapshotDate(Date.UTC(2031, 2, 9, 4, 0, 0))).toBe(DAY) // 中午跑也是同一天（但中午 cron 不调用它）
  })
  it('names the same day at exactly 16:00:00.000 UTC, the instant the cron itself fires', () => {
    expect(snapshotDate(Date.UTC(2031, 2, 9, 16, 0, 0))).toBe(DAY)
  })
})

describe('snapshotUser', () => {
  it('counts shown as the top three live goals on that day, done among them, and sub-task check-ins that day', async () => {
    const ids = []
    for (const t of ['一', '二', '三', '四']) ids.push(await createGoal(env.DB, { userId: 1, title: t, cue: '', target: '', targetLabel: '', until: null, now: 0 }))
    await toggleCheckin(env.DB, 1, ids[0]!, DAY, 1)
    await toggleCheckin(env.DB, 1, ids[3]!, DAY, 1) // 第四个不在 shown 里，不算 done
    const t = (await createTask(env.DB, { userId: 1, goalId: ids[0]!, title: 'x', now: 0 }))!
    await setTaskCheckin(env.DB, 1, t, DAY, true, Date.UTC(2031, 2, 9, 10, 0))
    expect(await snapshotUser(env.DB, 1, DAY)).toMatchObject({ user_id: 1, date: DAY, shown: 3, done: 1, tasks_done: 1 })
  })

  it('counts check-ins, not finished tasks: the same task on two days is two, and a fourth goal’s task still counts', async () => {
    const ids = []
    for (const t of ['一', '二', '三', '四']) ids.push(await createGoal(env.DB, { userId: 1, title: t, cue: '', target: '', targetLabel: '', until: null, now: 0 }))
    const t1 = (await createTask(env.DB, { userId: 1, goalId: ids[0]!, title: 'x', now: 0 }))!
    const t2 = (await createTask(env.DB, { userId: 1, goalId: ids[3]!, title: 'y', now: 0 }))!
    await setTaskCheckin(env.DB, 1, t1, DAY, true, 1)
    await setTaskCheckin(env.DB, 1, t1, '2031-03-10', true, 1) // 第二天的那一次不算进 DAY
    await setTaskCheckin(env.DB, 1, t2, DAY, true, 1)
    expect((await snapshotUser(env.DB, 1, DAY)).tasks_done).toBe(2)
    expect((await snapshotUser(env.DB, 2, DAY)).tasks_done).toBe(0)
  })

  it('judges expiry as of the snapshot day, not today', async () => {
    await createGoal(env.DB, { userId: 1, title: '过期', cue: '', target: '', targetLabel: '', until: '2031-03-08', now: 0 })
    await createGoal(env.DB, { userId: 1, title: '活', cue: '', target: '', targetLabel: '', until: '2031-03-09', now: 0 })
    expect((await snapshotUser(env.DB, 1, DAY)).shown).toBe(1)
  })
  it('ignores archived goals', async () => {
    const a = await createGoal(env.DB, { userId: 1, title: 'a', cue: '', target: '', targetLabel: '', until: null, now: 0 })
    await createGoal(env.DB, { userId: 1, title: 'b', cue: '', target: '', targetLabel: '', until: null, now: 0 })
    await setGoalArchived(env.DB, 1, a, 1)
    expect((await snapshotUser(env.DB, 1, DAY)).shown).toBe(1)
  })
})

describe('snapshotGoalDays', () => {
  it('writes one row per user with live goals, is idempotent, and skips users without goals', async () => {
    await createGoal(env.DB, { userId: 1, title: 'a', cue: '', target: '', targetLabel: '', until: null, now: 0 })
    const r1 = await snapshotGoalDays(env.DB, MIDNIGHT)
    expect(r1).toEqual({ date: DAY, users: 1, failed: 0 })
    const r2 = await snapshotGoalDays(env.DB, MIDNIGHT)
    expect(r2.users).toBe(1)
    expect(await listGoalDays(env.DB, 1, DAY, DAY)).toHaveLength(1)
    expect(await listGoalDays(env.DB, 2, DAY, DAY)).toEqual([])
  })
})

describe('scheduled()', () => {
  it('runs the snapshot only on the midnight cron and the trim only on the noon cron', async () => {
    await createGoal(env.DB, { userId: 1, title: 'a', cue: '', target: '', targetLabel: '', until: null, now: 0 })
    const ev = (cron: string) => ({ cron, scheduledTime: MIDNIGHT, noRetry() {} }) as unknown as ScheduledController
    await worker.scheduled(ev('0 4 * * *'), env, {} as ExecutionContext)
    expect(await listGoalDays(env.DB, 1, DAY, DAY)).toEqual([])
    await worker.scheduled(ev(SNAPSHOT_CRON), env, {} as ExecutionContext)
    expect(await listGoalDays(env.DB, 1, DAY, DAY)).toHaveLength(1)
  })
})
