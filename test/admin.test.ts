// The acceptance criterion for /admin is not "it lists users". It is that the
// owner cannot read anyone's log — see the header comment in src/api/admin.ts.
// The 「隐私红线」 block below is the test that has to keep passing forever; the
// rest is ordinary coverage of the ticket window.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleAdmin } from '../src/api/admin'
import { sha256Hex, userFromToken } from '../src/auth'
import { insertEvent } from '../src/db'
import type { EventKind, User } from '../src/types'

const DAY_MS = 86400000

// Values chosen so that finding any of them in the rendered page is
// unambiguous evidence of a leak — none of them can appear by coincidence.
const SECRET_APP = 'secretapp'
const SECRET_LABEL = 'FRIEND_SECRET_LABEL'
const SECRET_SID = 'sid-friend-secret-0001'
const SECRET_SCHEME = 'friendsecretscheme://'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM grace'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function seedUser(
  name: string,
  opts: { token?: string; isOwner?: boolean; email?: string } = {},
): Promise<User> {
  const createdAt = Date.now()
  const res = await env.DB.prepare(
    'INSERT INTO users (name, token_hash, is_owner, created_at, email) VALUES (?1, ?2, ?3, ?4, ?5)',
  )
    .bind(
      name,
      await sha256Hex(opts.token ?? `${name}-token`),
      opts.isOwner ? 1 : 0,
      createdAt,
      opts.email ?? null,
    )
    .run()
  return { id: Number(res.meta.last_row_id), name, is_owner: opts.isOwner ? 1 : 0, created_at: createdAt }
}

async function seedApp(userId: number, app: string, label: string, scheme: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1, ?2, ?3, ?4, 10, 90, 1)`,
  )
    .bind(userId, app, label, scheme)
    .run()
}

async function seedEvent(userId: number, kind: EventKind, ts: number, app = SECRET_APP, sid = SECRET_SID): Promise<void> {
  await insertEvent(env.DB, { userId, sid, app, kind, ts })
}

function get(path: string, user: User): Promise<Response> {
  return handleAdmin(new Request(`https://yixi.test${path}`), env, user)
}

function post(path: string, user: User, fields: Record<string, string>): Promise<Response> {
  return handleAdmin(
    new Request(`https://yixi.test${path}`, { method: 'POST', body: new URLSearchParams(fields) }),
    env,
    user,
  )
}

async function countUsers(): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  return row?.n ?? 0
}

beforeEach(reset)

// ---------------------------------------------------------------------------

describe('隐私红线：owner 拿不到他人的 events 明细', () => {
  /**
   * A friend with a full, distinctive history: three genuine impulses, one of
   * which they pushed through, one they backed out of, plus a grace_pass and an
   * event outside the reporting window.
   */
  async function seedFriendWithHistory(): Promise<{ owner: User; friend: User; eventTs: number }> {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    const friend = await seedUser('老王', { token: 'friend-token' })
    await seedApp(friend.id, SECRET_APP, SECRET_LABEL, SECRET_SCHEME)

    const eventTs = Date.now() - 3 * 3600000
    await seedEvent(friend.id, 'attempt', eventTs)
    await seedEvent(friend.id, 'attempt', eventTs + 1000)
    await seedEvent(friend.id, 'attempt', eventTs + 2000)
    await seedEvent(friend.id, 'proceeded', eventTs + 3000)
    await seedEvent(friend.id, 'abandoned', eventTs + 4000)
    await seedEvent(friend.id, 'grace_pass', eventTs + 5000)
    await seedEvent(friend.id, 'attempt', Date.now() - 30 * DAY_MS)
    return { owner, friend, eventTs }
  }

  it('never renders another account\'s email address', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true, email: 'owner@example.com' })
    await seedUser('老王', { token: 'friend-token', email: 'laowang-private@example.com' })

    const html = await (await get('/admin', owner)).text()

    // Accounts put a new piece of PII on the users table, and the same rule that
    // keeps somebody else's abandon rate off this page covers their email. The
    // roster answers "is this token being used", nothing more.
    expect(html).not.toContain('laowang-private@example.com')
    expect(html).not.toContain('@example.com')
  })

  it('渲染聚合计数，但页面里没有任何一条 event 明细', async () => {
    const { owner, friend, eventTs } = await seedFriendWithHistory()

    const res = await get('/admin', owner)
    expect(res.status).toBe(200)
    const body = await res.text()

    // The aggregate the owner is allowed to have: three attempts in-window.
    expect(body).toContain('老王')
    expect(body).toContain('data-count="3"')

    // Everything that makes up an event. Any one of these appearing means the
    // page has started reporting on someone's behaviour, not their setup.
    expect(body).not.toContain(SECRET_APP)
    expect(body).not.toContain(SECRET_LABEL)
    expect(body).not.toContain(SECRET_SID)
    expect(body).not.toContain(SECRET_SCHEME)
    expect(body).not.toContain(String(eventTs))
    for (const kind of ['attempt', 'grace_pass', 'proceeded', 'abandoned']) {
      expect(body).not.toContain(kind)
    }
    // Nor a per-event marker of any kind.
    expect(body).not.toMatch(/data-(app|sid|ts|kind|date|event)=/)
  })

  it('不泄漏他人的 proceeded / abandoned —— 有了这两个数就能算出别人的放弃率', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    const friend = await seedUser('老王', { token: 'friend-token' })

    // Counts chosen to be distinguishable from each other and from the attempt
    // count, so a leak cannot hide behind a coincidence.
    for (let i = 0; i < 3; i++) await seedEvent(friend.id, 'attempt', Date.now())
    for (let i = 0; i < 17; i++) await seedEvent(friend.id, 'proceeded', Date.now())
    for (let i = 0; i < 23; i++) await seedEvent(friend.id, 'abandoned', Date.now())

    const body = await (await get('/admin', owner)).text()

    // The only per-user figures on the page are the attempt counts — 0 for the
    // owner, 3 for 老王 — and nothing else. Rendering proceeded/abandoned would
    // hand the owner someone's 放弃率, which is a portrait of their willpower,
    // not a sign their Shortcut is wired up.
    const rendered = [...body.matchAll(/data-count="(\d+)"/g)].map((m) => Number(m[1]))
    expect(rendered).toEqual([0, 3])

    expect(body).not.toContain('data-count="17"')
    expect(body).not.toContain('data-count="23"')
    // The vocabulary /review uses for exactly those two figures. If someone
    // later adds them here, they will almost certainly bring these words along.
    for (const word of ['忍住', '进去了', '放弃率']) {
      expect(body, `/admin 不该出现「${word}」`).not.toContain(word)
    }
  })

  it('每个用户只出现一个计数，页面里没有逐条记录', async () => {
    const { owner } = await seedFriendWithHistory()

    const body = await (await get('/admin', owner)).text()
    // Two users seeded => exactly two counts. A per-event render would emit far
    // more than one number per person.
    expect(body.match(/data-count="/g)?.length).toBe(2)
  })

  it('grace_pass 不进计数 —— 机器噪音不能算成朋友的一次冲动', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    const friend = await seedUser('老王', { token: 'friend-token' })
    await seedEvent(friend.id, 'attempt', Date.now())
    for (let i = 0; i < 9; i++) await seedEvent(friend.id, 'grace_pass', Date.now())

    const body = await (await get('/admin', owner)).text()
    expect(body).toContain('data-count="1"')
    expect(body).not.toContain('data-count="10"')
  })

  it('窗口之外的记录不计入', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    const friend = await seedUser('老王', { token: 'friend-token' })
    await seedEvent(friend.id, 'attempt', Date.now() - 30 * DAY_MS)

    const body = await (await get('/admin', owner)).text()
    expect(body).toContain('data-count="0"')
  })

  it('owner 自己的明细同样不出现 —— 这一页对所有人一视同仁', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    await seedApp(owner.id, 'ownerapp', 'OWNER_SECRET_LABEL', 'ownersecret://')
    await seedEvent(owner.id, 'attempt', Date.now(), 'ownerapp', 'sid-owner-secret')

    const body = await (await get('/admin', owner)).text()
    expect(body).toContain('data-count="1"')
    expect(body).not.toContain('ownerapp')
    expect(body).not.toContain('OWNER_SECRET_LABEL')
    expect(body).not.toContain('sid-owner-secret')
  })

  it('猜不出一个能读明细的地址 —— /admin 下只有一个 GET', async () => {
    const { owner } = await seedFriendWithHistory()

    for (const path of [
      '/admin/events',
      '/admin/events?user=2',
      '/admin/users',
      '/admin/users/2',
      '/admin/review/2',
      '/admin/export',
      '/admin/',
    ]) {
      const res = await get(path, owner)
      expect(res.status, `${path} 必须 404`).toBe(404)
      expect(await res.text()).not.toContain(SECRET_APP)
    }
  })

  it('token hash 不出现在页面上', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    await seedUser('老王', { token: 'friend-token' })

    const body = await (await get('/admin', owner)).text()
    expect(body).not.toContain(await sha256Hex('friend-token'))
    expect(body).not.toContain(await sha256Hex('owner-token'))
  })
})

// ---------------------------------------------------------------------------

describe('访问控制', () => {
  it('非 owner 访问 /admin 一律 403', async () => {
    const friend = await seedUser('老王')
    for (const path of ['/admin', '/admin/users', '/admin/events', '/admin/anything']) {
      const res = await get(path, friend)
      expect(res.status, `${path} 必须 403`).toBe(403)
    }
  })

  it('非 owner 不能 POST 建人，也不会留下任何副作用', async () => {
    const friend = await seedUser('老王')
    const before = await countUsers()

    const res = await post('/admin/users', friend, { name: '偷偷加的' })
    expect(res.status).toBe(403)
    expect(await countUsers()).toBe(before)
  })

  it('403 页面不泄漏用户名单', async () => {
    await seedUser('owner', { token: 'owner-token', isOwner: true })
    const friend = await seedUser('老王')
    await seedUser('隔壁老李')

    const body = await (await get('/admin', friend)).text()
    expect(body).not.toContain('隔壁老李')
  })

  it('owner 访问未知路径是 404，不是 500', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    expect((await get('/admin/nope', owner)).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------

describe('发号', () => {
  it('建人并把明文 token 只显示这一次', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })

    const res = await post('/admin/users', owner, { name: '老王' })
    expect(res.status).toBe(200)
    // The plaintext must never be replayable from a cache.
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = await res.text()
    const token = body.match(/\b[0-9a-f]{32}\b/)?.[0]
    expect(token, '页面上应该有一个 128-bit 十六进制 token').toBeDefined()

    // Second load of the page never shows it again.
    const again = await (await get('/admin', owner)).text()
    expect(again).not.toContain(token as string)
  })

  it('库里只存 SHA-256，不存明文', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })

    const body = await (await post('/admin/users', owner, { name: '老王' })).text()
    const token = body.match(/\b[0-9a-f]{32}\b/)?.[0] as string

    const row = await env.DB.prepare('SELECT token_hash FROM users WHERE name = ?1')
      .bind('老王')
      .first<{ token_hash: string }>()
    expect(row?.token_hash).toBe(await sha256Hex(token))
    expect(row?.token_hash).not.toBe(token)
  })

  it('发出去的 token 真的能认证成那个人，而且不是 owner', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })

    const body = await (await post('/admin/users', owner, { name: '老王' })).text()
    const token = body.match(/\b[0-9a-f]{32}\b/)?.[0] as string

    const user = await userFromToken(env, token)
    expect(user?.name).toBe('老王')
    expect(user?.is_owner).toBe(0)
  })

  it('两次发号给出不同的 token', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })

    const a = (await (await post('/admin/users', owner, { name: 'a' })).text()).match(/\b[0-9a-f]{32}\b/)?.[0]
    const b = (await (await post('/admin/users', owner, { name: 'b' })).text()).match(/\b[0-9a-f]{32}\b/)?.[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    expect(a).not.toBe(b)
  })

  it('名字空着就 400，不建人', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    const before = await countUsers()

    for (const name of ['', '   ']) {
      const res = await post('/admin/users', owner, { name })
      expect(res.status).toBe(400)
    }
    expect(await countUsers()).toBe(before)
  })

  it('新建的人默认列在名单里，计数为 0', async () => {
    const owner = await seedUser('owner', { token: 'owner-token', isOwner: true })
    await post('/admin/users', owner, { name: '老王' })

    const body = await (await get('/admin', owner)).text()
    expect(body).toContain('老王')
    expect(body).toContain('data-count="0"')
  })
})
