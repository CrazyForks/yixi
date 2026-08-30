import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleGate, handleResolve } from '../src/gate'
import { sha256Hex } from '../src/auth'
import {
  getGraceUntil,
  getSession,
  insertEvent,
  resolveSessionAtomically,
  shanghaiDate,
} from '../src/db'
import type { EventKind, GateDecision } from '../src/types'

const TOKEN = 'alice-token'
const OTHER_TOKEN = 'bob-token'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM grace'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function seedUser(token: string, name = 'alice'): Promise<number> {
  const res = await env.DB.prepare('INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, 0, ?3)')
    .bind(name, await sha256Hex(token), Date.now())
    .run()
  return Number(res.meta.last_row_id)
}

async function seedApp(
  userId: number,
  app: string,
  overrides: { enabled?: number; graceSeconds?: number; waitSeconds?: number } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      userId,
      app,
      app.toUpperCase(),
      `${app}://`,
      overrides.waitSeconds ?? 10,
      overrides.graceSeconds ?? 90,
      overrides.enabled ?? 1,
    )
    .run()
}

async function gate(app: string, token: string): Promise<{ status: number; body: GateDecision & { error?: string } }> {
  const res = await handleGate(
    new Request(`https://yixi.test/gate?app=${encodeURIComponent(app)}&k=${encodeURIComponent(token)}`),
    env,
  )
  return { status: res.status, body: (await res.json()) as GateDecision & { error?: string } }
}

async function resolve(fields: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handleResolve(
    new Request('https://yixi.test/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    }),
    env,
  )
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function kindCounts(userId: number): Promise<Partial<Record<EventKind, number>>> {
  const rows = await env.DB.prepare('SELECT kind, COUNT(*) AS n FROM events WHERE user_id = ?1 GROUP BY kind')
    .bind(userId)
    .all<{ kind: EventKind; n: number }>()
  const out: Partial<Record<EventKind, number>> = {}
  for (const row of rows.results) out[row.kind] = row.n
  return out
}

function sidOf(body: GateDecision): string {
  if (body.action !== 'block') throw new Error(`expected a block decision, got ${body.action}`)
  return new URL(body.url).searchParams.get('s') ?? ''
}

beforeEach(reset)

describe('GET /gate — auth', () => {
  it('401s an unknown token without touching the log', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const res = await gate('xhs', 'not-the-token')

    expect(res.status).toBe(401)
    expect(await kindCounts(userId)).toEqual({})
  })

  it('401s a missing token and 400s a missing app', async () => {
    await seedUser(TOKEN)

    const noToken = await handleGate(new Request('https://yixi.test/gate?app=xhs'), env)
    expect(noToken.status).toBe(401)

    const noApp = await handleGate(new Request(`https://yixi.test/gate?k=${TOKEN}`), env)
    expect(noApp.status).toBe(400)
  })

  it('scopes app config to its owner — one user cannot be gated by another', async () => {
    const alice = await seedUser(TOKEN, 'alice')
    const bob = await seedUser(OTHER_TOKEN, 'bob')
    await seedApp(alice, 'xhs')

    const res = await gate('xhs', OTHER_TOKEN)

    expect(res.body.action).toBe('pass')
    expect(await kindCounts(bob)).toEqual({})
  })
})

describe('GET /gate — decision order', () => {
  it('passes an unconfigured app and records nothing', async () => {
    const userId = await seedUser(TOKEN)

    const res = await gate('unknown-app', TOKEN)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ action: 'pass' })
    // Not watching this app means not logging it either.
    expect(await kindCounts(userId)).toEqual({})
  })

  it('passes a disabled app and records nothing', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs', { enabled: 0 })

    const res = await gate('xhs', TOKEN)

    expect(res.body).toEqual({ action: 'pass' })
    expect(await kindCounts(userId)).toEqual({})
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('passes inside the grace window and records grace_pass, never attempt', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    await env.DB.prepare('INSERT INTO grace (user_id, app, until) VALUES (?1, ?2, ?3)')
      .bind(userId, 'xhs', Date.now() + 60_000)
      .run()

    const res = await gate('xhs', TOKEN)

    expect(res.body).toEqual({ action: 'pass' })
    expect(await kindCounts(userId)).toEqual({ grace_pass: 1 })
  })

  it('blocks once the grace window has lapsed', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    await env.DB.prepare('INSERT INTO grace (user_id, app, until) VALUES (?1, ?2, ?3)')
      .bind(userId, 'xhs', Date.now() - 1)
      .run()

    const res = await gate('xhs', TOKEN)

    expect(res.body.action).toBe('block')
    expect(await kindCounts(userId)).toEqual({ attempt: 1 })
  })

  it('blocks an outside-grace attempt, opening a session bound to this user and app', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const res = await gate('xhs', TOKEN)
    const sid = sidOf(res.body)

    expect(res.status).toBe(200)
    expect(await kindCounts(userId)).toEqual({ attempt: 1 })

    const session = await getSession(env.DB, sid)
    expect(session).toMatchObject({ sid, user_id: userId, app: 'xhs', resolved_at: null })
  })
})

describe('GET /gate — the block URL', () => {
  it('carries the sid and nothing else — never the token', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const res = await gate('xhs', TOKEN)
    if (res.body.action !== 'block') throw new Error('expected block')
    const url = new URL(res.body.url)

    expect(url.pathname).toBe('/b')
    expect([...url.searchParams.keys()]).toEqual(['s'])
    expect(res.body.url).not.toContain(TOKEN)
    expect(res.body.url).not.toContain('k=')
  })

  it('mints a fresh 128-bit sid per interception', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const first = sidOf((await gate('xhs', TOKEN)).body)
    const second = sidOf((await gate('xhs', TOKEN)).body)

    expect(first).toMatch(/^[0-9a-f]{32}$/)
    expect(second).toMatch(/^[0-9a-f]{32}$/)
    expect(first).not.toBe(second)
  })

  it('is uncacheable — a cached decision would silently disable the gate', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const res = await handleGate(new Request(`https://yixi.test/gate?app=xhs&k=${TOKEN}`), env)

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('grace_pass does not pollute attempt counts', () => {
  it('logs the automation re-firing separately from the impulse that caused it', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs', { graceSeconds: 90 })

    // One real impulse, pushed through...
    const sid = sidOf((await gate('xhs', TOKEN)).body)
    await resolve({ sid, action: 'proceed' })

    // ...then the automation firing again three times while we hand control back.
    await gate('xhs', TOKEN)
    await gate('xhs', TOKEN)
    await gate('xhs', TOKEN)

    // The ratio every statistic is built on stays honest: one impulse, one
    // surrender — the three machine re-fires sit in their own bucket.
    expect(await kindCounts(userId)).toEqual({ attempt: 1, proceeded: 1, grace_pass: 3 })
  })

  it('intercepts again once grace lapses, with a new session', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs', { graceSeconds: 90 })

    const firstSid = sidOf((await gate('xhs', TOKEN)).body)
    await resolve({ sid: firstSid, action: 'proceed' })
    expect((await gate('xhs', TOKEN)).body.action).toBe('pass')

    await env.DB.prepare('UPDATE grace SET until = ?1 WHERE user_id = ?2').bind(Date.now() - 1, userId).run()
    const second = await gate('xhs', TOKEN)

    expect(second.body.action).toBe('block')
    expect(sidOf(second.body)).not.toBe(firstSid)
    expect(await kindCounts(userId)).toEqual({ attempt: 2, proceeded: 1, grace_pass: 1 })
  })
})

describe('POST /resolve', () => {
  it('rejects an unknown sid and logs nothing', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    const res = await resolve({ sid: 'ffffffffffffffffffffffffffffffff', action: 'proceed' })

    expect(res.status).toBe(401)
    expect(await kindCounts(userId)).toEqual({})
  })

  it('rejects a malformed body', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    const sid = sidOf((await gate('xhs', TOKEN)).body)

    expect((await resolve({ sid, action: 'maybe' })).status).toBe(400)
    expect((await resolve({ action: 'proceed' })).status).toBe(400)
    expect(await kindCounts(userId)).toEqual({ attempt: 1 })
  })

  it('records proceeded and opens a grace window of the app configured length', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs', { graceSeconds: 5 })
    const sid = sidOf((await gate('xhs', TOKEN)).body)

    const before = Date.now()
    const res = await resolve({ sid, action: 'proceed' })
    const after = Date.now()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(await kindCounts(userId)).toEqual({ attempt: 1, proceeded: 1 })

    const until = await getGraceUntil(env.DB, userId, 'xhs')
    expect(until).not.toBeNull()
    expect(until).toBeGreaterThanOrEqual(before + 5000)
    expect(until).toBeLessThanOrEqual(after + 5000)

    expect((await getSession(env.DB, sid))?.resolved_at).not.toBeNull()
  })

  it('records abandoned and opens no grace window', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    const sid = sidOf((await gate('xhs', TOKEN)).body)

    await resolve({ sid, action: 'abandon' })

    expect(await kindCounts(userId)).toEqual({ attempt: 1, abandoned: 1 })
    expect(await getGraceUntil(env.DB, userId, 'xhs')).toBeNull()
  })

  // The guard on the writes must key off the session's prior state, not off a
  // timestamp the caller staked. Two resolutions of one session really can land
  // in the same millisecond, and a timestamp guard silently lets the loser
  // write an event the winner had already settled. The contradicting-decision
  // test above only catches this when the suite happens to run fast enough to
  // collide, so pin it here with an explicitly shared `ts`.
  it('rejects a second decision that shares the winner\'s millisecond', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    const sid = sidOf((await gate('xhs', TOKEN)).body)
    const ts = 1_800_000_000_000

    const first = await resolveSessionAtomically(env.DB, {
      sid,
      userId,
      app: 'xhs',
      kind: 'abandoned',
      ts,
      graceUntil: null,
    })
    const second = await resolveSessionAtomically(env.DB, {
      sid,
      userId,
      app: 'xhs',
      kind: 'proceeded',
      ts,
      graceUntil: ts + 90_000,
    })

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(await kindCounts(userId)).toEqual({ attempt: 1, abandoned: 1 })
    expect(await getGraceUntil(env.DB, userId, 'xhs')).toBeNull()
  })

  it('is idempotent: a resent beacon logs nothing new and does not extend grace', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs', { graceSeconds: 90 })
    const sid = sidOf((await gate('xhs', TOKEN)).body)

    const first = await resolve({ sid, action: 'proceed' })
    const untilAfterFirst = await getGraceUntil(env.DB, userId, 'xhs')
    const second = await resolve({ sid, action: 'proceed' })
    const third = await resolve({ sid, action: 'proceed' })

    expect(first.body).toEqual({ ok: true })
    expect(second.body).toEqual({ ok: true, duplicate: true })
    expect(third.body).toEqual({ ok: true, duplicate: true })
    expect(second.status).toBe(200)
    expect(await kindCounts(userId)).toEqual({ attempt: 1, proceeded: 1 })
    expect(await getGraceUntil(env.DB, userId, 'xhs')).toBe(untilAfterFirst)
  })

  it('lets the first decision stand when a second one contradicts it', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    const sid = sidOf((await gate('xhs', TOKEN)).body)

    await resolve({ sid, action: 'abandon' })
    await resolve({ sid, action: 'proceed' })

    expect(await kindCounts(userId)).toEqual({ attempt: 1, abandoned: 1 })
    expect(await getGraceUntil(env.DB, userId, 'xhs')).toBeNull()
  })

  it('still opens a grace window when the app was disabled mid-session', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')
    const sid = sidOf((await gate('xhs', TOKEN)).body)
    await env.DB.prepare('DELETE FROM user_apps WHERE user_id = ?1').bind(userId).run()

    await resolve({ sid, action: 'proceed' })

    // Without a window the return jump would be intercepted and loop forever,
    // so this falls back to the default rather than skipping grace.
    expect(await getGraceUntil(env.DB, userId, 'xhs')).toBeGreaterThan(Date.now())
  })
})

describe('event dates are Asia/Shanghai calendar days', () => {
  it('rolls over at 16:00 UTC, not at midnight UTC', () => {
    expect(shanghaiDate(Date.UTC(2026, 7, 30, 15, 59, 59))).toBe('2026-08-30')
    expect(shanghaiDate(Date.UTC(2026, 7, 30, 16, 0, 0))).toBe('2026-08-31')
    // Still the previous evening locally, though UTC has already turned over.
    expect(shanghaiDate(Date.UTC(2026, 7, 30, 0, 30, 0))).toBe('2026-08-30')
  })

  it('stores the local day on the row, not the UTC one', async () => {
    const userId = await seedUser(TOKEN)
    // 2026-08-30 23:30 in Shanghai — the 31st in UTC terms would be wrong, and
    // "how many times did I open it last night" would land on the wrong day.
    const ts = Date.UTC(2026, 7, 30, 15, 30, 0)
    await insertEvent(env.DB, { userId, sid: 'a'.repeat(32), app: 'xhs', kind: 'attempt', ts })

    const row = await env.DB.prepare('SELECT date, ts FROM events WHERE user_id = ?1')
      .bind(userId)
      .first<{ date: string; ts: number }>()

    expect(row?.date).toBe('2026-08-30')
    expect(row?.ts).toBe(ts)

    // ...and 40 minutes later it is the next day, mid-evening in UTC.
    await insertEvent(env.DB, {
      userId,
      sid: 'b'.repeat(32),
      app: 'xhs',
      kind: 'attempt',
      ts: Date.UTC(2026, 7, 30, 16, 10, 0),
    })
    const dates = await env.DB.prepare('SELECT date FROM events WHERE user_id = ?1 ORDER BY ts')
      .bind(userId)
      .all<{ date: string }>()
    expect(dates.results.map((r) => r.date)).toEqual(['2026-08-30', '2026-08-31'])
  })

  it('dates a gate-written event by the same rule', async () => {
    const userId = await seedUser(TOKEN)
    await seedApp(userId, 'xhs')

    await gate('xhs', TOKEN)

    const row = await env.DB.prepare('SELECT date, ts FROM events WHERE user_id = ?1')
      .bind(userId)
      .first<{ date: string; ts: number }>()
    expect(row?.date).toBe(shanghaiDate(row!.ts))
  })
})
