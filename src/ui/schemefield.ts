// The URL-scheme box, and everything that used to be the 「候选」 tab: a
// 「试跳」 button that jumps to whatever is in the box, a folded search that
// lists candidates inline, and a draft that survives leaving the page.
//
// It lived inside settings.ts until /goals needed the same box for a goal's
// jump target. Two copies of a script whose one hard rule is "assign
// location.href synchronously inside the click" is how the denylist drifted
// into three copies once already, so the box moved out instead.
//
// Nothing here knows which form it sits in. The probe finds its input by the
// `.field.scheme` wrapper it shares, the draft saves every named input the
// form has, and 「用这个」 fills whichever sibling `data-label-for` names.
//
// Both halves take the caller's translator: the markup renders in the page's
// language, and so does the script, which receives its strings as data rather
// than carrying them as literals (see `schemeFieldJs`).

import { escapeHtml } from './layout'
import { fold, hl, icon, seal } from './icons'
import { forbiddenSchemePattern } from '../scheme'
import { msg, type T } from '../i18n'

export interface SchemeFieldOptions {
  /** input 的 name。settings 用 'scheme'，goals 用 'target'。 */
  name: string
  value: string
  /** id 命名空间，同一页多个表单时避免 label for 撞 id。 */
  ns: string
  /** label 里的 HTML（调用方负责转义静态文案以外的内容）。 */
  label: string
  placeholder?: string
  required?: boolean
  /** 输入框下方那段说明的 HTML；不传用 settings 的小红书／起点例子。 */
  hint?: string
  /** 「用这个」时顺带填的显示名 input 的 name；settings 是 'label'，goals 是 'target_label'。 */
  labelFor: string
  /** 这一次请求的翻译器，由页面建好传进来。 */
  t: T
}

const DEFAULT_HINT = msg(
  '例：小红书 <code class="mono">xhsdiscover://</code>，起点读书 <code class="mono">QDReader://</code>。候选都<b>没验证过</b>，填完必须点<b>试跳</b>，App 真打开了才算数。',
)

/**
 * The scheme field, and everything the 「候选」 tab used to be.
 *
 * That tab was a destination: you had to know it existed, guess what 「候选」
 * meant, and go there BEFORE filling in the form that needed the answer — and
 * if you went mid-form, the form was gone when you came back. Its two jobs both
 * belong to this one input, so they live on it now:
 *
 *   - 「试跳」 beside the box, which jumps to whatever is currently in it. One
 *     button covers a candidate you just picked, a scheme you saved months ago,
 *     and a line you pasted from a forum — the three things the standalone
 *     probe page did with three separate controls.
 *   - a folded search that lists candidates inline and writes the chosen one
 *     into the box, without a navigation and without touching the server.
 *
 * The two worked examples above the fold are load-bearing, not decoration: the
 * reader's actual question is 「这个格子里该填什么形状的东西」, and one real
 * answer settles it faster than any explanation of where to look it up.
 */
/**
 * The one formula for a namespaced field id: `f-${ns}-${name}`. /settings and
 * /goals both render the same field set once per row plus once for the add
 * form, so every id has to be namespaced or same-named inputs across rows
 * would collide and `<label for>` would point at the wrong one.
 */
export function fieldId(ns: string, name: string): string {
  return `f-${ns}-${name}`
}

export function schemeField(o: SchemeFieldOptions): string {
  const id = fieldId(o.ns, o.name)
  const required = o.required === false ? '' : ' required'
  const t = o.t
  return `<div class="field scheme" data-label-for="${escapeHtml(o.labelFor)}">
    <label for="${id}">${o.label}</label>
    <div class="withtry">
      <input id="${id}" type="text" name="${escapeHtml(o.name)}" value="${escapeHtml(o.value)}" placeholder="${escapeHtml(o.placeholder ?? 'someapp://')}"${required}
        inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="200" class="mono sc">
      <button class="try" type="button" data-try>${icon('jump')}${t('试跳')}</button>
    </div>
    <p class="hint ex">${hl('caveat', o.hint ?? t(DEFAULT_HINT))}</p>
    ${fold(
      t('不知道填什么？按 App 名字找'),
      `<div class="pick">
        <div class="manual">
          <input type="text" class="pq" placeholder="${t('起点读书')}" maxlength="40"
            inputmode="search" autocapitalize="none" autocorrect="off" spellcheck="false"
            aria-label="${t('按 App 名字搜索候选')}">
          <button type="button" class="pgo">${icon('lookup')}${t('找')}</button>
        </div>
        <div class="pout" role="status" aria-live="polite"></div>
      </div>`,
      'pickwrap',
    )}
  </div>`
}

export const SCHEME_FIELD_CSS = `
.hint{font-size:14px;line-height:1.75;color:var(--dim);margin:0 0 15px}
.hint b{color:var(--fg)}
.hint .ic{color:var(--dim)}
.hint code{font-size:.92em;background:var(--rule);border-radius:4px;padding:.1em .36em}
.hint.ex{margin:9px 0 0;font-size:13px;line-height:1.7;color:var(--faint)}
.hint.ex b{color:var(--dim)}
.hint.ex code{font-size:.95em}

/* --- scheme field: probe button beside the box --- */
.withtry{display:flex;gap:8px;align-items:stretch}
.withtry input{flex:1;min-width:0}
button.try{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:10px;padding:0 15px;font-size:15px;font-weight:600;min-height:44px;
}
button.try:active{opacity:.72}
button.try .ic{width:16px;height:16px}

/* --- the inline candidate picker --- */
/* This is the discoverability fix, so it may not look like a footnote: the
   whole complaint was that nobody could tell what the 「候选」 tab was for.
   Its own outline, and 「dim」 rather than 「faint」. */
details.pickwrap{margin:12px 0 0}
details.pickwrap > summary{border:1px solid var(--rule);border-radius:9px;
  padding:9px 12px;font-size:14px;letter-spacing:0;color:var(--dim);width:100%;
  box-sizing:border-box}
details.pickwrap > summary:active{opacity:.7}
details.pickwrap[open] > summary{color:var(--fg)}
details.pickwrap > summary .ic.chev{width:13px;height:13px}
.pick{margin:10px 0 0}
.manual{display:flex;gap:8px;align-items:stretch}
.manual input{flex:1;min-width:0}
.manual button{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  background:transparent;color:var(--fg);border:1px solid var(--rule);
  border-radius:10px;padding:0 15px;font-size:15px;font-weight:600;min-height:44px;
}
.manual button:active{opacity:.72}
.manual button[disabled]{opacity:.5}
.pout{margin:12px 0 0}
.pmsg{margin:0;font-size:13px;line-height:1.75;color:var(--faint)}
.pmsg b{color:var(--fg)}
.phit{margin:0 0 6px;font-size:14px;color:var(--dim)}
.phit b{color:var(--fg)}
.phit .why{color:var(--faint);font-size:13px}
.cd{border-top:1px solid var(--rule);padding:12px 0 4px;margin:0}
.cd:first-of-type{border-top:0}
.cd-h{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:0 0 8px}
.cd-sc{word-break:break-all;font-size:15px;-webkit-user-select:all;user-select:all}
.sig{display:inline-flex;align-items:center;gap:5px;font-size:12px;letter-spacing:.06em;
  white-space:nowrap;color:var(--dim)}
.t-verified .sig{color:var(--fg)}
.t-derived .sig{color:var(--danger)}
.marks{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.mk{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dim);
  text-decoration:none;border:1px solid var(--rule);border-radius:4px;padding:1.5px 9px;white-space:nowrap}
.mk.when{font-variant-numeric:tabular-nums;letter-spacing:.04em}
.cd .evidence{margin:0 0 8px;font-size:13px;color:var(--dim);line-height:1.6}
.cd .caveat{margin:0 0 8px;font-size:13px;color:var(--faint);line-height:1.6}
.cdacts{display:flex;gap:8px;align-items:stretch;margin:0 0 4px}
.cdacts button{flex:1;min-width:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;
  border-radius:8px;font-size:15px;font-weight:600;min-height:46px;padding:0 10px}
.cdacts .ctry{background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border)}
.cdacts .cuse{background:transparent;color:var(--fg);border:1px solid var(--rule)}
.cdacts button:active{opacity:.72}
.ord{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:18px;height:18px;border-radius:3px;border:1px solid currentColor;
  font-family:var(--num);font-size:12px;font-weight:400;opacity:.72}
.perr{margin:8px 0 0;font-size:13px;color:var(--danger);line-height:1.7}
`

/**
 * Icon markup the client-side renderer needs, resolved server-side.
 *
 * The alternative was a second copy of the SVG path data in a template string,
 * which is how the two-copies-of-the-denylist problem started. `icon()` stays
 * the only place any of this geometry is written down.
 */
const PICK_ICONS = JSON.stringify({
  jump: icon('jump'),
  save: icon('save'),
  source: icon('source'),
  agree: icon('agree'),
  clock: icon('clock'),
  verified: seal('verified'),
  listed: seal('listed'),
  derived: seal('derived'),
})

/**
 * Every sentence the picker can put on the page, translated once per request
 * and handed to the script as data.
 *
 * The same shape as `PICK_ICONS` above, and for the same reason: a browser
 * script cannot call `t()`, so whatever it says has to be resolved on the
 * server and injected. `JSON.stringify` does the escaping, which is what makes
 * it safe for a translation to contain an apostrophe or a quote — the script
 * never builds a string literal of its own out of this.
 */
function pickText(t: T): string {
  return JSON.stringify({
    // The three confidence tiers a candidate can be labelled with.
    tierVerified: t('实测过'),
    tierListed: t('清单里有'),
    tierDerived: t('猜的'),
    agree: t('两份清单一致'),
    keyHint: t('建议 App 键'),
    try: t('试跳'),
    use: t('用这个'),
    derivedNote: t('表里没有这个 App。下面几条是<b>从 App Store 的 bundle id 猜出来的</b>，没人验证过 —— 一定要先试跳。'),
    unknown: t('没找到这个 App。可以自己在上面的格子里填一个 scheme，再点<b>试跳</b>试试。'),
    // Why a search could not be answered at all — one line each, and a
    // fallback for a reason this build has never heard of.
    refused: t('App Store 拒了我们这次查询（它会拒绝 Cloudflare 的出口地址）。表里没有的 App 只能自己找 scheme。'),
    timeout: t('连 App Store 超时了。过一会儿再试，或者自己填一个 scheme 直接试跳。'),
    unreadable: t('App Store 返回的内容看不懂。自己填一个 scheme 直接试跳也行。'),
    tooShort: t('名字太短了，多打几个字。'),
    uncheckedOther: t('这次没查成。'),
    needName: t('先填 App 的名字。'),
    searching: t('找…'),
    netError: t('没查成，网络或者服务的问题。自己填一个 scheme 直接试跳也行。'),
    badCandidate: t('这条不像能跳的 scheme。'),
    badTyped: t('这个不像能跳的 scheme，形状要是 xxx:// 。'),
    emptyBox: t('先填一个 scheme。'),
  })
}

/**
 * Three jobs, and the first one is a hard requirement rather than a style.
 *
 * 1. THE JUMP. `location.href` assigned synchronously inside a click handler is
 *    the same gesture-stack navigation the breathing page's 「继续」 performs. An
 *    `<a href>`, a `setTimeout`, or anything reached after an `await` is a
 *    different mechanism in Safari and would certify schemes that then fail in
 *    the one place it counts. Delegation is fine — a bubbled click is still the
 *    same synchronous dispatch — but nothing may be awaited on the way.
 *
 *    `BAD` repeats the denylist the write path already enforces, because this
 *    box accepts anything the reader types, including a line pasted from a
 *    forum, and a derived candidate is assembled from a string Apple returned.
 *
 * 2. THE DRAFT. A jump leaves the page. Coming back from the app, Safari
 *    usually still has it — but "usually" is not good enough when what is at
 *    stake is a half-filled form the reader cannot reconstruct. So every jump
 *    writes the form to localStorage first (synchronously, before the
 *    assignment), and a load restores it once and deletes it. Submitting clears
 *    it too, or a stale draft would overwrite the row that was just saved.
 *
 * 3. THE PICKER. Search hits /api/candidates and renders inline; 「用这个」 is
 *    pure DOM, no navigation and no server round trip. That is the entire
 *    reason this stopped being a separate page: the reader is standing in the
 *    form, and taking them away from it to answer one field was the bug.
 *
 * A function rather than a constant, because every string it can print is copy
 * and copy has a language. The code itself is identical in both — only the
 * `TXT` object at the top differs, which is what keeps the one rule above
 * (a single synchronous `location.href`) impossible to break by translating.
 */
export function schemeFieldJs(t: T): string {
  return `
(function () {
  var BAD = /${forbiddenSchemePattern()}/i;
  var OK = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
  var ICONS = ${PICK_ICONS};
  var TXT = ${pickText(t)};
  var TIER = { verified: TXT.tierVerified, listed: TXT.tierListed, derived: TXT.tierDerived };
  var DRAFT_TTL = 30 * 60 * 1000;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function jump(scheme) {
    if (!scheme || !OK.test(scheme) || BAD.test(scheme)) return false;
    location.href = scheme;
    return true;
  }

  // --- draft ---------------------------------------------------------------

  function key(ns) { return 'yixi.draft.' + ns; }

  function inputsOf(form) {
    var out = [];
    var els = form.querySelectorAll('input[name], .pq');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.type === 'hidden') continue;
      out.push(el);
    }
    return out;
  }
  function nameOf(el) { return el.getAttribute('name') || (el.classList.contains('pq') ? '.pq' : ''); }

  function saveDraft(form) {
    var ns = form.getAttribute('data-ns');
    if (!ns) return;
    var els = inputsOf(form), fields = {};
    for (var i = 0; i < els.length; i++) {
      var n = nameOf(els[i]);
      if (!n) continue;
      fields[n] = els[i].type === 'checkbox' ? !!els[i].checked : els[i].value;
    }
    try {
      localStorage.setItem(key(ns), JSON.stringify({ at: Date.now(), fields: fields }));
    } catch (e) { /* private mode, or storage disabled — the jump still matters more */ }
  }

  function clearDraft(form) {
    var ns = form.getAttribute('data-ns');
    if (!ns) return;
    try { localStorage.removeItem(key(ns)); } catch (e) {}
  }

  function restoreDrafts() {
    var forms = document.querySelectorAll('form[data-ns]');
    for (var i = 0; i < forms.length; i++) {
      var form = forms[i];
      var ns = form.getAttribute('data-ns');
      var raw = null;
      try { raw = localStorage.getItem(key(ns)); } catch (e) { continue; }
      if (!raw) continue;
      try { localStorage.removeItem(key(ns)); } catch (e) {}
      var d;
      try { d = JSON.parse(raw); } catch (e) { continue; }
      if (!d || typeof d.at !== 'number' || Date.now() - d.at > DRAFT_TTL) continue;

      var fields = d.fields || {};
      var els = inputsOf(form);
      for (var k = 0; k < els.length; k++) {
        var n = nameOf(els[k]);
        if (!n || !(n in fields)) continue;
        if (els[k].readOnly) continue;
        if (els[k].type === 'checkbox') els[k].checked = !!fields[n];
        else els[k].value = fields[n] == null ? '' : String(fields[n]);
      }

      // Open every ancestor <details> so the restored form is actually visible;
      // silently refilling a collapsed form would look like nothing happened.
      var node = form.parentNode;
      while (node && node !== document.body) {
        if (node.tagName === 'DETAILS') node.open = true;
        node = node.parentNode;
      }
    }
  }

  // --- picker rendering ----------------------------------------------------

  function marksOf(c) {
    var out = [];
    if (c.confidence === 'verified' && c.verifiedOn) {
      out.push('<span class="mk when">' + ICONS.clock + esc(c.verifiedOn) + '</span>');
    }
    if (c.corroborated) out.push('<span class="mk">' + ICONS.agree + esc(TXT.agree) + '</span>');
    var srcs = c.sources || [];
    for (var i = 0; i < srcs.length; i++) {
      var u = String(srcs[i].url || '');
      // Only http(s) reaches an href. These strings come from our own table
      // today, but that is a property of the data, not of this renderer.
      if (!/^https?:\\/\\//i.test(u)) continue;
      out.push('<a class="mk" href="' + esc(u) + '" rel="noreferrer">' + ICONS.source + esc(srcs[i].label) + '</a>');
    }
    return out.length ? '<div class="marks">' + out.join('') + '</div>' : '';
  }

  function candidateHtml(c, appName) {
    var tier = TIER[c.confidence] || c.confidence;
    var sealIcon = ICONS[c.confidence] || '';
    return '<div class="cd t-' + esc(c.confidence) + '">' +
      '<div class="cd-h"><span class="sig">' + sealIcon + esc(tier) + '</span>' +
        '<code class="mono cd-sc">' + esc(c.scheme) + '</code></div>' +
      marksOf(c) +
      (c.verifiedNote ? '<p class="evidence">' + esc(c.verifiedNote) + '</p>' : '') +
      (c.caveat ? '<p class="caveat">' + esc(c.caveat) + '</p>' : '') +
      '<div class="cdacts">' +
        '<button type="button" class="ctry" data-scheme="' + esc(c.scheme) + '">' +
          '<span class="ord">1</span>' + ICONS.jump + esc(TXT.try) + '</button>' +
        '<button type="button" class="cuse" data-scheme="' + esc(c.scheme) + '" data-label="' + esc(appName) + '">' +
          '<span class="ord">2</span>' + ICONS.save + esc(TXT.use) + '</button>' +
      '</div></div>';
  }

  function hitsHtml(data) {
    var parts = [];
    if (data.state === 'derived') {
      parts.push('<p class="pmsg">' + TXT.derivedNote + '</p>');
    }
    for (var i = 0; i < data.hits.length; i++) {
      var h = data.hits[i];
      parts.push('<p class="phit"><b>' + esc(h.name) + '</b>' +
        (h.key ? ' <span class="why">' + esc(TXT.keyHint) + ' ' + esc(h.key) + '</span>' : '') + '</p>');
      for (var j = 0; j < h.candidates.length; j++) {
        parts.push(candidateHtml(h.candidates[j], h.name));
      }
    }
    return parts.join('');
  }

  var UNCHECKED = {
    refused: TXT.refused,
    timeout: TXT.timeout,
    unreadable: TXT.unreadable,
    'too-short': TXT.tooShort
  };

  function render(out, data) {
    if (data.state === 'table' || data.state === 'derived') { out.innerHTML = hitsHtml(data); return; }
    if (data.state === 'unknown') {
      out.innerHTML = '<p class="pmsg">' + TXT.unknown + '</p>';
      return;
    }
    if (data.state === 'unchecked') {
      out.innerHTML = '<p class="pmsg">' + esc(UNCHECKED[data.reason] || TXT.uncheckedOther) + '</p>';
      return;
    }
    out.innerHTML = '';
  }

  // --- wiring -------------------------------------------------------------

  function search(pick) {
    var input = pick.querySelector('.pq');
    var btn = pick.querySelector('.pgo');
    var out = pick.querySelector('.pout');
    var q = (input.value || '').trim();
    if (!q) { out.innerHTML = '<p class="pmsg">' + esc(TXT.needName) + '</p>'; return; }
    btn.disabled = true;
    out.innerHTML = '<p class="pmsg">' + esc(TXT.searching) + '</p>';
    fetch('/api/candidates?q=' + encodeURIComponent(q), { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(String(r.status))); })
      .then(function (data) { render(out, data); })
      .catch(function () {
        out.innerHTML = '<p class="perr">' + esc(TXT.netError) + '</p>';
      })
      .then(function () { btn.disabled = false; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    var el = t && t.closest ? t : null;
    if (!el) return;

    var go = el.closest('.pgo');
    if (go) { e.preventDefault(); search(go.closest('.pick')); return; }

    // Both jump paths below assign location.href in this same synchronous
    // dispatch. Nothing between here and the assignment may await.
    var ctry = el.closest('.ctry');
    if (ctry) {
      var form = ctry.closest('form[data-ns]');
      if (form) saveDraft(form);
      if (!jump(ctry.getAttribute('data-scheme'))) showJumpError(ctry, TXT.badCandidate);
      return;
    }

    var probe = el.closest('button[data-try]');
    if (probe) {
      var pform = probe.closest('form[data-ns]');
      var wrap = probe.closest('.field.scheme');
      var box = wrap ? wrap.querySelector('input.sc') : null;
      var v = box ? (box.value || '').trim() : '';
      if (pform) saveDraft(pform);
      if (!jump(v)) {
        showJumpError(probe, v ? TXT.badTyped : TXT.emptyBox);
      }
      return;
    }

    var use = el.closest('.cuse');
    if (use) {
      var uform = use.closest('form[data-ns]');
      var uwrap = use.closest('.field.scheme');
      if (!uform || !uwrap) return;
      var target = uwrap.querySelector('input.sc');
      var labelName = uwrap.getAttribute('data-label-for') || '';
      var labelBox = labelName ? uform.querySelector('input[name="' + labelName + '"]') : null;
      if (target) target.value = use.getAttribute('data-scheme') || '';
      var name = use.getAttribute('data-label') || '';
      if (labelBox && !labelBox.value && name) labelBox.value = name;
      if (target) { target.focus(); target.setSelectionRange(target.value.length, target.value.length); }
      return;
    }
  });

  function showJumpError(near, text) {
    var host = near.closest('.field') || near.parentNode;
    var p = host.querySelector('.perr');
    if (!p) {
      p = document.createElement('p');
      p.className = 'perr';
      host.appendChild(p);
    }
    p.textContent = text;
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target;
    if (!t || !t.closest || !t.classList.contains('pq')) return;
    // Enter in the search box must not submit the configuration form it sits in.
    e.preventDefault();
    search(t.closest('.pick'));
  });

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form && form.getAttribute && form.getAttribute('data-ns')) clearDraft(form);
  });

  restoreDrafts();
})();
`
}
