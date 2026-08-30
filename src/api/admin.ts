// /admin — the owner's ticket window. Create a user, generate their token, see
// who is using the thing.
//
// THE PRIVACY LINE (design doc §3.1), and the reason this file is written the
// way it is:
//
//   The owner may see an aggregate count. The owner may NEVER see anyone's
//   events — not the apps, not the timestamps, not a single row.
//
// /review is a minute-by-minute record of a person's worst impulses. A friend
// who suspects the owner can read it will not use this product honestly, and a
// product used dishonestly is worthless. So the guarantee is structural rather
// than a rule someone has to remember:
//
//   1. The only query this file runs against `events` is countAttemptsPerUser,
//      which is a GROUP BY returning counts — there is no statement here that
//      could return an event row even if someone asked it to.
//   2. Everything past that query is narrowed to `AdminRow` immediately, so the
//      render layer is handed three fields (id, name, count) and physically
//      cannot reach anything else.
//   3. There is exactly one GET route. Anything else under /admin is a 404, so
//      no detail endpoint can be reached by guessing a path.
//   4. test/admin.test.ts asserts all of the above against real seeded events.
//
// Even the aggregate is kept to the one number the owner has an operational
// reason to want — "did their setup ever fire?". How often someone held out is
// a statement about their willpower, and it is not the owner's business, so it
// is not rendered here even though the aggregate query happens to compute it.

import type { Env, User } from '../types'
import { sha256Hex } from '../auth'
import { countAttemptsPerUser, createUser, listUsers, shanghaiDate } from '../db'
import { DEFAULT_THEME, escapeHtml, page } from '../ui/layout'
import { CONSOLE_CSS, consoleHeader } from '../ui/console'

const CSS = `
${CONSOLE_CSS}
.card.hot{border-color:var(--fg)}
.secret{word-break:break-all;margin:0 0 14px}
.secret.big{font-size:16px}
.privacy{margin-top:18px;line-height:1.9}
main.solo{padding-top:34px}
`

/** Trailing window for the counts, inclusive of today, in Asia/Shanghai days. */
const WINDOW_DAYS = 7

/**
 * Everything /admin is allowed to know about a user. Widening this type is the
 * only way to widen what the page can show, which is the point of it existing.
 */
interface AdminRow {
  id: number
  name: string
  isOwner: boolean
  joined: string
  /** Interceptions in the last WINDOW_DAYS. A count, never a list. */
  attempts: number
}

export async function handleAdmin(request: Request, env: Env, user: User): Promise<Response> {
  // Non-owners get nothing here, on any path and any method, before a single
  // query runs.
  if (!user.is_owner) return forbidden()

  const url = new URL(request.url)
  if (url.pathname === '/admin' && request.method === 'GET') {
    return await renderAdmin(env, user, null)
  }
  if (url.pathname === '/admin/users' && request.method === 'POST') {
    return await handleCreateUser(request, env, user)
  }
  return new Response('not found', { status: 404 })
}

function forbidden(): Response {
  return page({
    title: '一息',
    theme: DEFAULT_THEME,
    css: CSS,
    status: 403,
    body: `<main class="solo"><h1>这一页不是给你的</h1>
<p class="lede">发号台只有 owner 能进。你的东西在<a href="/review">回顾</a>和<a href="/settings">设置</a>。</p></main>`,
  })
}

// --- create ----------------------------------------------------------------

/** 128 bits, hex. The plaintext exists only inside this one response. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface OneTime {
  name: string
  token: string
  link: string
}

async function handleCreateUser(request: Request, env: Env, user: User): Promise<Response> {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return await renderAdmin(env, user, null, { error: '表单没读出来，重试一次。', status: 400 })
  }

  const raw = form.get('name')
  const name = typeof raw === 'string' ? raw.trim() : ''
  if (name.length === 0) return await renderAdmin(env, user, null, { error: '得给这个人起个名字。', status: 400 })
  if (name.length > 40) return await renderAdmin(env, user, null, { error: '名字太长了，40 个字以内。', status: 400 })

  const token = generateToken()
  // Only the hash is persisted. Nothing anywhere — not the DB, not a log line —
  // can turn a stored row back into a working credential.
  await createUser(env.DB, { name, tokenHash: await sha256Hex(token), isOwner: false })

  // Rendered directly rather than redirected: a 303 would drop the plaintext,
  // and putting it in the redirect's query string would write it into history.
  // The response is `no-store` (layout.ts's default) for the same reason.
  const origin = new URL(request.url).origin
  return await renderAdmin(env, user, {
    name,
    token,
    link: `${origin}/settings?k=${token}`,
  })
}

// --- render ----------------------------------------------------------------

interface RenderOptions {
  error?: string
  status?: number
}

async function renderAdmin(env: Env, user: User, oneTime: OneTime | null, o: RenderOptions = {}): Promise<Response> {
  const since = shanghaiDate(Date.now() - (WINDOW_DAYS - 1) * 86400000)
  const [users, counts] = await Promise.all([listUsers(env.DB), countAttemptsPerUser(env.DB, since)])

  const attemptsById = new Map<number, number>()
  // `attempts` is the only column the query projects — see the header comment.
  // Another user's proceeded/abandoned split is their abandon rate, a portrait
  // of their self-control rather than a sign of life, and the guarantee is that
  // the SQL cannot produce it, not that this loop remembers to drop it.
  for (const c of counts) attemptsById.set(c.user_id, c.attempts)

  const rows: AdminRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    isOwner: u.is_owner === 1,
    joined: shanghaiDate(u.created_at),
    attempts: attemptsById.get(u.id) ?? 0,
  }))

  const body = `${consoleHeader(user, 'admin')}
<main>
  <h1>发号</h1>
  <p class="lede">一个 token 就是一个身份，没有注册、没有密码、没有邮箱。你在这里建人、生成 token，然后线下发给对方。</p>
  ${o.error ? `<p class="banner bad">${escapeHtml(o.error)}</p>` : ''}
  ${oneTime ? oneTimePanel(oneTime) : ''}
  <section class="card">
    <h2>新建一个人</h2>
    <form method="post" action="/admin/users">
      <div class="field">
        <label for="f-new-name">名字 · 只是给你自己认人用的</label>
        <input id="f-new-name" type="text" name="name" required maxlength="40" placeholder="老王" autocomplete="off">
      </div>
      <div class="actions">
        <button class="primary" type="submit">生成 token</button>
      </div>
    </form>
    <p class="note">生成出来的 token <b>只显示这一次</b>，库里只存它的 SHA-256。丢了只能重新建一个人。</p>
  </section>
  <hr class="sep">
  <h2>已经发出去的号</h2>
  <p class="note note-tight">「最近 ${WINDOW_DAYS} 天被拦」只是一个计数，用来判断对方的快捷指令到底配通了没有。</p>
  ${rows.map(userRow).join('\n')}
  ${privacyNote()}
</main>`

  return page({ title: '发号 · 一息', theme: DEFAULT_THEME, css: CSS, body, status: o.status ?? 200 })
}

function oneTimePanel(t: OneTime): string {
  return `<section class="card hot">
  <h2>${escapeHtml(t.name)} 的 token</h2>
  <p class="note flat">现在就复制走，<b>这一页一刷新就再也看不到了</b>。</p>
  <p class="mono secret big">${escapeHtml(t.token)}</p>
  <h2>发给对方的第一个链接</h2>
  <p class="note flat">对方在 iPhone 上打开它，就会种下 cookie，之后 token 不再出现在网址里。</p>
  <p class="mono secret">${escapeHtml(t.link)}</p>
</section>`
}

function userRow(r: AdminRow): string {
  return `<section class="card">
  <div class="card-head">
    <span class="name">${escapeHtml(r.name)}</span>
    <span class="key">#${r.id}</span>
    ${r.isOwner ? '<span class="badge">owner</span>' : ''}
  </div>
  <p class="flat" data-count="${r.attempts}">最近 ${WINDOW_DAYS} 天被拦 <b class="num">${r.attempts}</b> 次</p>
  <p class="note">加入于 <span class="num">${escapeHtml(r.joined)}</span></p>
</section>`
}

function privacyNote(): string {
  return `<p class="note privacy">这一页<b>只有</b>上面这些数字。谁在什么时候、被哪个 App 拽住过、后来又怎么选的——这些只有本人在自己的<a href="/review">回顾</a>页看得到，这里读不出来，也没有别的地址能读出来。这一条有测试守着。</p>`
}
