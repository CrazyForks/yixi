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
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // The whole point of this page over the repo manual: no placeholder for the
    // reader to substitute, because substituting is where people go wrong. The
    // app key is one of theirs, not a stand-in.
    expect(html).toContain(`${BASE}/gate?app=xhs&amp;k=deadbeef00112233&amp;fmt=text`)
  })

  it('always asks for fmt=text — the JSON form is unusable from Shortcuts', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // Without it the gate answers JSON, which needs a 「获取词典值」 action and
    // an If comparing a dictionary value — the exact step that turned out not
    // to be reliably offered by the Shortcuts editor.
    expect(html).toContain('fmt=text')
    expect(html).toContain('包含')
    expect(html).toContain('https')
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
    expect(html).toContain('还没有配置 App')
    expect(html).toContain('/settings')
  })

  it('escapes app labels rather than letting them reach the markup', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'x', '<img src=x onerror=alert(1)>')

    const html = await render(user)

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('states the fail-open rule in terms of the protocol actually in use', async () => {
    const user = await seedUser()
    const html = await render(user)

    // A reader who inverts this condition locks themselves out of their own
    // phone when the service is down, so the section must survive any future
    // trim of this page.
    expect(html).toContain('包含')
    expect(html).toContain('https')
    expect(html).toContain('不包含')
    expect(html).toContain('锁在自己手机外面')
  })

  it('does not describe the retired JSON protocol anywhere', async () => {
    const user = await seedUser()
    const html = await render(user)

    // This section went stale for several releases: the steps above it had
    // moved to `fmt=text` while it still told the reader to compare against
    // `block`, a word /gate no longer emits. Following it produced a condition
    // that can never be true — no interception, and no error either. Nothing
    // caught it because no test asserted the page agreed with the protocol.
    const body = html.slice(0, html.indexOf('const ') === -1 ? html.length : html.indexOf('const '))
    expect(body).not.toMatch(/等于\s*<code>block/)
    expect(body).not.toMatch(/不等于\s*<code>pass/)
    expect(body).not.toContain('获取词典值')
  })

  it('never tells the reader to pick a magic variable', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // Twice now a step written against remembered Shortcuts chrome has failed on
    // a real phone: 「如果」 would not offer a dictionary value, and the URL field
    // would not offer 「快捷指令输入」 (that one only exists once a shortcut is set
    // to accept input, which a new one is not). The instructions must not depend
    // on any variable the reader has to go find — the URL is pasted literally.
    expect(html).not.toContain('获取词典值')
    expect(html).not.toContain('词典值')

    // 「快捷指令输入」 may appear exactly once, and only to tell the reader not
    // to go looking for it — that warning is worth keeping, since this is the
    // step they got stuck on.
    const mentions = html.split('快捷指令输入').length - 1
    expect(mentions).toBeLessThanOrEqual(1)
    if (mentions === 1) expect(html).toContain('不要去找')
  })

  it('puts a complete, pasteable URL in step one', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // Inline, not only in the table further down: the reader is standing in the
    // Shortcuts app with the URL field open.
    const stepOne = html.slice(0, html.indexOf('第二步'))
    expect(stepOne).toContain(`${BASE}/gate?app=xhs&amp;k=deadbeef00112233&amp;fmt=text`)
  })

  it('never puts the token anywhere a tap would navigate to', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // The tester used to be an `<a href>` carrying the token. Tapping it was a
    // real top-level navigation, so the URL went into Safari History and
    // address-bar autocomplete — retrievable afterwards with no further taps,
    // which quietly undid the `?show=1` gate. Revealing the token once is a
    // deliberate act; having it sit in History forever is not.
    const hrefs = html.match(/href="[^"]*"/g) ?? []
    for (const href of hrefs) expect(href).not.toContain('deadbeef00112233')
    expect(html).not.toMatch(/<a[^>]*\bhref="[^"]*\bk=/)
  })

  it('tests a gate URL by fetching it, not by leaving the page', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // fetch is also the more faithful test: the Shortcut's 「获取 URL 的内容」 is
    // a background HTTP call, not a WebKit navigation.
    expect(html).toContain('data-test=')
    expect(html).toContain('fetch(')
    expect(html).not.toContain('location.href')
  })

  it('never caches, since the page can carry a token', async () => {
    const user = await seedUser()
    const res = await renderSetup(new Request(`${BASE}/setup?k=secret123`), env, user)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
