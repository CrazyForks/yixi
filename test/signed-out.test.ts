import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { register } from '../src/account'

const BASE = 'https://yixi.example.workers.dev'

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM rate_limit'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
}

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`), env)
}

function post(path: string, fields: Record<string, string>): Promise<Response> {
  return worker.fetch(
    new Request(`${BASE}${path}`, { method: 'POST', body: new URLSearchParams(fields) }),
    env,
  )
}

beforeEach(reset)

describe('signed-out visitors', () => {
  const consolePages = ['/review', '/settings', '/probe', '/setup', '/account', '/admin']

  it('sends every console page to the sign-in screen, not a bare 401', async () => {
    for (const path of consolePages) {
      const res = await get(path)
      // A plain-text "unauthorized" is indistinguishable from a broken site, and
      // these paths are exactly what the nav offers first.
      expect(res.status, path).toBe(303)
      expect(res.headers.get('location'), path).toContain('/login')
    }
  })

  it('remembers where they were going', async () => {
    const res = await get('/setup')
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/setup')}`)
  })

  it('keeps the query string of the intended destination', async () => {
    const res = await get('/setup?show=1')
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/setup?show=1')}`)
  })

  it('lands them where they were going once signed in', async () => {
    const created = await register(env, { email: 'a@example.com', password: 'correct-horse-1' })
    expect(created.ok).toBe(true)

    const res = await post('/login?next=%2Fsetup', {
      email: 'a@example.com',
      password: 'correct-horse-1',
    })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/setup')
  })

  it('never forwards to another origin, whatever shape the input takes', async () => {
    await register(env, { email: 'b@example.com', password: 'correct-horse-1' })

    // The assertion is the invariant, not a list of blocked strings. An audit
    // found `/\host` sailing past the previous guard — `startsWith('/') &&
    // !startsWith('//')` — because browsers read a backslash as a slash in the
    // authority position of an http(s) URL. This suite stayed green over it,
    // since it only tried the shapes whoever wrote the guard had thought of.
    //
    // Enumerating shapes is the losing move. What matters is that the emitted
    // Location, resolved the way a browser resolves it, stays on this origin —
    // several of these inputs legitimately resolve to a same-site path, and
    // forwarding there is fine.
    const shapes = [
      'https://evil.example.com/',
      '//evil.example.com/',
      'javascript:alert(1)',
      '/\\evil.example.com/',
      '/\\/evil.example.com/',
      '\\evil.example.com/',
      '\\\\evil.example.com/',
      'https:/evil.example.com/',
      '/%5Cevil.example.com/',
      'http://evil.example.com\\@yixi.example.workers.dev/',
      'https://evil.example.com\\.yixi.example.workers.dev/',
      '/..//evil.example.com/',
    ]

    for (const shape of shapes) {
      const res = await post(`/login?next=${encodeURIComponent(shape)}`, {
        email: 'b@example.com',
        password: 'correct-horse-1',
      })
      const location = res.headers.get('location')
      expect(location, shape).not.toBeNull()
      expect(new URL(location!, BASE).origin, shape).toBe(new URL(BASE).origin)
    }
  })

  it('leaves the pages anyone may reach alone', async () => {
    for (const path of ['/', '/login', '/register', '/claim', '/recover']) {
      expect((await get(path)).status, path).toBe(200)
    }
  })
})

describe('registering an address that already exists', () => {
  it('says so, and hands over a link to sign in instead', async () => {
    await register(env, { email: 'taken@example.com', password: 'correct-horse-1' })

    const res = await post('/register', {
      email: 'taken@example.com',
      password: 'another-password-1',
      password2: 'another-password-1',
      name: '二号',
    })
    const html = await res.text()

    expect(res.status).toBe(400)
    expect(html).toContain('已经注册过了')
    // Being told the address is taken is useless without a way to act on it;
    // retyping it into a form they have to go find is what makes people create
    // a second throwaway account instead.
    expect(html).toContain(`/login?email=${encodeURIComponent('taken@example.com')}`)
  })

  it('arrives at sign-in with the address already filled in', async () => {
    const res = await get(`/login?email=${encodeURIComponent('taken@example.com')}`)
    const html = await res.text()
    expect(html).toContain('value="taken@example.com"')
  })

  it('still escapes the address it echoes back', async () => {
    const res = await get('/login?email=%22%3E%3Cimg+src%3Dx+onerror%3Dalert(1)%3E')
    const html = await res.text()
    expect(html).not.toContain('<img src=x')
  })
})
