import type { Env } from '../types'
import { SESSION_TTL_MS, DEFAULT_WAIT_SECONDS } from '../types'
import { getSession, getUserApp } from '../db'
import {
  escapeHtml,
  jsonScript,
  page,
  themeFromParam,
  type ThemeName,
} from './layout'
import { safeScheme } from '../scheme'

/**
 * The breathing page — the only screen this product really has.
 *
 * Three things here are deliberate and must survive future "cleanups":
 *
 *  1. The proceed handler jumps to the app's URL scheme inside the synchronous
 *     call stack of the click. See PROCEED_NOTE below. Awaiting anything before
 *     the jump breaks the entire product on Safari.
 *  2. No numeric countdown. Progress is a ring, because a number invites you to
 *     stare at it and tick it down, which is the opposite of the point.
 *  3. 「算了」 appears first and is visually loud; 「继续打开」 arrives 800ms later
 *     as a quiet underlined link. Abandoning is meant to be the path of least
 *     resistance. This asymmetry IS the feature — do not "balance" the buttons.
 */

/** Inhale 4s, exhale 6s. The longer exhale is what actually settles you. */
const INHALE_MS = 4000
const EXHALE_MS = 6000

const MAX_WAIT_SECONDS = 300

/** One of these is shown after 「算了」. Quiet: no praise, no lecture. */
const FAREWELL_LINES = [
  '好，就到这里。',
  '这一次，你没有点进去。',
  '省下来的几分钟是你的。',
  '放下就好。',
]
const FAREWELL_SUB = '可以锁屏了。'

export interface BreatheView {
  theme: ThemeName
  /** Display name of the intercepted app, e.g. 小红书. User-supplied. */
  label: string
  waitSeconds: number
  /** null on /mock: the page renders identically but reports nothing. */
  sid: string | null
  /** '' when unset or unsafe; the proceed button then just says goodbye. */
  scheme: string
  farewell: string
  /** Overrides for the post-proceed screen; /mock is not really going anywhere. */
  wentMain?: string
  wentSub?: string
  /** Extra markup appended to <body> (the /mock version switcher). */
  extraBody?: string
  extraCss?: string
}

export async function renderBreathe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const theme = themeFromParam(url.searchParams.get('v'))
  const sid = url.searchParams.get('s')

  // Every dead end below renders the same quiet page. A 500 here would mean
  // staring at an error message while an automation holds your phone hostage.
  if (!sid) return expiredPage(theme, 400)

  const session = await getSession(env.DB, sid)
  if (!session) return expiredPage(theme, 404)
  if (session.resolved_at !== null) return expiredPage(theme, 410)
  if (Date.now() - session.created_at > SESSION_TTL_MS) return expiredPage(theme, 410)

  // The app row can legitimately be gone (deleted from /settings while the page
  // sat in a Safari tab). Fall back to something usable rather than erroring.
  const app = await getUserApp(env.DB, session.user_id, session.app)

  return breathePage({
    theme,
    label: app?.label ?? session.app,
    waitSeconds: clampWait(app?.wait_seconds ?? DEFAULT_WAIT_SECONDS),
    sid: session.sid,
    scheme: safeScheme(app?.scheme ?? ''),
    farewell: pickFarewell(session.sid),
  })
}

export function breathePage(v: BreatheView): Response {
  return page({
    title: '一息',
    theme: v.theme,
    css: BREATHE_CSS + (v.extraCss ?? ''),
    bodyAttrs: `class="t-${v.theme}" data-state="wait"`,
    body: breatheBody(v),
    script: BREATHE_JS,
  })
}

export function expiredPage(theme: ThemeName, status = 410): Response {
  return page({
    title: '一息',
    theme,
    status,
    css: BREATHE_CSS,
    bodyAttrs: 'data-state="gone"',
    body: `<div class="after in">
<p class="a1">这个链接过期了。</p>
<p class="a2">回到主屏幕重新打开就好。</p>
</div>`,
  })
}

function breatheBody(v: BreatheView): string {
  const cfg = {
    sid: v.sid,
    scheme: v.scheme,
    wait: v.waitSeconds,
    inhale: INHALE_MS,
    exhale: EXHALE_MS,
    leftMain: v.farewell,
    leftSub: FAREWELL_SUB,
    wentMain: v.wentMain ?? '正在打开' + v.label + '……',
    wentSub:
      v.wentSub ??
      (v.scheme
        ? '没有反应的话，回主屏幕手动打开就好。'
        : '这个 App 还没配 URL scheme，手动打开就好。'),
  }
  const label = escapeHtml(v.label)

  return `<main class="stage">
<p class="prelude">你正要打开<b>${label}</b></p>

<div class="orbwrap">
  <div class="orb" role="img" aria-label="呼吸引导">
    <div class="ink" aria-hidden="true"><i class="l1"></i><i class="l2"></i><i class="l3"></i></div>
    <div class="dot" aria-hidden="true"></div>
    <svg class="ring" viewBox="0 0 240 240" aria-hidden="true" focusable="false">
      <circle class="tr" cx="120" cy="120" r="112"></circle>
      <circle class="pg" id="ring" cx="120" cy="120" r="112"></circle>
    </svg>
  </div>
  <p class="phase" id="phase" aria-hidden="true">吸气</p>
</div>

<div class="actions">
  <button type="button" class="stop" id="stop" hidden>算了</button>
  <button type="button" class="go" id="go" hidden>继续打开</button>
</div>
</main>

<div class="after" id="after">
<p class="a1" id="afterMain"></p>
<p class="a2" id="afterSub"></p>
</div>

<noscript><p class="ns">这一页需要 JavaScript。回到主屏幕重新打开就好。</p></noscript>
${jsonScript('cfg', cfg)}
${v.extraBody ?? ''}`
}

/* ---------------------------------------------------------------- helpers */

function clampWait(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_WAIT_SECONDS
  return Math.max(0, Math.min(MAX_WAIT_SECONDS, Math.round(n)))
}

/**
 * Schemes come from the user's own /settings rows, but they end up in
 * `location.href`, so anything script-bearing is dropped rather than trusted.
 * This is the last of the three checks and the only one a scheme written
 * straight into D1 still has to pass. Re-exported so tests and callers keep
 * reaching for it here, at the sink.
 */
export { safeScheme }

/** Deterministic per sid, so a reload does not reshuffle the parting line. */
function pickFarewell(sid: string): string {
  let h = 0
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0
  return FAREWELL_LINES[h % FAREWELL_LINES.length] as string
}

/* -------------------------------------------------------------------- css */

const BREATHE_CSS = `
:root{--level:.5}

.stage{
  min-height:100vh;min-height:100svh;
  display:flex;flex-direction:column;align-items:center;justify-content:space-between;
  padding:calc(env(safe-area-inset-top) + 9vh) 24px calc(env(safe-area-inset-bottom) + 5vh);
  text-align:center;
}

.prelude{margin:0;font-size:.9rem;color:var(--faint);letter-spacing:.16em;text-indent:.16em}
.prelude b{font-weight:inherit;color:var(--dim)}

.orbwrap{display:flex;flex-direction:column;align-items:center}
.orb{position:relative;width:min(64vw,268px);height:min(64vw,268px);display:grid;place-items:center}

.ring{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.ring circle{fill:none;stroke-width:1.3;stroke-linecap:round}
.ring .tr{stroke:var(--ring-track)}
.ring .pg{stroke:var(--ring-prog)}

/* v1 「墨」 — three offset washes drifting on slow coprime cycles inside one
   mass that scales with the breath, so the silhouette never quite repeats. */
.ink{
  position:absolute;width:100%;height:100%;
  transform:scale(calc(.60 + .40*var(--level)));
  opacity:calc(.50 + .50*var(--level));
  will-change:transform,opacity;
}
.ink i{position:absolute;display:block;border-radius:50%;filter:blur(var(--ink-blur))}
.ink .l1{left:6%;top:8%;width:86%;height:84%;
  background:radial-gradient(circle at 47% 45%,var(--ink-a) 0%,var(--ink-b) 44%,transparent 68%);
  animation:d1 41s ease-in-out infinite}
.ink .l2{left:14%;top:3%;width:72%;height:78%;opacity:.74;
  background:radial-gradient(circle at 58% 60%,var(--ink-a) 0%,var(--ink-b) 38%,transparent 63%);
  animation:d2 59s ease-in-out infinite}
.ink .l3{left:1%;top:17%;width:80%;height:73%;opacity:.9;
  background:radial-gradient(circle at 40% 56%,var(--ink-b) 0%,transparent 64%);
  animation:d3 73s ease-in-out infinite}
@keyframes d1{0%{transform:translate(0,0) rotate(0deg) scale(1)}50%{transform:translate(2.5%,-3%) rotate(180deg) scale(1.09)}100%{transform:translate(0,0) rotate(360deg) scale(1)}}
@keyframes d2{0%{transform:translate(0,0) rotate(0deg) scale(1.04)}50%{transform:translate(-3%,3%) rotate(-180deg) scale(.94)}100%{transform:translate(0,0) rotate(-360deg) scale(1.04)}}
@keyframes d3{0%{transform:translate(0,0) rotate(0deg) scale(.96)}50%{transform:translate(3%,3.5%) rotate(150deg) scale(1.07)}100%{transform:translate(0,0) rotate(300deg) scale(.96)}}

/* v2 「息」 — one dot. Nothing else. */
.dot{
  position:absolute;width:22%;height:22%;border-radius:50%;background:var(--dot);
  transform:scale(calc(.44 + .56*var(--level)));
  opacity:calc(.60 + .40*var(--level));
  will-change:transform,opacity;
}
body.t-breath .ink{display:none}
body.t-ink .dot{display:none}

.phase{margin:2.6rem 0 0;font-size:.95rem;color:var(--dim);letter-spacing:.5em;text-indent:.5em}

/* Height is reserved from the first paint so nothing jumps when the buttons
   arrive; during the wait the area is merely invisible, not absent. */
.actions{min-height:154px;width:100%;display:flex;flex-direction:column;align-items:center}
body[data-state="wait"] .actions{visibility:hidden}

.stop,.go{opacity:0;transform:translateY(12px);transition:opacity 1.1s ease,transform 1.1s ease}
.stop.in,.go.in{opacity:1;transform:none}
.stop{
  padding:1.05rem 3.6rem;border-radius:999px;
  background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  font-size:1.06rem;letter-spacing:.34em;text-indent:.34em;
}
.stop:active{opacity:.82}
.go{
  margin-top:1.6rem;padding:.7rem 1.2rem;color:var(--go-fg);
  font-size:.88rem;letter-spacing:.22em;text-indent:.22em;
  text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:1px;
  text-decoration-color:var(--rule);
}

.after{
  display:none;opacity:0;transition:opacity .9s ease;
  min-height:100vh;min-height:100svh;
  flex-direction:column;align-items:center;justify-content:center;gap:.7rem;
  padding:0 32px;text-align:center;
}
.after.in{opacity:1}
body[data-state="left"] .stage,body[data-state="went"] .stage{display:none}
body[data-state="left"] .after,body[data-state="went"] .after,body[data-state="gone"] .after{display:flex}
.a1{margin:0;font-size:1.16rem;line-height:2;color:var(--fg);letter-spacing:.12em;text-indent:.12em}
.a2{margin:0;font-size:.85rem;color:var(--faint);letter-spacing:.1em;text-indent:.1em}

.ns{position:fixed;left:0;right:0;bottom:14vh;margin:0;padding:0 32px;text-align:center;color:var(--dim);font-size:.9rem}

@media (prefers-reduced-motion:reduce){
  .ink i{animation:none}
  .stop,.go,.after{transition-duration:.01ms}
}
`

/* --------------------------------------------------------------------- js */

/**
 * PROCEED_NOTE — the one thing here that must never be refactored.
 *
 * Safari only opens a custom URL scheme from inside the synchronous call stack
 * of a genuine user gesture. sendBeacon hands the request to the browser and
 * returns immediately, so `location.href = SCHEME` on the very next line is
 * still inside that stack. Replace it with `await fetch(...)` and the jump is
 * silently swallowed — the user taps 继续 and simply sits on a dead page.
 *
 * One rAF loop drives everything (ring, ink/dot scale, phase word) off a single
 * elapsed-time value, so the visual and the word 吸气／呼气 cannot drift apart
 * the way a CSS animation plus a JS timer eventually would.
 */
const BREATHE_JS = `(function(){
var cfg=JSON.parse(document.getElementById('cfg').textContent);
var SID=cfg.sid,SCHEME=cfg.scheme,WAIT=cfg.wait*1000;
var IN=cfg.inhale,OUT=cfg.exhale,CYCLE=IN+OUT;

var root=document.documentElement,doc=document.body;
var ring=document.getElementById('ring'),phase=document.getElementById('phase');
var stop=document.getElementById('stop'),go=document.getElementById('go');
var after=document.getElementById('after');
var aMain=document.getElementById('afterMain'),aSub=document.getElementById('afterSub');

var C=2*Math.PI*112;
ring.style.strokeDasharray=C+' '+C;
ring.style.strokeDashoffset=String(C);

var calm=false;
try{calm=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(e){}

var t0=0,last='',revealed=false,settled=false;

function frame(now){
  if(!t0)t0=now;
  var el=now-t0;

  var t=el%CYCLE,inhaling=t<IN;
  var p=inhaling?t/IN:(t-IN)/OUT;
  var e=.5-.5*Math.cos(Math.PI*Math.min(1,p));
  var level=inhaling?e:1-e;
  root.style.setProperty('--level',calm?'0.55':level.toFixed(4));

  var word=inhaling?'吸气':'呼气';
  if(word!==last){last=word;phase.textContent=word}

  var prog=WAIT>0?Math.min(1,el/WAIT):1;
  ring.style.strokeDashoffset=String(C*(1-prog));

  if(!revealed&&prog>=1){revealed=true;reveal()}
  if(!settled)requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function show(el){el.hidden=false;requestAnimationFrame(function(){el.classList.add('in')})}

// 算了 lands alone first. 继续打开 only turns up 800ms later, small and
// underlined. Walking away should be what the thumb reaches for by default.
function reveal(){
  doc.setAttribute('data-state','choose');
  show(stop);
  setTimeout(function(){show(go)},800);
}

function report(action){
  if(!SID)return;
  var payload=new URLSearchParams({sid:SID,action:action});
  try{if(navigator.sendBeacon&&navigator.sendBeacon('/resolve',payload))return}catch(e){}
  try{fetch('/resolve',{method:'POST',body:payload,keepalive:true}).catch(function(){})}catch(e){}
}

function finish(state,main,sub){
  settled=true;
  doc.setAttribute('data-state',state);
  aMain.textContent=main;aSub.textContent=sub;
  requestAnimationFrame(function(){after.classList.add('in')});
}

go.addEventListener('click',function(){
  if(settled)return;
  settled=true;
  report('proceed');
  if(SCHEME)location.href=SCHEME; // synchronous, same gesture stack. Never await above this line.
  finish('went',cfg.wentMain,cfg.wentSub);
});

stop.addEventListener('click',function(){
  if(settled)return;
  report('abandon');
  finish('left',cfg.leftMain,cfg.leftSub);
});
})();`
