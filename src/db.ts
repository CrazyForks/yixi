import type { EventKind, Session, User, UserApp } from './types'

/**
 * Every D1 statement in the app lives here. Callers pass the binding itself
 * (`env.DB`) rather than the whole Env, so nothing in this file can reach for a
 * secret by accident.
 */

// --- calendar day ---------------------------------------------------------

// "Which day was this" is a question about the user's life, not about UTC — a
// 00:30 relapse belongs to the night it happened, not to the previous
// afternoon. Locale en-CA renders as YYYY-MM-DD, which sorts and compares as a
// plain string, so no date library is needed.
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function shanghaiDate(ts: number): string {
  return DAY_FORMATTER.format(new Date(ts))
}

// --- users ----------------------------------------------------------------

/**
 * A user row with the credential column still attached. Only auth.ts asks for
 * this shape, and only so it can re-compare the hash in constant time; every
 * other caller takes the plain `User`.
 */
export interface StoredUser extends User {
  token_hash: string
}

export async function findUserByTokenHash(db: D1Database, tokenHash: string): Promise<StoredUser | null> {
  return await db
    .prepare('SELECT id, name, is_owner, created_at, token_hash FROM users WHERE token_hash = ?1')
    .bind(tokenHash)
    .first<StoredUser>()
}

export async function getUserById(db: D1Database, id: number): Promise<User | null> {
  return await db
    .prepare('SELECT id, name, is_owner, created_at FROM users WHERE id = ?1')
    .bind(id)
    .first<User>()
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const res = await db
    .prepare('SELECT id, name, is_owner, created_at FROM users ORDER BY id')
    .all<User>()
  return res.results
}

export async function createUser(
  db: D1Database,
  u: { name: string; tokenHash: string; isOwner?: boolean; createdAt?: number },
): Promise<number> {
  const res = await db
    .prepare('INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(u.name, u.tokenHash, u.isOwner ? 1 : 0, u.createdAt ?? Date.now())
    .run()
  return Number(res.meta.last_row_id)
}

// --- user_apps ------------------------------------------------------------

export async function getUserApp(db: D1Database, userId: number, app: string): Promise<UserApp | null> {
  return await db
    .prepare(
      `SELECT user_id, app, label, scheme, wait_seconds, grace_seconds, enabled
       FROM user_apps WHERE user_id = ?1 AND app = ?2`,
    )
    .bind(userId, app)
    .first<UserApp>()
}

export async function listUserApps(db: D1Database, userId: number): Promise<UserApp[]> {
  const res = await db
    .prepare(
      `SELECT user_id, app, label, scheme, wait_seconds, grace_seconds, enabled
       FROM user_apps WHERE user_id = ?1 ORDER BY app`,
    )
    .bind(userId)
    .all<UserApp>()
  return res.results
}

export async function upsertUserApp(db: D1Database, row: UserApp): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (user_id, app) DO UPDATE SET
         label = excluded.label, scheme = excluded.scheme,
         wait_seconds = excluded.wait_seconds, grace_seconds = excluded.grace_seconds,
         enabled = excluded.enabled`,
    )
    .bind(row.user_id, row.app, row.label, row.scheme, row.wait_seconds, row.grace_seconds, row.enabled)
    .run()
}

export async function deleteUserApp(db: D1Database, userId: number, app: string): Promise<void> {
  await db.prepare('DELETE FROM user_apps WHERE user_id = ?1 AND app = ?2').bind(userId, app).run()
}

// --- sessions -------------------------------------------------------------

export async function createSession(
  db: D1Database,
  s: { sid: string; userId: number; app: string; createdAt: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO sessions (sid, user_id, app, created_at, resolved_at) VALUES (?1, ?2, ?3, ?4, NULL)')
    .bind(s.sid, s.userId, s.app, s.createdAt)
    .run()
}

export async function getSession(db: D1Database, sid: string): Promise<Session | null> {
  return await db
    .prepare('SELECT sid, user_id, app, created_at, resolved_at FROM sessions WHERE sid = ?1')
    .bind(sid)
    .first<Session>()
}

/**
 * Claims a session for exactly one resolution and reports whether this caller
 * won. The `resolved_at IS NULL` guard lives inside the UPDATE rather than in a
 * read-then-write, because /resolve is hit by `sendBeacon` — retried by the
 * browser, and fired again by a double tap — and two concurrent claims that
 * both saw NULL would otherwise both log an event. This one statement is the
 * whole idempotency mechanism.
 */
export async function resolveSessionOnce(db: D1Database, sid: string, resolvedAt: number): Promise<boolean> {
  const res = await db
    .prepare('UPDATE sessions SET resolved_at = ?2 WHERE sid = ?1 AND resolved_at IS NULL')
    .bind(sid, resolvedAt)
    .run()
  return (res.meta.changes ?? 0) > 0
}

/**
 * Sessions are write-once breadcrumbs; only `events` is worth keeping. Trimming
 * resolved and long-abandoned ones keeps the table from growing without bound.
 * Never touches `events` — that history is the entire point of the product.
 */
export async function deleteStaleSessions(db: D1Database, olderThan: number): Promise<number> {
  const res = await db.prepare('DELETE FROM sessions WHERE created_at < ?1').bind(olderThan).run()
  return res.meta.changes ?? 0
}

// --- events ---------------------------------------------------------------


export async function insertEvent(
  db: D1Database,
  e: { userId: number; sid: string; app: string; kind: EventKind; ts: number },
): Promise<void> {
  await db
    .prepare('INSERT INTO events (user_id, sid, app, kind, ts, date) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(e.userId, e.sid, e.app, e.kind, e.ts, shanghaiDate(e.ts))
    .run()
}

/** Totals per event kind over an inclusive YYYY-MM-DD range. */
export async function countEventsByKind(
  db: D1Database,
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<Record<string, number>> {
  const res = await db
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM events
       WHERE user_id = ?1 AND date >= ?2 AND date <= ?3
       GROUP BY kind`,
    )
    .bind(userId, fromDate, toDate)
    .all<{ kind: EventKind; n: number }>()
  const out: Record<string, number> = {}
  for (const row of res.results) out[row.kind] = row.n
  return out
}

/** One row per (day, kind) with at least one event — sparse, callers fill gaps. */
export async function countEventsByDay(
  db: D1Database,
  userId: number,
  fromDate: string,
  toDate: string,
): Promise<{ date: string; kind: EventKind; n: number }[]> {
  const res = await db
    .prepare(
      `SELECT date, kind, COUNT(*) AS n FROM events
       WHERE user_id = ?1 AND date >= ?2 AND date <= ?3
       GROUP BY date, kind ORDER BY date`,
    )
    .bind(userId, fromDate, toDate)
    .all<{ date: string; kind: EventKind; n: number }>()
  return res.results
}


/**
 * Per-user counts for the owner's /admin page. Deliberately returns counts and
 * nothing else — no timestamps, no app names, no rows. The privacy line in the
 * design ("the owner cannot read anyone's log") is enforced by there being no
 * query here that could return one, not by the caller remembering not to ask.
 */
/**
 * Per-user attempt counts for the owner's /admin roster — how many impulses each
 * token has seen, and nothing else.
 *
 * `proceeded` and `abandoned` are deliberately absent. Those two yield somebody
 * else's abandon rate, which is a portrait of their self-control rather than a
 * sign of life, and /admin has no business rendering it. Keeping them out of the
 * SQL (rather than dropping them at the render layer) means no future caller can
 * reintroduce them by accident — the query simply cannot produce them.
 */
export async function countAttemptsPerUser(
  db: D1Database,
  fromDate: string,
): Promise<{ user_id: number; name: string; attempts: number }[]> {
  const res = await db
    .prepare(
      `SELECT u.id AS user_id, u.name AS name,
              COALESCE(SUM(e.kind = 'attempt'), 0) AS attempts
       FROM users u
       LEFT JOIN events e ON e.user_id = u.id AND e.date >= ?1
       GROUP BY u.id, u.name ORDER BY u.id`,
    )
    .bind(fromDate)
    .all<{ user_id: number; name: string; attempts: number }>()
  return res.results
}

/**
 * Records a resolution — the event, and for proceed the grace window — and
 * claims the session, all in one D1 transaction. Returns whether this caller
 * won the claim.
 *
 * Splitting these was the one real hazard in this flow. A standalone claim
 * commits on its own, so a transient D1 failure on a following statement left
 * the session marked resolved with no grace row, and every retry then
 * short-circuits as a duplicate and never repairs it. The user taps 继续, lands
 * back in the app, and is intercepted again immediately: exactly the loop grace
 * exists to prevent.
 *
 * The writes come first and each guards on `resolved_at IS NULL`; the claim is
 * last. Statements in a batch run sequentially in a single transaction, so
 * either the whole decision lands or none of it does. Guarding on the prior
 * state rather than on a timestamp this call staked matters: two resolutions of
 * one session can share a millisecond, and a timestamp guard then lets the
 * second one write an event the first had already settled.
 */
export async function resolveSessionAtomically(
  db: D1Database,
  r: {
    sid: string
    userId: number
    app: string
    kind: EventKind
    ts: number
    /** Absolute epoch ms the grace window should run to, or null to skip it. */
    graceUntil: number | null
  },
): Promise<boolean> {
  const unresolved = `(SELECT resolved_at FROM sessions WHERE sid = ?1) IS NULL`

  const statements = [
    db
      .prepare(
        `INSERT INTO events (user_id, sid, app, kind, ts, date)
         SELECT ?2, ?1, ?3, ?4, ?5, ?6 WHERE ${unresolved}`,
      )
      .bind(r.sid, r.userId, r.app, r.kind, r.ts, shanghaiDate(r.ts)),
  ]

  if (r.graceUntil !== null) {
    statements.push(
      db
        .prepare(
          `INSERT INTO grace (user_id, app, until)
           SELECT ?2, ?3, ?4 WHERE ${unresolved}
           ON CONFLICT (user_id, app) DO UPDATE SET until = excluded.until`,
        )
        .bind(r.sid, r.userId, r.app, r.graceUntil),
    )
  }

  statements.push(
    db
      .prepare('UPDATE sessions SET resolved_at = ?2 WHERE sid = ?1 AND resolved_at IS NULL')
      .bind(r.sid, r.ts),
  )

  const results = await db.batch(statements)
  return (results[results.length - 1]?.meta.changes ?? 0) > 0
}

// --- grace ----------------------------------------------------------------

export async function getGraceUntil(db: D1Database, userId: number, app: string): Promise<number | null> {
  const row = await db
    .prepare('SELECT until FROM grace WHERE user_id = ?1 AND app = ?2')
    .bind(userId, app)
    .first<{ until: number }>()
  return row ? row.until : null
}

export async function setGrace(db: D1Database, userId: number, app: string, until: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO grace (user_id, app, until) VALUES (?1, ?2, ?3)
       ON CONFLICT (user_id, app) DO UPDATE SET until = excluded.until`,
    )
    .bind(userId, app, until)
    .run()
}
