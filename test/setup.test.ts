import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { renderSetup } from '../src/ui/setup'
import type { User } from '../src/types'

const BASE = 'https://yixi.example.workers.dev'

async function reset(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_apps'), env.DB.prepare('DELETE FROM users')])
}

async function seedUser(name = 'alice', isOwner = 0): Promise<User> {
  const res = await env.DB.prepare(
    'INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(name, `hash-of-${name}`, isOwner, 1_700_000_000_000)
    .run()
  return { id: Number(res.meta.last_row_id), name, is_owner: isOwner, created_at: 1_700_000_000_000 }
}

async function seedApp(userId: number, app: string, label: string, enabled = 1): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1, ?2, ?3, 'x://', 10, 90, ?4)`,
  )
    .bind(userId, app, label, enabled)
    .run()
}

async function render(user: User, query = ''): Promise<string> {
  const res = await renderSetup(new Request(`${BASE}/setup${query}`), env, user)
  expect(res.status).toBe(200)
  return await res.text()
}

describe('/setup', () => {
  beforeEach(reset)

  it('prints a ready-to-paste gate URL when the token is still in the address bar', async () => {
    const user = await seedUser()
    const html = await render(user, '?k=deadbeef00112233')

    // The whole point of this page over the repo manual: no placeholder for the
    // reader to substitute, because substituting is where people go wrong.
    expect(html).toContain(`${BASE}/gate?app=[快捷指令输入]&amp;k=deadbeef00112233`)
    expect(html).not.toContain('&lt;你的token&gt;')
  })

  it('refuses to invent a token it cannot know, once asked', async () => {
    const user = await seedUser()
    const html = await render(user, '?show=1')

    // This row predates accounts: only the hash was ever stored, so nothing can
    // reproduce the plaintext. Saying so beats printing a plausible-looking
    // wrong string.
    expect(html).toContain('读不到你的 token 原文')
  })

  it('offers a reveal rather than showing anything by default', async () => {
    const user = await seedUser()
    const html = await render(user)
    expect(html).toContain('/setup?show=1')
    expect(html).not.toContain('读不到你的 token 原文')
  })

  it('lists only this user’s app keys, never another user’s', async () => {
    const alice = await seedUser('alice')
    const bob = await seedUser('bob')
    await seedApp(alice.id, 'xhs', '小红书')
    await seedApp(bob.id, 'bobsecret', '鲍勃的秘密')

    const html = await render(alice)

    expect(html).toContain('xhs')
    expect(html).toContain('小红书')
    expect(html).not.toContain('bobsecret')
    expect(html).not.toContain('鲍勃的秘密')
  })

  it('marks disabled apps rather than hiding them', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'off', '停用的', 0)

    const html = await render(user)

    // Hiding it would leave the reader wondering why their automation never
    // fires; the key still has to match, it just is not armed.
    expect(html).toContain('off')
    expect(html).toContain('已停用')
  })

  it('guides a user with no apps to /settings instead of showing an empty table', async () => {
    const user = await seedUser()
    const html = await render(user)
    expect(html).toContain('还没有配置任何 App')
  })

  it('escapes app labels rather than letting them reach the markup', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'x', '<img src=x onerror=alert(1)>')

    const html = await render(user)

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('states the fail-open rule, the one thing that must not be改错', async () => {
    const user = await seedUser()
    const html = await render(user)

    // A reader who inverts this condition locks themselves out of their own
    // phone when the Worker is down. It must survive any future trim of this
    // page.
    expect(html).toContain('等于')
    expect(html).toContain('block')
    expect(html).toContain('不等于')
    expect(html).toContain('锁在自己手机外面')
  })

  it('never caches, since the page can carry a token', async () => {
    const user = await seedUser()
    const res = await renderSetup(new Request(`${BASE}/setup?k=secret123`), env, user)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
