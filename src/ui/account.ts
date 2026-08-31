// The account pages: register, sign in, bind an old token, reset a password,
// and the one page that shows somebody their own gate token again.
//
// What these replaced: the owner minting a token by hand at /admin and sending
// it over a chat app. That worked for three people and for nobody after them,
// and it had no answer at all for "I lost it".
//
// THE CLOSED LOOP, which is the only thing on these pages worth explaining
// carefully to a reader:
//
//   forgot the password → reset it with the token       (/recover)
//   forgot the token    → sign in and read it back      (/account)
//   lost both           → nothing. The account is gone.
//
// There is no mail in the middle because there is no mail service, deliberately
// (see the header of src/account.ts). That makes the last line real rather than
// theoretical, so /register states it in those words, above the form, before
// anyone types anything. A person who finds out about it later, at the moment
// they need it, has been lied to by omission.
//
// Everything here is a plain HTML form with POST/redirect/GET. No fetch, no
// framework, no client-side validation that the server does not repeat: these
// pages are opened one-handed on a phone, often on the connection that made
// somebody reach for the phone in the first place.

import type { Env, User } from '../types'
import {
  accountErrorMessage,
  accountSummary,
  changePassword,
  claimAccount,
  login,
  logout,
  register,
  resetPasswordWithToken,
  revealToken,
  type AccountError,
} from '../account'
import { sessionIdFrom } from '../auth'
import { shanghaiDate } from '../db'
import { CONSOLE_CSS, consoleHeader } from './console'
import { DEFAULT_THEME, escapeHtml, page } from './layout'

/**
 * Mirrors src/account.ts, which is the authority and re-checks every one of
 * them. These exist only so the `minlength`/`maxlength` attributes and the
 * sentence printed next to a field cannot drift apart from each other.
 */
const PASSWORD_MIN = 8
const PASSWORD_MAX = 200
const EMAIL_MAX = 254
const NAME_MAX = 40

const FORM_UNREADABLE = '表单没读出来，重试一次。'

// --- /register --------------------------------------------------------------

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return registerPage({})
  if (request.method !== 'POST') return methodNotAllowed()

  const form = await readForm(request)
  if (!form) return registerPage({ error: FORM_UNREADABLE, status: 400 })

  const draft: SignupDraft = { email: field(form, 'email'), name: field(form, 'name') }
  const password = secret(form, 'password')

  // Whether two boxes match is a question about this form, not about the
  // account, so it never reaches src/account.ts.
  if (password !== secret(form, 'password2')) {
    return registerPage({ draft, error: MISMATCH, status: 400 })
  }

  const res = await register(env, { email: draft.email, password, name: draft.name || undefined })
  if (!res.ok) {
    // Being told the address is taken is useless without a way to act on it,
    // and retyping it into a form the user has to go find is the friction that
    // makes people register a second throwaway account instead.
    const action =
      res.error === 'email_taken'
        ? { href: `/login?email=${encodeURIComponent(draft.email)}`, label: '去登录 →' }
        : undefined
    return registerPage({ draft, error: accountErrorMessage(res.error), status: 400, action })
  }

  // 303 rather than rendering the account page from this POST: a phone that
  // pull-to-refreshes on the result would otherwise re-submit a registration.
  return seeOther('/account?new=1', res.setCookie)
}

interface SignupDraft {
  email: string
  name: string
}

interface RegisterOptions {
  draft?: SignupDraft
  error?: string
  status?: number
  action?: { href: string; label: string }
}

function registerPage(o: RegisterOptions): Response {
  const d = o.draft
  return gatePage({
    title: '注册 · 一息',
    status: o.status,
    body: `<h1>注册</h1>
<p class="lede">注册之后你会拿到一把 <b>token</b>。iPhone 的「快捷指令」拿它认出你，你被拦下的每一条记录也都记在它名下。它就是这个账号本身。</p>
${banner(o.error, 'bad', o.action)}

<section class="card deal">
  <h2>先说清楚代价</h2>
  <p>这里<b>没有邮件服务</b>。邮箱不发信、不验证，也不能用来找回密码——它只是你下次登录时的用户名。</p>
  <p>能救你的是两样东西，它们互为备份：</p>
  <ul>
    <li><b>忘了密码</b> —— 用 token 重置。在<a href="/recover">重置那一页</a>把 token 贴进去，直接设一个新的。</li>
    <li><b>忘了 token</b> —— 用密码登录，账号页上点一下就能看到它。它是加密存在服务器上的。</li>
    <li><b>两样都丢了</b> —— <b>没有办法</b>。没有验证邮件、没有客服、没有后门。这个账号连同里面所有记录都拿不回来，只能重新注册一个空的。</li>
  </ul>
  <p class="note flat">这个闭环是故意做成这样的：一个自己用的小工具不值得为它接一整套邮件系统，代价就是你得自己留住其中一样。注册完先把 token 存进密码管理器，一分钟的事。</p>
</section>

<section class="card">
  <form method="post" action="/register">
    ${emailField('f-reg-email', d?.email ?? '', 'username')}
    <div class="field">
      <label for="f-reg-name">名字 · 选填，只显示在这几个页面上</label>
      <input id="f-reg-name" type="text" name="name" value="${escapeHtml(d?.name ?? '')}"
        maxlength="${NAME_MAX}" autocomplete="nickname" placeholder="留空就用邮箱 @ 前面那截">
    </div>
    ${passwordField('f-reg-pw', 'password', `密码 · 至少 ${PASSWORD_MIN} 位`, 'new-password')}
    ${passwordField('f-reg-pw2', 'password2', '再打一遍', 'new-password')}
    <div class="actions">
      <button class="primary" type="submit">注册</button>
    </div>
  </form>
</section>

<p class="foot">已经有账号了？<a href="/login">登录</a>。<br>
手里已经有一把别人发给你的 token？<a href="/claim">给它绑上邮箱和密码</a>，别在这里重新注册——重新注册会拿到一把新的，旧记录就找不回来了。</p>`,
  })
}

// --- /login -----------------------------------------------------------------

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams
  const next = safeNext(q.get('next'))

  if (request.method === 'GET') {
    // Arriving either from the "already registered" banner with the address
    // already typed once, or from a signed-out tap on a console link. Both
    // deserve to land where they were going.
    const prefill = q.get('email') ?? ''
    return loginPage({ ...(prefill ? { email: prefill } : {}), next })
  }
  if (request.method !== 'POST') return methodNotAllowed()

  const form = await readForm(request)
  if (!form) return loginPage({ error: FORM_UNREADABLE, status: 400 })

  const email = field(form, 'email')
  const res = await login(env, { email, password: secret(form, 'password') })

  // Note what is missing: any branch on *why* it failed. src/account.ts collapses
  // "no such address", "malformed address" and "wrong password" into one error
  // code and burns the same PBKDF2 work in all three cases, and this page must
  // not undo that by wording them apart. Given what /review contains, "does this
  // person use 一息" is itself worth hiding, so the failed response — message,
  // status, and every byte of markup — is identical for a stranger and for a
  // real account with a typo'd password.
  if (!res.ok) return loginPage({ email, error: accountErrorMessage(res.error), status: 401, next })
  return seeOther(next ?? '/review', res.setCookie)
}

interface LoginOptions {
  email?: string
  next?: string
  error?: string
  status?: number
}

function loginPage(o: LoginOptions): Response {
  return gatePage({
    title: '登录 · 一息',
    status: o.status,
    body: `<h1>登录</h1>
<p class="lede">登录只是为了让你在这几个页面上看到自己的记录和 token。快捷指令那边不受影响，它认的一直是 token。</p>
${banner(o.error)}

<section class="card">
  <form method="post" action="${o.next ? `/login?next=${encodeURIComponent(o.next)}` : '/login'}">
    ${emailField('f-in-email', o.email ?? '', 'username')}
    ${passwordField('f-in-pw', 'password', '密码', 'current-password')}
    <div class="actions">
      <button class="primary" type="submit">登录</button>
    </div>
  </form>
</section>

<p class="foot">忘了密码？<a href="/recover">用 token 重置</a>。<br>
还没有账号？<a href="/register">注册一个</a>。</p>`,
  })
}

// --- /claim -----------------------------------------------------------------

/**
 * Binding an email and password onto a token that predates accounts.
 *
 * This page exists because registering afresh mints a *different* token, which
 * would quietly abandon the holder's history, their app config and — for the
 * owner, whose own token is the oldest one there is — their `is_owner` flag.
 * Anybody arriving with a token in hand belongs here, not on /register.
 */
export async function handleClaim(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return claimPage({})
  if (request.method !== 'POST') return methodNotAllowed()

  const form = await readForm(request)
  if (!form) return claimPage({ error: FORM_UNREADABLE, status: 400 })

  const draft: SignupDraft = { email: field(form, 'email'), name: field(form, 'name') }
  const password = secret(form, 'password')
  if (password !== secret(form, 'password2')) {
    return claimPage({ draft, error: MISMATCH, status: 400 })
  }

  const res = await claimAccount(env, {
    // Trimmed, unlike a password: a token pasted with a stray space is the
    // single most common way this whole product fails to work (see /setup).
    token: field(form, 'token'),
    email: draft.email,
    password,
    name: draft.name || undefined,
  })
  if (!res.ok) return claimPage({ draft, error: accountErrorMessage(res.error), status: 400 })
  return seeOther('/account?claimed=1', res.setCookie)
}

interface ClaimOptions {
  draft?: SignupDraft
  error?: string
  status?: number
}

function claimPage(o: ClaimOptions): Response {
  const d = o.draft
  return gatePage({
    title: '绑定 · 一息',
    status: o.status,
    body: `<h1>给已有的 token 绑账号</h1>
<p class="lede">你手里那把 token 是发号时代给出去的，只有哈希存在服务器上。绑一次邮箱和密码，以后忘了它就能登录看回来。</p>
${banner(o.error)}

<section class="card">
  <form method="post" action="/claim">
    ${tokenField('f-cl-token')}
    ${emailField('f-cl-email', d?.email ?? '', 'username')}
    <div class="field">
      <label for="f-cl-name">名字 · 选填，留空就沿用现在这个</label>
      <input id="f-cl-name" type="text" name="name" value="${escapeHtml(d?.name ?? '')}"
        maxlength="${NAME_MAX}" autocomplete="nickname">
    </div>
    ${passwordField('f-cl-pw', 'password', `密码 · 至少 ${PASSWORD_MIN} 位`, 'new-password')}
    ${passwordField('f-cl-pw2', 'password2', '再打一遍', 'new-password')}
    <div class="actions">
      <button class="primary" type="submit">绑定</button>
    </div>
  </form>
  <p class="note">token 本身不变，快捷指令不用改。绑定只是多给这个账号一条登录的路。</p>
</section>

<p class="foot">没有 token，只是想开始用？<a href="/register">注册一个新的</a>。</p>`,
  })
}

// --- /recover ---------------------------------------------------------------

export async function handleRecover(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') return recoverPage({})
  if (request.method !== 'POST') return methodNotAllowed()

  const form = await readForm(request)
  if (!form) return recoverPage({ error: FORM_UNREADABLE, status: 400 })

  const password = secret(form, 'password')
  if (password !== secret(form, 'password2')) return recoverPage({ error: MISMATCH, status: 400 })

  const res = await resetPasswordWithToken(env, { token: field(form, 'token'), password })
  // The token is never echoed back into the re-rendered form. Retyping it is a
  // nuisance; leaving somebody's gate credential sitting in the markup of an
  // error page is worse.
  if (!res.ok) return recoverPage({ error: accountErrorMessage(res.error), status: 400 })
  return seeOther('/account?reset=1', res.setCookie)
}

interface RecoverOptions {
  error?: string
  status?: number
}

function recoverPage(o: RecoverOptions): Response {
  return gatePage({
    title: '重置密码 · 一息',
    status: o.status,
    body: `<h1>用 token 重置密码</h1>
<p class="lede">这里不发验证邮件。能证明你是你的，是你手里那把 token——它是 128 位随机数，比一封能被人翻走的邮件更硬。</p>
${banner(o.error)}

<section class="card">
  <form method="post" action="/recover">
    ${tokenField('f-rc-token')}
    ${passwordField('f-rc-pw', 'password', `新密码 · 至少 ${PASSWORD_MIN} 位`, 'new-password')}
    ${passwordField('f-rc-pw2', 'password2', '再打一遍', 'new-password')}
    <div class="actions">
      <button class="primary" type="submit">重置并登录</button>
    </div>
  </form>
  <p class="note">token 一般在你当初配快捷指令时那条「文本」动作里，或者在你的密码管理器里。重置之后 <b>token 不变</b>，快捷指令照常工作；但所有已经登录的浏览器都会被踢下线，只留你手上这一个。</p>
</section>

<p class="foot">token 也丢了？那这个账号真的回不来了，只能<a href="/register">重新注册一个空的</a>。<br>
密码想起来了？<a href="/login">去登录</a>。</p>`,
  })
}

// --- /account ---------------------------------------------------------------

export async function handleAccount(request: Request, env: Env, user: User): Promise<Response> {
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams
    return await accountPage(env, user, {
      reveal: q.get('show') === '1',
      welcome: q.has('new') ? 'new' : q.has('claimed') ? 'claimed' : q.has('reset') ? 'reset' : q.has('saved') ? 'saved' : null,
    })
  }
  if (request.method !== 'POST') return methodNotAllowed()

  const form = await readForm(request)
  if (!form) return await accountPage(env, user, { error: FORM_UNREADABLE, status: 400 })

  const op = field(form, 'op')

  if (op === 'logout') {
    return seeOther('/', await logout(env, sessionIdFrom(request)))
  }

  if (op !== 'password') {
    return await accountPage(env, user, { error: '不认识这个操作。', status: 400 })
  }

  const next = secret(form, 'password')
  if (next !== secret(form, 'password2')) {
    return await accountPage(env, user, { error: MISMATCH, status: 400 })
  }

  const res = await changePassword(env, {
    user,
    currentPassword: secret(form, 'current'),
    newPassword: next,
  })
  if (!res.ok) return await accountPage(env, user, { error: passwordChangeMessage(res.error), status: 400 })
  // changePassword drops every session including this one, so the fresh cookie
  // it hands back has to ride along or the redirect below lands on a 401.
  return seeOther('/account?saved=1', res.setCookie)
}

/**
 * `invalid_credentials` means something different on this form than it does on
 * /login: the session already says who you are, so the only thing that can be
 * wrong is the current-password box. Saying "邮箱或密码不对" here would send
 * somebody hunting for a typo in a field that is not on the page.
 */
function passwordChangeMessage(error: AccountError): string {
  return error === 'invalid_credentials' ? '当前密码不对。' : accountErrorMessage(error)
}

type Welcome = 'new' | 'claimed' | 'reset' | 'saved' | null

interface AccountOptions {
  reveal?: boolean
  welcome?: Welcome
  error?: string
  status?: number
}

async function accountPage(env: Env, user: User, o: AccountOptions): Promise<Response> {
  const summary = await accountSummary(env, user)
  // Asked for only on the request that is going to print it. The default render
  // cannot leak a token it never fetched — the masking is not a CSS trick over
  // a value that is sitting in the markup anyway.
  const token = o.reveal ? await revealToken(env, user) : null

  return page({
    title: `账号 · ${user.name}`,
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + ACCOUNT_CSS,
    status: o.status ?? 200,
    body: `${consoleHeader(user, 'account')}
<main>
  <h1>账号</h1>
  ${banner(o.error, 'bad')}
  ${welcomeBanner(o.welcome ?? null)}

  <section class="card">
    <div class="card-head">
      <span class="name">${escapeHtml(user.name)}</span>
      <span class="key">#${user.id}</span>
      ${user.is_owner ? '<span class="badge">owner</span>' : ''}
    </div>
    <p class="flat">${summary.email ? `<span class="mono">${escapeHtml(summary.email)}</span>` : '<span class="none">还没有绑定邮箱</span>'}</p>
    <p class="note">加入于 <span class="num">${escapeHtml(shanghaiDate(user.created_at))}</span></p>
  </section>

  ${tokenCard(o.reveal === true, token)}
  ${summary.hasPassword ? passwordCard() : bindCard()}

  <hr class="sep">
  <form method="post" action="/account">
    <button class="linky" type="submit" name="op" value="logout">退出登录</button>
  </form>
  <p class="note">退出只清掉这台设备上的登录状态。快捷指令照常拦你——它认的是 token，不是这个登录。</p>
</main>`,
    script: o.reveal === true && token !== null ? COPY_SCRIPT : undefined,
  })
}

function welcomeBanner(w: Welcome): string {
  switch (w) {
    case 'new':
      return banner('注册好了。别急着走——先点下面的「显示」，把 token 存进密码管理器。', 'good')
    case 'claimed':
      return banner('绑好了。以后忘了 token 就用邮箱和密码登录，在这一页看回来。', 'good')
    case 'reset':
      return banner('密码已经重置，其他设备上的登录都被踢掉了。', 'good')
    case 'saved':
      return banner('密码改好了。其他设备上的登录都被踢掉了，这台还在。', 'good')
    default:
      return ''
  }
}

/**
 * The token, masked by default.
 *
 * It is the key to every private record this person has, and the realistic way
 * it escapes is not an attacker on the wire — it is a screenshot, a screen share
 * or somebody standing behind them on the subway. So the default page does not
 * contain it: revealing is a plain GET to /account?show=1, which fetches and
 * prints it, and the page is `no-store` with `referrer-policy: no-referrer`
 * (both from layout.ts), so neither a cache nor a Referer carries it onward.
 *
 * Doing it server-side rather than with a CSS mask over a hidden value is the
 * difference between "you cannot see it" and "it is not there".
 */
function tokenCard(revealed: boolean, token: string | null): string {
  const head = `<h2>你的 token</h2>
  <p class="note flat">快捷指令用它认出你，它也是你所有记录的钥匙。别截图，别贴进聊天框。</p>`

  if (!revealed) {
    return `<section class="card">
  ${head}
  <p class="tok masked" aria-hidden="true">••••••••••••••••</p>
  <div class="actions">
    <a class="linky tap" href="/account?show=1">显示</a>
  </div>
  <p class="note">要把它配进 iPhone，去<a href="/setup">怎么配</a>——那一页已经替你把完整的地址拼好了，照抄就行。</p>
</section>`
  }

  if (token === null) {
    // Either an old row that was never claimed, or one sealed under a TOKEN_KEY
    // that has since been rotated. The token still works; it just cannot be
    // shown, and saying so beats printing something plausible and wrong.
    return `<section class="card">
  ${head}
  <p class="empty">服务器这边打不开你的 token 原文，只存着它的哈希。<br>它照常能用，只是这里看不到。</p>
  <div class="actions"><a class="linky tap" href="/claim">用它绑一次账号</a></div>
</section>`
  }

  return `<section class="card">
  ${head}
  <p class="tok" id="tok">${escapeHtml(token)}</p>
  <div class="actions">
    <button class="linky tap" type="button" id="cp">复制</button>
    <a class="linky tap" href="/account">藏起来</a>
  </div>
  <p class="note">要把它配进 iPhone，去<a href="/setup">怎么配</a>——那一页已经替你把完整的地址拼好了，照抄就行。</p>
</section>`
}

function passwordCard(): string {
  return `<section class="card">
  <h2>改密码</h2>
  <form method="post" action="/account">
    ${passwordField('f-ac-cur', 'current', '当前密码', 'current-password')}
    ${passwordField('f-ac-pw', 'password', `新密码 · 至少 ${PASSWORD_MIN} 位`, 'new-password')}
    ${passwordField('f-ac-pw2', 'password2', '再打一遍', 'new-password')}
    <div class="actions">
      <button class="primary" type="submit" name="op" value="password">保存新密码</button>
    </div>
  </form>
  <p class="note">改密码不会换掉 token，快捷指令不用动。但其他设备上的登录会全部失效，只留你手上这一个。</p>
</section>`
}

function bindCard(): string {
  return `<section class="card">
  <h2>还没有密码</h2>
  <p class="flat">这个账号是发号时代建的，只有一把 token，没有邮箱也没有密码。现在这样也能用，但 token 一丢就没了。</p>
  <div class="actions"><a class="linky tap" href="/claim">给它绑上邮箱和密码</a></div>
</section>`
}


/**
 * Clipboard, with a selection fallback. `navigator.clipboard` needs a secure
 * context, which `wrangler dev` over plain http is not, and a copy button that
 * silently does nothing is worse than no button — the fallback selects the
 * token so iOS offers 拷贝 on the long-press menu.
 */
const COPY_SCRIPT = `
var b=document.getElementById('cp'),t=document.getElementById('tok');
if(b&&t){b.addEventListener('click',function(){
  var s=t.textContent||'';
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(s).then(function(){b.textContent='已复制'},select);
  }else{select()}
  function select(){
    var r=document.createRange();r.selectNodeContents(t);
    var sel=window.getSelection();
    if(sel){sel.removeAllRanges();sel.addRange(r)}
    b.textContent='已选中，长按拷贝';
  }
})}`

// --- shared page shell ------------------------------------------------------

interface GatePageOptions {
  title: string
  body: string
  status?: number
}

/**
 * The shell for the three pages a signed-out stranger can reach. No console
 * header — there is no user yet — but the same tokens, the same card and field
 * styling, and the same narrow column, so arriving here from / does not feel
 * like arriving at a different product.
 */
function gatePage(o: GatePageOptions): Response {
  return page({
    title: o.title,
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + ACCOUNT_CSS,
    status: o.status ?? 200,
    body: `<main class="gate">
<a class="mark" href="/">一息</a>
${o.body}
</main>`,
  })
}

// --- form pieces ------------------------------------------------------------

/**
 * Only a same-site path survives. An absolute URL forwarded from `?next=` would
 * make the sign-in page an open redirect — the classic way a phishing link
 * borrows a real login screen — and `//host` is an absolute URL wearing a
 * relative disguise.
 */
function safeNext(raw: string | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  return raw
}

const MISMATCH = '两次输入的密码不一样，再来一次。'

/**
 * `action` is the way out of the problem the banner just described — "this
 * address is already registered" is only half an answer without a link to the
 * sign-in page.
 *
 * Both the message and the link are escaped, with no exception for "our own"
 * strings: the moment one message is allowed to carry markup, the next one
 * carries a user's email.
 */
function banner(
  text: string | undefined,
  kind: 'bad' | 'good' = 'bad',
  action?: { href: string; label: string },
): string {
  if (!text) return ''
  const cta = action
    ? ` <a class="banner-go" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
    : ''
  return `<p class="banner ${kind}">${escapeHtml(text)}${cta}</p>`
}

function emailField(id: string, value: string, autocomplete: string): string {
  return `<div class="field">
      <label for="${id}">邮箱 · 只当用户名用，不发信</label>
      <input id="${id}" type="email" name="email" value="${escapeHtml(value)}" required
        maxlength="${EMAIL_MAX}" autocomplete="${autocomplete}" inputmode="email"
        autocapitalize="none" autocorrect="off" spellcheck="false">
    </div>`
}

function passwordField(id: string, name: string, label: string, autocomplete: string): string {
  const min = autocomplete === 'new-password' ? ` minlength="${PASSWORD_MIN}"` : ''
  return `<div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" type="password" name="${name}" required${min} maxlength="${PASSWORD_MAX}"
        autocomplete="${autocomplete}">
    </div>`
}

/**
 * Deliberately `type="text"`. A masked field makes it impossible to see whether
 * a 32-character paste landed intact, and a token pasted with a trailing space
 * is the failure this product already has a troubleshooting section about.
 */
function tokenField(id: string): string {
  return `<div class="field">
      <label for="${id}">token · 32 位十六进制，粘贴进来</label>
      <input id="${id}" type="text" name="token" required maxlength="200" class="mono"
        autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" inputmode="latin">
    </div>`
}

// --- request plumbing -------------------------------------------------------

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData()
  } catch {
    return null
  }
}

function field(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v.trim() : ''
}

/** Never trimmed. Trimming a password silently changes it. */
function secret(form: FormData, key: string): string {
  const v = form.get(key)
  return typeof v === 'string' ? v : ''
}

function seeOther(location: string, setCookie?: string): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  if (setCookie) headers.append('set-cookie', setCookie)
  return new Response(null, { status: 303, headers })
}

function methodNotAllowed(): Response {
  return new Response('method not allowed', { status: 405, headers: { allow: 'GET, POST' } })
}

// --- styles -----------------------------------------------------------------

const ACCOUNT_CSS = `
/* CONSOLE_CSS only reaches text and number inputs. Email and password fields
   need the same 16px floor for the same reason: mobile Safari zooms the viewport
   on focus for anything smaller, and never zooms back out. */
input[type=email],input[type=password]{
  display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;
  padding:10px 12px;color:var(--fg);background:transparent;
  border:1px solid var(--rule);border-radius:10px;
}
main.gate{max-width:26rem;padding-top:calc(env(safe-area-inset-top) + 7vh)}
.mark{
  display:block;margin:0 0 26px;font-size:19px;font-weight:600;
  letter-spacing:.24em;text-indent:.24em;text-decoration:none;
}
main.gate h1{margin:0 0 .5rem;font-size:1.25rem;font-weight:400;letter-spacing:.14em}
.deal ul{margin:0 0 12px;padding-left:1.25rem}
.deal li{margin-bottom:.5rem;line-height:1.75}
.deal li::marker{color:var(--faint)}
.deal a,.foot a,.note a{color:var(--dim);text-underline-offset:3px}
.foot{margin-top:26px;color:var(--faint);font-size:12px;line-height:1.9}
.none{color:var(--faint)}
.tok{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:15px;
  word-break:break-all;background:var(--rule);border-radius:10px;
  padding:12px 14px;margin:0 0 10px;-webkit-user-select:all;user-select:all;
}
.tok.masked{color:var(--faint);letter-spacing:.3em;-webkit-user-select:none;user-select:none}
a.linky.tap,button.linky.tap{display:inline-flex;align-items:center;min-height:44px;text-decoration:underline}
`
