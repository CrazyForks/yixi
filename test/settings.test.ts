// /settings — the page that makes 一息 a multi-user product, and, since the
// 「候选」 tab was folded into it, the page that finds and tests URL schemes too.
//
// Three groups of assertions here earn their keep:
//
//   - THE JUMP. `location.href` assigned synchronously inside a click handler is
//     the only mechanism Safari honours for a custom scheme, and it is the same
//     one the breathing page's 「继续」 uses. A jump that works differently here
//     would certify schemes that then fail in the one place it counts, and it
//     would look fine in every other test. The old guard for this was blunt —
//     "the script contains no fetch, no await, no setTimeout" — which worked
//     only while the page had nothing else to do. The picker legitimately
//     fetches now, so the guard had to get sharper instead of being deleted:
//     the path from click to assignment is what must stay synchronous, and that
//     is what is asserted.
//   - THE DRAFT. A jump leaves the page. Whatever the reader had typed has to
//     survive coming back, or the feature that finds a scheme destroys the form
//     that needed it.
//   - COLLISION. The add form is the first thing on the page now and its App 键
//     field is empty every visit. Typing a key that already exists must not
//     overwrite that row — /lookup's write path guarded this; /settings never
//     did, back when the add form was buried under every configured app.
//
// The escaping cases are not ceremony: this page interpolates user-supplied
// labels and schemes into markup, and now also into a client-side renderer.

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { handleSettings } from '../src/ui/settings'
import { renderBreathe } from '../src/ui/breathe'
import { COOKIE_NAME, issueCookie } from '../src/auth'
import { listUserApps, upsertUserApp } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: Date.now() }

async function reset(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM sessions_web'),
    env.DB.prepare('DELETE FROM user_apps'),
    env.DB.prepare('DELETE FROM users'),
  ])
  await env.DB.prepare(
    'INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, ?1, ?2, 0, ?3)',
  )
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
async function html(path = '/settings'): Promise<string> {
  return await (await get(path)).text()
}

async function seedXhs(): Promise<void> {
  await upsertUserApp(env.DB, {
    user_id: 1,
    app: 'xhs',
    label: '小红书',
    scheme: 'xhsdiscover://',
    wait_seconds: 10,
    grace_seconds: 90,
    enabled: 1,
  })
}

/** The inline behaviour script (the one without a type attribute). */
function scriptOf(page: string): string {
  const m = page.match(/<script>([\s\S]*?)<\/script>/)
  expect(m, 'inline script missing').toBeTruthy()
  return m![1]!
}

/**
 * Strips comments so assertions about the code are about the code. This file's
 * script carries comments containing the very words being searched for, and a
 * naive match would go green on the bug. The `[^:]` guard keeps `https://` from
 * reading as a line comment.
 */
function codeOnly(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The body of a named function or of the first listener for an event. */
function bodyOf(code: string, opener: string): string {
  const start = code.indexOf(opener)
  expect(start, `not found: ${opener}`).toBeGreaterThan(-1)
  let i = code.indexOf('{', start)
  expect(i, `no brace after ${opener}`).toBeGreaterThan(-1)
  let depth = 0
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++
    else if (code[j] === '}') {
      depth--
      if (depth === 0) return code.slice(i + 1, j)
    }
  }
  throw new Error(`unbalanced braces after ${opener}`)
}

// ---------------------------------------------------------------------------

describe('write path', () => {
  it('saves, redirects, and shows the row', async () => {
    const r = await post({
      op: 'add',
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: '12',
      grace_seconds: '60',
      enabled: '1',
    })
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/settings?saved=xhs')
    const rows = await listUserApps(env.DB, 1)
    expect(rows[0]).toMatchObject({
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 12,
      grace_seconds: 60,
      enabled: 1,
    })
    const page = await html('/settings?saved=xhs')
    expect(page).toContain('id="app-xhs"')
    expect(page).toContain('已保存')
    expect(page).toContain('value="12"')
  })

  it('unchecked enabled writes 0', async () => {
    await post({ op: 'add', app: 'xhs', label: 'x', scheme: 'a://' })
    const rows = await listUserApps(env.DB, 1)
    expect(rows[0]?.enabled).toBe(0)
    expect(rows[0]?.wait_seconds).toBe(10)
    expect(rows[0]?.grace_seconds).toBe(90)
  })

  it('rejects bad input with a 400 and keeps the draft', async () => {
    const bad: Record<string, string>[] = [
      { op: 'add', app: 'XHS', label: 'x', scheme: 'a://' },
      { op: 'add', app: 'xhs', label: '', scheme: 'a://' },
      { op: 'add', app: 'xhs', label: 'x', scheme: 'javascript:alert(1)' },
      { op: 'add', app: 'xhs', label: 'x', scheme: 'notascheme' },
      { op: 'add', app: 'xhs', label: 'x', scheme: 'a://', wait_seconds: '999' },
      { op: 'add', app: 'xhs', label: 'x', scheme: 'a://', grace_seconds: '1' },
    ]
    for (const f of bad) {
      const r = await post(f)
      expect(r.status, JSON.stringify(f)).toBe(400)
      expect(await listUserApps(env.DB, 1)).toHaveLength(0)
    }
    const page = await (await post({ op: 'add', app: 'xhs', label: 'x', scheme: 'notascheme' })).text()
    expect(page).toContain('value="notascheme"')
    // The add block has to be open, or the error is about a form nobody can see.
    expect(page).toMatch(/<details class="add" open>/)
  })

  it('editing an existing row still works and reopens that row on rejection', async () => {
    await seedXhs()
    const ok = await post({
      op: 'save',
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: '20',
      grace_seconds: '90',
      enabled: '1',
    })
    expect(ok.status).toBe(303)
    expect((await listUserApps(env.DB, 1))[0]?.wait_seconds).toBe(20)

    const page = await (
      await post({ op: 'save', app: 'xhs', label: '小红书', scheme: 'nope', enabled: '1' })
    ).text()
    expect(page).toMatch(/<details class="app" id="app-xhs" open>/)
    expect(page).toContain('value="nope"')
  })

  it('deletes', async () => {
    await post({ op: 'add', app: 'xhs', label: 'x', scheme: 'a://', enabled: '1' })
    const r = await post({ op: 'delete', app: 'xhs' })
    expect(r.status).toBe(303)
    expect(await listUserApps(env.DB, 1)).toHaveLength(0)
  })

  it('405s on PUT, and refuses an operation it does not know', async () => {
    const r = await handleSettings(
      new Request('https://yixi.test/settings', { method: 'PUT' }),
      env,
      user,
    )
    expect(r.status).toBe(405)
    expect((await post({ op: 'wat', app: 'xhs' })).status).toBe(400)
  })

  it('escapes hostile labels', async () => {
    await post({ op: 'add', app: 'evil', label: '<script>x</script>', scheme: 'a://"onload="x', enabled: '1' })
    const page = await html()
    expect(page).not.toContain('<script>x</script>')
    expect(page).toContain('&lt;script&gt;')
    expect(page).not.toContain('"onload="')
  })
})

describe('adding a key that is already taken', () => {
  it('refuses instead of overwriting the row and the numbers on it', async () => {
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 25,
      grace_seconds: 300,
      enabled: 1,
    })
    const res = await post({
      op: 'add',
      app: 'xhs',
      label: '别的东西',
      scheme: 'other://',
      enabled: '1',
    })
    expect(res.status).toBe(409)

    // Nothing moved. Somebody set 25 and 300 on purpose.
    const rows = await listUserApps(env.DB, 1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: 25,
      grace_seconds: 300,
    })
  })

  it('reopens the add form, not the row it collided with', async () => {
    await seedXhs()
    const page = await (
      await post({ op: 'add', app: 'xhs', label: '别的东西', scheme: 'other://', enabled: '1' })
    ).text()

    expect(page).toContain('已经有一条')
    // The collision case is the one where draftMatchesRow is true by
    // construction. Painting the typed values into the existing row's form
    // would show the reader their new scheme sitting in the row they were just
    // told they had not changed.
    expect(page).toMatch(/<details class="add" open>/)
    expect(page).not.toMatch(/<details class="app" id="app-xhs" open>/)

    // Split at the boundary and check each side for what belongs there. The
    // typed values SHOULD survive in the add form — that is what a rejected
    // submission owes the reader — and must NOT appear in the row's own form,
    // which still holds what is actually saved.
    const cut = page.indexOf('<details class="app')
    expect(cut).toBeGreaterThan(-1)
    const addHalf = page.slice(0, cut)
    const rowHalf = page.slice(cut)

    expect(addHalf).toContain('value="other://"')
    expect(addHalf).toContain('value="别的东西"')
    expect(rowHalf).toContain('value="xhsdiscover://"')
    expect(rowHalf).not.toContain('value="other://"')
    expect(rowHalf).not.toContain('value="别的东西"')
  })

  it('leaves a plain edit of that same row alone', async () => {
    await seedXhs()
    const res = await post({
      op: 'save',
      app: 'xhs',
      label: '小红书',
      scheme: 'xhsdiscover://',
      wait_seconds: '30',
      grace_seconds: '90',
      enabled: '1',
    })
    expect(res.status).toBe(303)
    expect((await listUserApps(env.DB, 1))[0]?.wait_seconds).toBe(30)
  })
})

describe('the list, collapsed', () => {
  it('shows a configured app as one line, with what you check without editing', async () => {
    await seedXhs()
    const page = await html()
    // Name, the key the automation has to match, and both intervals — the three
    // things you open the page to verify. Everything else is behind the tap.
    expect(page).toContain('<span class="sname">小红书</span>')
    expect(page).toContain('<span class="skey mono">xhs</span>')
    expect(page).toMatch(/class="mini".*10.*90/s)
  })

  it('keeps every row shut by default', async () => {
    await seedXhs()
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'weibo',
      label: '微博',
      scheme: 'sinaweibo://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 1,
    })
    const page = await html()
    // Three fully-expanded forms is what this replaced: a phone screen each,
    // scrolled past in order to read a list of three names.
    expect(page).not.toMatch(/<details class="app[^"]*" id="app-\w+" open>/)
    expect((page.match(/<details class="app/g) ?? []).length).toBe(2)
  })

  it('marks a disabled app rather than hiding it, and drops the interval line', async () => {
    await upsertUserApp(env.DB, {
      user_id: 1,
      app: 'off',
      label: '停掉的',
      scheme: 'a://',
      wait_seconds: 10,
      grace_seconds: 90,
      enabled: 0,
    })
    const page = await html()
    expect(page).toContain('已停用')
    expect(page).toContain('class="app off"')
  })

  it('asks before deleting, with the Chinese sentence unchanged by the escaping around it', async () => {
    await seedXhs()
    // The confirm argument is a translation nested inside a JavaScript string
    // inside an HTML attribute, so it goes through jsSingleQuotedBody +
    // escapeHtml. Neither touches a sentence with no quote, backslash or
    // newline in it — this row must read exactly as it always has.
    expect(await html()).toContain(
      `onclick="return confirm('删掉这条配置？已经记下的次数不会被删。')"`,
    )
  })

  it('keeps the id, so /setup links and old #app-xhs bookmarks still land', async () => {
    await seedXhs()
    expect(await html()).toContain('id="app-xhs"')
  })
})

describe('adding, at the top and shut', () => {
  it('puts the add block before the list', async () => {
    await seedXhs()
    const page = await html()
    // Adding a fourth app used to mean scrolling past three open forms, purely
    // because that is where the form happened to be written.
    expect(page.indexOf('class="add"')).toBeLessThan(page.indexOf('<details class="app'))
  })

  it('is a closed one-tap control, not a form taking up the screen', async () => {
    const page = await html()
    expect(page).toMatch(/<details class="add">/)
    expect(page).toContain('summary class="addbtn"')
    expect(page).toContain('加一个 App')
  })

  it('points an empty account at that control rather than at nothing', async () => {
    const page = await html()
    expect(page).toContain('还没有配置任何 App')
  })
})

describe('the scheme field, and everything the 候选 tab used to be', () => {
  it('offers a 试跳 button on the field itself', async () => {
    await seedXhs()
    const page = await html()
    // One button covers a candidate just picked, a scheme saved months ago, and
    // a line pasted from a forum — three controls on the retired probe page.
    expect(page).toContain('data-try')
    expect(page).toContain('试跳')
  })

  it('answers 「这个格子里填什么」 with a real example, unfolded', async () => {
    const page = await html()
    // The reader's actual question is what shape goes in the box. One worked
    // example settles it faster than any explanation of where to look it up.
    expect(page).toContain('xhsdiscover://')
    expect(page).toContain('QDReader://')
  })

  it('carries the inline picker instead of sending anybody to another page', async () => {
    const page = await html()
    expect(page).toContain('不知道填什么？按 App 名字找')
    expect(page).toContain('class="pq"')
    expect(page).toContain('class="pgo"')
    expect(page).toContain('/api/candidates')
    // The whole point: no link off the page for this.
    expect(page).not.toContain('href="/lookup"')
    expect(page).not.toContain('href="/probe"')
  })

  it('renders one picker per form, so an edit can find a scheme too', async () => {
    await seedXhs()
    const page = await html()
    expect((page.match(/class="pq"/g) ?? []).length).toBe(2)
  })

  it('never lets the picker search box be submitted as configuration', async () => {
    const page = await html()
    // A `name` on that input would post it alongside the real fields.
    const pq = page.match(/<input[^>]*class="pq"[^>]*>/)
    expect(pq, 'picker input missing').toBeTruthy()
    expect(pq![0]).not.toContain('name=')
  })

  it('states the three tiers the picker can label a candidate with', async () => {
    const code = codeOnly(scriptOf(await html()))
    expect(code).toContain('verified')
    expect(code).toContain('listed')
    expect(code).toContain('derived')
  })
})

describe('the jump', () => {
  it('assigns location.href exactly once, in one jump()', async () => {
    await seedXhs()
    const code = codeOnly(scriptOf(await html()))
    // The candidates, the field's own 试跳 and the saved scheme must not each
    // grow their own navigation. One assignment on the whole page is the
    // strongest available form of that.
    expect(code.match(/function jump\(scheme\)/g)).toHaveLength(1)
    expect(code.match(/location\.href/g)).toHaveLength(1)
    expect(code).toContain('location.href = scheme;')
  })

  it('keeps the whole click-to-jump path synchronous', async () => {
    const code = codeOnly(scriptOf(await html()))

    // The blunt version of this guard — no fetch, no await, no setTimeout
    // anywhere in the script — went obsolete the moment the picker needed to
    // search. Banning the keyword globally would now mean either deleting the
    // guard or deleting the feature, so it names the actual constraint instead:
    // the handler that reaches location.href may not await, fetch, or defer.
    const jump = bodyOf(code, 'function jump(scheme)')
    const click = bodyOf(code, "document.addEventListener('click'")
    const draft = bodyOf(code, 'function saveDraft(form)')

    for (const [where, body] of [
      ['jump()', jump],
      ['click handler', click],
      ['saveDraft()', draft],
    ] as const) {
      expect(body, `${where}: await`).not.toContain('await')
      expect(body, `${where}: fetch`).not.toContain('fetch(')
      expect(body, `${where}: setTimeout`).not.toContain('setTimeout')
      expect(body, `${where}: promise chain`).not.toContain('.then(')
    }

    // And the fetch that does exist is only in the search path.
    expect(bodyOf(code, 'function search(pick)')).toContain('fetch(')
    expect(code.match(/fetch\(/g)).toHaveLength(1)
  })

  it('jumps the way the breathing page jumps', async () => {
    // The whole worth of trying a scheme here is that it exercises the exact
    // mechanism 「继续」 uses. Safari only opens a custom scheme from inside the
    // synchronous call stack of a real gesture: a bare assignment to
    // location.href in a click handler, with nothing awaited on the way to it.
    const grab = (js: string): string => {
      const m = codeOnly(js).match(/location\.href\s*=\s*[A-Za-z]+;/)
      expect(m, 'no synchronous assignment to location.href').toBeTruthy()
      return m![0].replace(/\s+/g, '')
    }

    const sid = crypto.randomUUID().replace(/-/g, '')
    await seedXhs()
    await env.DB.prepare(
      'INSERT INTO sessions (sid, user_id, app, created_at, resolved_at) VALUES (?1, 1, ?2, ?3, NULL)',
    )
      .bind(sid, 'xhs', Date.now())
      .run()
    const breathe = await (
      await renderBreathe(new Request(`https://yixi.test/b?s=${sid}`), env)
    ).text()

    expect(grab(scriptOf(await html()))).toBe('location.href=scheme;')
    expect(grab(scriptOf(breathe))).toBe('location.href=SCHEME;')
  })

  it('refuses to jump to a scheme that would execute rather than navigate', async () => {
    const code = codeOnly(scriptOf(await html()))
    // The box accepts anything the reader types, including a line pasted from a
    // forum, and a derived candidate is assembled from a string Apple returned.
    // So the denylist the write path enforces is repeated in the browser.
    expect(code).toMatch(/var BAD = \/[^/]*javascript[^/]*\/i;/)
    expect(bodyOf(code, 'function jump(scheme)')).toContain('BAD.test(scheme)')
  })
})

describe('the draft that survives a jump', () => {
  it('saves before jumping and restores once on the way back', async () => {
    const code = codeOnly(scriptOf(await html()))
    // A jump leaves the page. Safari usually still has it when you return, but
    // "usually" is not good enough for a half-filled form nobody can rebuild.
    const click = bodyOf(code, "document.addEventListener('click'")
    expect(click).toContain('saveDraft(')
    expect(code).toContain('localStorage.setItem')
    expect(code).toContain('localStorage.getItem')
    // Restored once, then dropped — otherwise every later visit reopens a form
    // full of stale values.
    expect(bodyOf(code, 'function restoreDrafts()')).toContain('removeItem')
  })

  it('clears the draft on submit, or it would overwrite what was just saved', async () => {
    const code = codeOnly(scriptOf(await html()))
    expect(bodyOf(code, "document.addEventListener('submit'")).toContain('clearDraft(form)')
  })

  it('survives storage being unavailable, because the jump matters more', async () => {
    const code = codeOnly(scriptOf(await html()))
    // Private mode and disabled site data both make localStorage throw on
    // access, not just return null.
    expect(bodyOf(code, 'function saveDraft(form)')).toMatch(/try\s*\{/)
    expect(bodyOf(code, 'function clearDraft(form)')).toMatch(/try\s*\{/)
  })
})

describe('the grace window', () => {
  it('refuses a window too short to survive the trip back', async () => {
    const res = await post({
      op: 'add',
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
      op: 'add',
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
    await seedXhs()
    const page = await html()
    expect(page).toContain('刚跳回 App 就又被拦')
    expect(page).toContain('它到底管什么')
    expect(page).toContain('不进统计')
  })
})

describe('the two retired pages', () => {
  async function signedIn(path: string): Promise<Response> {
    const cookie = await issueCookie(env, user)
    const value = cookie.split(';')[0]!.slice(COOKIE_NAME.length + 1)
    return await worker.fetch(
      new Request(`https://yixi.test${path}`, { headers: { Cookie: `${COOKIE_NAME}=${value}` } }),
      env,
    )
  }

  it('sends /lookup and /probe to /settings rather than 404-ing a bookmark', async () => {
    for (const path of ['/lookup', '/probe']) {
      const res = await signedIn(path)
      expect(res.status, path).toBe(302)
      expect(res.headers.get('location'), path).toBe('/settings')
    }
  })

  it('is temporary, not permanent', async () => {
    // Safari caches a 301 more or less forever, which would outlive any future
    // decision to split these pages again. Nobody navigates here deliberately.
    const res = await signedIn('/lookup')
    expect(res.status).not.toBe(301)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('carries no fragment of its own, so /probe#app-xhs still lands on the card', async () => {
    // Per RFC 7231 a browser re-applies the original fragment when the Location
    // has none, and /settings gives every configured app that same id.
    expect((await signedIn('/probe')).headers.get('location')).not.toContain('#')
  })
})
