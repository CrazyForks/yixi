// /probe — the page that keeps a wrong URL scheme from being written down as a
// fact.
//
// An app's URL scheme cannot be recalled, and the lists circulating online are
// full of schemes that stopped working versions ago. Getting one wrong does not
// produce an error anywhere: the user breathes for ten seconds, taps 「继续」,
// and lands nowhere. So no scheme is ever hard-coded in this project — it gets
// typed into /settings, tried here on the actual phone, and kept only if the
// phone actually jumps.
//
// The button below deliberately does `location.href = scheme` inside a click
// handler rather than being a plain <a href>. Those are different mechanisms in
// Safari, and this page is only worth anything if it exercises the exact one the
// breathing page's 「继续」 button uses.

import type { Env, User } from '../types'
import { listUserApps } from '../db'
import { DEFAULT_THEME, escapeHtml, jsonScript, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { forbiddenSchemePattern } from '../scheme'

const CSS = `
${CONSOLE_CSS}
.try{width:100%;background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:12px;padding:16px 18px;font-size:16px;font-weight:600;min-height:56px;margin-top:4px}
.try:active{opacity:.72}
.scheme{display:block;color:var(--dim);word-break:break-all;margin:0 0 12px}
.after{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:10px}
.after a{color:var(--dim);font-size:13px}
.note.flat{margin:0}
.howto{border:1px solid var(--rule);border-radius:14px;padding:14px;margin:0 0 18px;font-size:13.5px;line-height:1.75;color:var(--dim)}
.howto b{color:var(--fg)}
.howto ul{margin:8px 0 0;padding-left:1.1em}
.howto li{margin:3px 0}
.manual{display:flex;gap:8px;align-items:stretch;margin-top:4px}
.manual input{flex:1;min-width:0}
.manual button{flex:0 0 auto;background:transparent;color:var(--fg);border:1px solid var(--rule);border-radius:10px;padding:0 16px;font-size:15px;font-weight:600}
`

export async function renderProbe(env: Env, user: User): Promise<Response> {
  const apps = await listUserApps(env.DB, user.id)

  const body = `${consoleHeader(user, 'probe')}
<main>
  <h1>实测 URL scheme</h1>
  <p class="lede">在 <b>iPhone 的 Safari 里</b>打开这一页，挨个点下面的按钮。<b>跳得动的才算数</b>——电脑上点是没有意义的。</p>
  ${howto()}
  ${apps.length === 0 ? emptyState() : apps.map(appCard).join('\n')}
  <hr class="sep">
  <h2>试一个还没存下来的</h2>
  <p class="note">从候选清单里抄一个来试，不用先写进配置。试通了再去<a href="/settings">设置</a>存。</p>
  <div class="manual">
    <input id="manual" type="text" class="mono" placeholder="someapp://" inputmode="url"
      autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" enterkeyhint="go">
    <button id="manual-go" type="button">试试</button>
  </div>
  <p class="note" id="manual-err" hidden></p>
  <p class="note">这一页不记录任何东西，点多少次都不会进你的回顾。试出结果之后，自己去<a href="/settings">设置</a>把 scheme 改对。</p>
</main>
${jsonScript('probe-data', apps.map((a) => a.scheme))}`

  return page({ title: '实测 · 一息', theme: DEFAULT_THEME, css: CSS, body, script: SCRIPT })
}

function howto(): string {
  return `<div class="howto">
  <b>怎么看结果</b>
  <ul>
    <li>手机<b>跳到那个 App</b> 了 —— scheme 对，记下来。</li>
    <li>点了<b>没反应</b>，或弹出「Safari 打不开该网页」 —— scheme 不对，换一个候选再试。</li>
    <li>一个候选都试不通 —— 这个 App 大概已经把 scheme 关掉了，只能对它放弃拦截。</li>
  </ul>
</div>`
}

function emptyState(): string {
  return `<p class="empty">还没有配置任何 App，没什么可试的。<br>先去<a href="/settings">设置</a>加一个。</p>`
}

function appCard(a: { app: string; label: string; scheme: string; enabled: number }, i: number): string {
  const key = escapeHtml(a.app)
  return `<section class="card${a.enabled ? '' : ' off'}" id="app-${key}">
  <div class="card-head">
    <span class="name">${escapeHtml(a.label)}</span>
    <span class="key">${key}</span>
    ${a.enabled ? '' : '<span class="badge">已停用</span>'}
  </div>
  <span class="mono scheme">${escapeHtml(a.scheme)}</span>
  <button class="try" type="button" data-i="${i}">试着跳到「${escapeHtml(a.label)}」</button>
  <div class="after">
    <span class="note flat">跳不动就换个 scheme 再试</span>
    <a href="/settings#app-${key}">去改这条配置</a>
  </div>
</section>`
}

/**
 * `location.href` inside the click handler — same synchronous, gesture-stack
 * navigation the breathing page performs, because a probe that tested a
 * different mechanism would certify schemes that then fail in production.
 *
 * BAD blocks the handful of schemes that would execute rather than navigate.
 * /settings rejects them on write; this repeats the check because the manual box
 * accepts anything the user types, including a line pasted from a forum.
 */
const SCRIPT = `
(function () {
  var BAD = /${forbiddenSchemePattern()}/i;
  var OK = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  var el = document.getElementById('probe-data');
  var schemes = el ? JSON.parse(el.textContent || '[]') : [];

  function jump(scheme) {
    if (!scheme || !OK.test(scheme) || BAD.test(scheme)) return false;
    location.href = scheme;
    return true;
  }

  var buttons = document.querySelectorAll('button[data-i]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function (e) {
      jump(schemes[Number(e.currentTarget.getAttribute('data-i'))]);
    });
  }

  var input = document.getElementById('manual');
  var err = document.getElementById('manual-err');
  function tryManual() {
    var v = (input.value || '').trim();
    if (jump(v)) { err.hidden = true; return; }
    err.textContent = v ? '这个不像一个能跳的 scheme，形状要是 xxx:// 。' : '先填一个 scheme。';
    err.hidden = false;
  }
  document.getElementById('manual-go').addEventListener('click', tryManual);
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') tryManual(); });
})();
`
