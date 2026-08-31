// Render + write-path coverage for the two pages that have no other owner:
// /settings (the whole reason this is a multi-user product) and /probe (the
// only thing standing between the user and a URL scheme copied off a forum).
//
// The escaping cases at the end are not ceremony: both pages interpolate
// user-supplied labels and schemes, and /probe hands its schemes to an inline
// script, so a scheme that can close a <script> tag would be code execution on
// the page whose whole job is to navigate somewhere.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleSettings } from '../src/ui/settings'
import { renderProbe } from '../src/ui/probe'
import { listUserApps } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: Date.now() }

async function reset(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_apps'), env.DB.prepare('DELETE FROM users')])
  await env.DB.prepare('INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, ?1, ?2, 0, ?3)')
    .bind('张三', 'hash', Date.now())
    .run()
}
beforeEach(reset)

function get(path: string): Promise<Response> {
  return handleSettings(new Request(`https://yixi.test${path}`), env, user)
}
function post(fields: Record<string, string>): Promise<Response> {
  return handleSettings(
    new Request('https://yixi.test/settings', { method: 'POST', body: new URLSearchParams(fields) }),
    env,
    user,
  )
}

describe('settings', () => {
  it('empty state renders', async () => {
    const r = await get('/settings')
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('还没有配置任何 App')
  })

  it('saves, redirects, and shows the row', async () => {
    const r = await post({ op: 'save', app: 'xhs', label: '小红书', scheme: 'xhsdiscover://', wait_seconds: '12', grace_seconds: '60', enabled: '1' })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/settings?saved=xhs')
    const rows = await listUserApps(env.DB, 1)
    expect(rows[0]).toMatchObject({ app: 'xhs', label: '小红书', scheme: 'xhsdiscover://', wait_seconds: 12, grace_seconds: 60, enabled: 1 })
    const html = await (await get('/settings?saved=xhs')).text()
    expect(html).toContain('id="app-xhs"')
    expect(html).toContain('已保存')
    expect(html).toContain('value="12"')
  })

  it('unchecked enabled writes 0', async () => {
    await post({ op: 'save', app: 'xhs', label: 'x', scheme: 'a://' })
    const rows = await listUserApps(env.DB, 1)
    expect(rows[0]?.enabled).toBe(0)
    expect(rows[0]?.wait_seconds).toBe(10)
    expect(rows[0]?.grace_seconds).toBe(90)
  })

  it('rejects bad input with a 400 and keeps the draft', async () => {
    const bad: Record<string, string>[] = [
      { op: 'save', app: 'XHS', label: 'x', scheme: 'a://' },
      { op: 'save', app: 'xhs', label: '', scheme: 'a://' },
      { op: 'save', app: 'xhs', label: 'x', scheme: 'javascript:alert(1)' },
      { op: 'save', app: 'xhs', label: 'x', scheme: 'notascheme' },
      { op: 'save', app: 'xhs', label: 'x', scheme: 'a://', wait_seconds: '999' },
      { op: 'save', app: 'xhs', label: 'x', scheme: 'a://', grace_seconds: '1' },
    ]
    for (const f of bad) {
      const r = await post(f)
      expect(r.status, JSON.stringify(f)).toBe(400)
      expect(await listUserApps(env.DB, 1)).toHaveLength(0)
    }
    // draft survives a rejected add
    const html = await (await post({ op: 'save', app: 'xhs', label: 'x', scheme: 'notascheme' })).text()
    expect(html).toContain('value="notascheme"')
  })

  it('deletes', async () => {
    await post({ op: 'save', app: 'xhs', label: 'x', scheme: 'a://', enabled: '1' })
    const r = await post({ op: 'delete', app: 'xhs' })
    expect(r.status).toBe(303)
    expect(await listUserApps(env.DB, 1)).toHaveLength(0)
  })

  it('405s on PUT', async () => {
    const r = await handleSettings(new Request('https://yixi.test/settings', { method: 'PUT' }), env, user)
    expect(r.status).toBe(405)
  })

  it('escapes hostile labels', async () => {
    await post({ op: 'save', app: 'evil', label: '<script>x</script>', scheme: 'a://"onload="x', enabled: '1' })
    const html = await (await get('/settings')).text()
    expect(html).not.toContain('<script>x</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"onload="')
  })
})

describe('probe', () => {
  it('empty state', async () => {
    const html = await (await renderProbe(env, user)).text()
    expect(html).toContain('还没有配置任何 App')
  })

  it('renders a button and a JSON island per app, disabled ones included', async () => {
    await post({ op: 'save', app: 'xhs', label: '小红书', scheme: 'xhsdiscover://', enabled: '1' })
    await post({ op: 'save', app: 'dy', label: '抖音', scheme: 'dyscheme://' })
    const r = await renderProbe(env, user)
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('id="app-xhs"')
    expect(html).toContain('id="app-dy"')
    expect(html).toContain('已停用')
    expect(html).toContain('data-i="0"')
    expect(html).toContain('data-i="1"')
    // island order must match button order (listUserApps orders by app: dy, xhs)
    expect(html).toContain('["dyscheme://","xhsdiscover://"]')
    expect(html).toContain('href="/settings#app-xhs"')
  })

  it('escapes a scheme containing a tag-closer in the JSON island', async () => {
    await post({ op: 'save', app: 'x', label: 'x', scheme: 'a://</script><img>', enabled: '1' })
    const html = await (await renderProbe(env, user)).text()
    expect(html).not.toContain('</script><img>')
    expect(html).toContain('\\u003c/script')
  })

  it('refuses a grace window too short to survive the trip back', async () => {
    // Tapping 继续 has to outlast Safari handing off plus the app cold-starting
    // plus the automation firing again. A few seconds does not cover it, and the
    // symptom — intercepted again the instant you arrive — reads as the whole
    // tool being broken rather than as one number being wrong.
    const res = await post({
      op: 'save',
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: '5',
      grace_seconds: '5',
      enabled: 'on',
    })
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('刚跳回 App 就又被拦')
  })

  it('accepts the recommended window', async () => {
    const res = await post({
      op: 'save',
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: '5',
      grace_seconds: '90',
      enabled: 'on',
    })
    expect(res.status).toBe(303)
  })
})
