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

    // 「快捷指令输入」 may be named, but only ever to say it is not there. The
    // guard used to be a count — at most one mention — which was a proxy for
    // the real rule and started failing the moment a second, equally negative
    // sentence was needed (explaining why every app gets its own shortcut
    // instead of one shared one taking the app key as input). Counting
    // mentions would have meant deleting the explanation to satisfy the test.
    //
    // So it asserts the actual invariant: every occurrence sits next to a
    // negation. An instruction to go and pick it fails; an explanation of why
    // you cannot does not.
    const DENIALS = ['不要去找', '挑不到', '找不到', '没有']
    let from = 0
    let mentions = 0
    for (;;) {
      const at = html.indexOf('快捷指令输入', from)
      if (at === -1) break
      mentions++
      const around = html.slice(Math.max(0, at - 60), at + 60)
      expect(
        DENIALS.some((d) => around.includes(d)),
        `「快捷指令输入」 at ${at} is not next to a denial: ${around}`,
      ).toBe(true)
      from = at + 1
    }
    expect(mentions, 'the warning itself must survive').toBeGreaterThanOrEqual(1)
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

  it('prints a finished line for EVERY configured app, not just the first', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'qidian', '起点读书')
    await seedApp(user.id, 'xhs', '小红书')
    await seedApp(user.id, 'weibo', '微博')
    const html = await render(user, '?k=deadbeef00112233')

    // The bug this replaces: step one printed the FIRST app's line under the
    // sentence 「已经是你的真实地址和 token」. With three apps configured that
    // sentence is true for one of them, and the failure it invites is silent —
    // paste the qidian line into 小红书's shortcut and interception still
    // works, using qidian's wait, qidian's grace, qidian's scheme to jump back
    // to, and recording the count against qidian. Nothing errors.
    const stepOne = html.slice(0, html.indexOf('第二步'))
    for (const app of ['qidian', 'xhs', 'weibo']) {
      expect(stepOne, app).toContain(`gate?app=${app}&amp;k=deadbeef00112233&amp;fmt=text`)
    }
  })

  it('says which app each line is for, once there is more than one', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'qidian', '起点读书')
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user, '?k=deadbeef00112233')

    // A stack of near-identical URLs with nothing distinguishing them is the
    // same trap in a different shape.
    expect(html).toContain('起点读书')
    expect(html).toContain('小红书')
    expect(html).toMatch(/拦<b>起点读书<\/b>的那条快捷指令用这行/)
  })

  it('never claims the app key can be shared between shortcuts', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    const html = await render(user)

    // This page used to open with 「token 只出现一次，就在下面第一步那个共用快捷
    // 指令里…将来换 token 只改那一处」. That was left over from a design that was
    // abandoned on a real device: the URL field will not offer 「快捷指令输入」,
    // so the app key cannot be passed in and every app needs its own shortcut.
    // Following the stale text, somebody who rotates their token at /account
    // fixes one shortcut and silently loses every other app.
    expect(html).not.toContain('共用快捷指令')
    expect(html).not.toContain('只改那一处')
    expect(html).not.toContain('不重复填')
    // And says the true thing in its place.
    expect(html).toContain('每一条都改')
  })

  it('tells an empty account to go configure something, not to paste a fake line', async () => {
    const user = await seedUser()
    const html = await render(user, '?k=deadbeef00112233')
    expect(html).toContain('你还没配置任何 App')
    expect(html).toContain('/settings')
    // No line to copy, because there is no correct line to give.
    const stepOne = html.slice(0, html.indexOf('第二步'))
    expect(stepOne).not.toMatch(/gate\?app=\w+&amp;k=deadbeef/)
  })

  it('never caches, since the page can carry a token', async () => {
    const user = await seedUser()
    const res = await renderSetup(new Request(`${BASE}/setup?k=secret123`), env, user)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  // --- every line to paste has a button that copies it ----------------------
  //
  // `user-select:all` alone meant a tap selected the line and then the reader
  // still had to find 「拷贝」 in the iOS callout. These are lines nobody reads;
  // they exist to be moved into the Shortcuts editor.

  it('puts a copy button on every pasteable line, in step one and in the table', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')
    await seedApp(user.id, 'qidian', '起点读书')
    const html = await render(user, '?k=deadbeef00112233')

    // Two per app (step one, then the table) plus the token block and the
    // zzztest check line.
    const buttons = html.match(/class="cpl-b"/g) ?? []
    expect(buttons.length).toBe(6)
    expect(html).toContain(`${BASE}/gate?app=xhs&amp;k=deadbeef00112233&amp;fmt=text`)
  })

  it('copies the token itself, rather than asking for a careful drag across it', async () => {
    const user = await seedUser()
    const html = await render(user, '?k=deadbeef00112233')

    const tokenBlock = html.slice(html.indexOf('<h2>你的 token</h2>'), html.indexOf('<h2>第一步'))
    expect(tokenBlock).toContain('deadbeef00112233')
    expect(tokenBlock).toContain('class="cpl-b"')
  })

  it('gives the zzztest check line a copy button and keeps the token out of every href', async () => {
    const user = await seedUser()
    const html = await render(user, '?k=deadbeef00112233')

    const check = html.slice(html.indexOf('验一下配对没'))
    expect(check).toContain(`${BASE}/gate?app=zzztest&amp;k=deadbeef00112233`)
    expect(check).toContain('class="cpl-b"')
    // Deliberately not an <a href>. Tapping one is a top-level navigation, so
    // the token would land in Safari History and address-bar autocomplete —
    // the same leak that turned the tester below into a fetch. Copy, then
    // paste: one extra gesture, no permanent record.
    expect(check).not.toMatch(/<a[^>]*href="[^"]*zzztest/)
  })

  it('loads the copy script whether or not a token is on screen', async () => {
    const user = await seedUser()
    await seedApp(user.id, 'xhs', '小红书')

    const revealed = await render(user, '?k=deadbeef00112233')
    const masked = await render(user)

    for (const html of [revealed, masked]) {
      expect(html).toContain('navigator.clipboard')
      expect(html).toContain('已选中，长按拷贝')
    }

    // The tester is the half that still depends on having a token: without one
    // there is no line whose reachability could be checked.
    expect(revealed).toContain('data-test=')
    expect(masked).not.toContain('data-test=')
    expect(masked).not.toContain('fetch(')
  })

  it('no longer carries the home-screen walkthrough, and does not point at the other face either', async () => {
    const user = await seedUser()
    const html = await render(user)
    // That whole section moved to the 今日 face's own "怎么配" — /setup is the
    // 拦截 face now, and a reader here has nothing to do with home-screen icons.
    expect(html).not.toContain('让今日页一按就开')
    // The two faces stay apart: the interception walkthrough does not point at the other face.
    expect(html).not.toContain('/today/setup')
  })
})
