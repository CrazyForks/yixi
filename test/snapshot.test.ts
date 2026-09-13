import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { snapshotDate, snapshotGoalDays, snapshotUser, SNAPSHOT_CRON } from '../src/snapshot'
import { createGoal, createTask, listGoalDays, setGoalArchived, setTaskDone, toggleCheckin } from '../src/db'

// 2026-09-13 16:00:30 UTC = 2026-09-14 00:00:30 Shanghai → 快照 2026-09-13
const MIDNIGHT = Date.UTC(2026, 8, 13, 16, 0, 30)
const DAY = '2026-09-13'

async function reset(): Promise<void> {
  await env.DB.batch([
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
    expect(snapshotDate(Date.UTC(2026, 8, 13, 4, 0, 0))).toBe(DAY) // 中午跑也是同一天（但中午 cron 不调用它）
  })
})

describe('snapshotUser', () => {
  it('counts shown as the top three live goals on that day, done among them, and tasks done that day', async () => {
    const ids = []
    for (const t of ['一', '二', '三', '四']) ids.push(await createGoal(env.DB, { userId: 1, title: t, cue: '', target: '', targetLabel: '', until: null, now: 0 }))
    await toggleCheckin(env.DB, 1, ids[0]!, DAY, 1)
    await toggleCheckin(env.DB, 1, ids[3]!, DAY, 1) // 第四个不在 shown 里，不算 done
    const t = (await createTask(env.DB, { userId: 1, goalId: ids[0]!, title: 'x', now: 0 }))!
    await setTaskDone(env.DB, 1, t, Date.UTC(2026, 8, 13, 10, 0))
    expect(await snapshotUser(env.DB, 1, DAY)).toMatchObject({ user_id: 1, date: DAY, shown: 3, done: 1, tasks_done: 1 })
  })
  it('judges expiry as of the snapshot day, not today', async () => {
    await createGoal(env.DB, { userId: 1, title: '过期', cue: '', target: '', targetLabel: '', until: '2026-09-12', now: 0 })
    await createGoal(env.DB, { userId: 1, title: '活', cue: '', target: '', targetLabel: '', until: '2026-09-13', now: 0 })
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
