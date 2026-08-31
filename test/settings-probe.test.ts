// Render + write-path coverage for /settings — the whole reason this is a
// multi-user product rather than one person's database — plus the redirect that
// /probe became when it merged into /lookup.
//
// The escaping case is not ceremony: this page interpolates user-supplied labels
// and schemes into markup.
//
// The rendering of the merged probe region lives in test/lookup.test.ts, where
// the page it now belongs to is.

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

describe('/probe, after the merge', () => {
  it('redirects to /lookup instead of 404-ing an old bookmark', async () => {
    const res = await renderProbe(env, user)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/lookup')
  })

  it('sends no fragment of its own, so /probe#app-xhs still lands on the card', async () => {
    // Per RFC 7231 a browser re-applies the original fragment when the Location
    // has none, and /lookup gives every configured app that same id. A Location
    // of '/lookup#top' would silently break every bookmark this redirect exists
    // to keep working.
    const res = await renderProbe(env, user)
    expect(res.headers.get('location')).not.toContain('#')
  })

  it('is temporary, not permanent', async () => {
    // Safari caches a 301 more or less forever, which would outlive any future
    // decision to split these pages again. Nobody navigates here deliberately,
    // so the extra round trip costs nothing worth having.
    const res = await renderProbe(env, user)
    expect(res.status).not.toBe(301)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('the grace window', () => {
  it('refuses a window too short to survive the trip back', async () => {
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

  it('keeps the warning beside the field, folded but never deleted', async () => {
    // This paragraph renders once per configured app plus once for the add form,
    // so it was the most repeated prose in the product. The claim that costs the
    // reader something stays visible; the background folds.
    await post({ op: 'save', app: 'xhs', label: '小红书', scheme: 'a://', enabled: '1' })
    const html = await (await get('/settings')).text()
    expect(html).toContain('刚跳回 App 就又被拦')
    expect(html).toContain('它到底管什么')
    expect(html).toContain('不进统计')
  })
})
