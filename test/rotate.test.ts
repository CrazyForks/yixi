import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { register, revealToken, rotateToken } from '../src/account'
import { userFromToken } from '../src/auth'
import { handleGate } from '../src/gate'
import { getGraceUntil, setGrace } from '../src/db'
import type { User } from '../src/types'

const PASSWORD = 'correct-horse-battery'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events'),
    env.DB.prepare('DELETE FROM grace'),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

async function signUp(email = 'a@example.com'): Promise<{ user: User; token: string }> {
  const res = await register(env, { email, password: PASSWORD, name: '甲' })
  if (!res.ok) throw new Error(`register failed: ${res.error}`)
  return { user: res.user, token: res.token }
}

async function seedApp(userId: number, app = 'xhs'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_apps (user_id, app, label, scheme, wait_seconds, grace_seconds, enabled)
     VALUES (?1, ?2, '小红书', 'xhsdiscover://', 10, 90, 1)`,
  )
    .bind(userId, app)
    .run()
}

function gate(app: string, token: string): Promise<Response> {
  return handleGate(new Request(`https://yixi.test/gate?app=${app}&k=${token}&fmt=text`), env)
}

beforeEach(reset)

describe('token rotation', () => {
  it('issues a different token and returns it exactly once', async () => {
    const { user, token } = await signUp()
    const res = await rotateToken(env, { user, currentPassword: PASSWORD })

    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.token).not.toBe(token)
    expect(res.token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('kills the old token at the gate — the entire point of the feature', async () => {
    const { user, token: old } = await signUp()
    await seedApp(user.id)
    expect((await gate('xhs', old)).status).toBe(200)

    const res = await rotateToken(env, { user, currentPassword: PASSWORD })
    if (!res.ok) throw new Error('rotate failed')

    // A rotation that leaves the leaked credential working is not a remedy.
    expect((await gate('xhs', old)).status).toBe(401)
    expect((await gate('xhs', res.token)).status).toBe(200)
  })

  it('keeps both stored copies pointing at the same new token', async () => {
    const { user } = await signUp()
    const res = await rotateToken(env, { user, currentPassword: PASSWORD })
    if (!res.ok) throw new Error('rotate failed')

    // The hash is what /gate verifies, the ciphertext is what the account page
    // shows. Updating one and not the other yields an account that either
    // cannot authenticate or cannot show the credential that works.
    expect(await revealToken(env, user)).toBe(res.token)
    expect((await userFromToken(env, res.token))?.id).toBe(user.id)
  })

  it('refuses without the current password', async () => {
    const { user, token: old } = await signUp()
    const res = await rotateToken(env, { user, currentPassword: 'not-the-password' })

    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('invalid_credentials')
    // And nothing changed: a failed attempt must not strand the automations.
    expect(await revealToken(env, user)).toBe(old)
  })

  it('drops any open grace window', async () => {
    const { user } = await signUp()
    await seedApp(user.id)
    await setGrace(env.DB, user.id, 'xhs', Date.now() + 90_000)
    expect(await getGraceUntil(env.DB, user.id, 'xhs')).not.toBeNull()

    await rotateToken(env, { user, currentPassword: PASSWORD })

    // A window opened under the retired token would otherwise sit there
    // suppressing interception for a credential nobody is sending any more.
    expect(await getGraceUntil(env.DB, user.id, 'xhs')).toBeNull()
  })

  it('leaves the browser session alone', async () => {
    const { user } = await signUp()
    const before = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions_web WHERE user_id = ?1')
      .bind(user.id)
      .first<{ n: number }>()

    await rotateToken(env, { user, currentPassword: PASSWORD })

    // Rotating is how someone reacts to a leak. Signing them out of the browser
    // they are standing in, while they still have Shortcuts to update, would
    // punish exactly the right instinct.
    const after = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions_web WHERE user_id = ?1')
      .bind(user.id)
      .first<{ n: number }>()
    expect(after?.n).toBe(before?.n)
  })

  it('does not touch anybody else', async () => {
    const a = await signUp('a@example.com')
    const b = await signUp('b@example.com')
    await seedApp(b.user.id)

    await rotateToken(env, { user: a.user, currentPassword: PASSWORD })

    expect(await revealToken(env, b.user)).toBe(b.token)
    expect((await gate('xhs', b.token)).status).toBe(200)
  })

  it('refuses for a row with no password to check against', async () => {
    const res = await env.DB.prepare(
      'INSERT INTO users (name, token_hash, is_owner, created_at) VALUES (?1, ?2, 0, ?3)',
    )
      .bind('老账号', 'hash-only', Date.now())
      .run()
    const legacy: User = {
      id: Number(res.meta.last_row_id),
      name: '老账号',
      is_owner: 0,
      created_at: Date.now(),
    }

    const out = await rotateToken(env, { user: legacy, currentPassword: PASSWORD })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.error).toBe('no_account')
  })
})
