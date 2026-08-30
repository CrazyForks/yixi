import { DEFAULT_THEME, page } from './layout'

/**
 * GET / — the only page a stranger can reach. It explains what 一息 is and
 * stops there: there is no sign-up, because a token IS the identity and tokens
 * are handed out by hand. Wearing the same skin as the breathing page means
 * flipping DEFAULT_THEME re-dresses the whole product at once.
 */
export function renderLanding(): Response {
  return page({
    title: '一息',
    theme: DEFAULT_THEME,
    css: LANDING_CSS,
    // Static text, no session, safe to sit in a CDN edge for a minute.
    cacheControl: 'public, max-age=60',
    body: `<main class="doc">
<h1>一息</h1>
<p class="lede">在你打开一个 App 之前，先呼吸十秒。</p>

<p>十秒之后，页面先递给你「算了」，过一会儿才递给你「继续」。
顺序是故意的——大多数时候你会发现，那一下其实只是手指的惯性。</p>

<h2>怎么工作</h2>
<ol>
<li>iPhone 的「快捷指令」在你打开某个 App 时，先来这里问一句该不该拦。</li>
<li>该拦就跳到呼吸页，倒计时期间没有任何按钮可以点。</li>
<li>选「继续」会放行一分半，免得刚跳回去又被自己拦住。</li>
</ol>

<h2>它记什么</h2>
<p>只记时间、哪个 App、以及你那次是继续了还是放下了。
过一阵你能看到自己一周被拦了多少次，其中多少次没进去。</p>

<h2>关于隐私</h2>
<p>一个 token 就是一个人。没有注册、没有邮箱、没有密码。
token 只以哈希存放，生成时只显示一次。
发号的人只看得到聚合次数，看不到任何一条明细——
不然这东西没人会真的用。</p>

<h2>长什么样</h2>
<p class="looks">两版视觉，还没定：
<a href="/mock?v=1">墨</a><a href="/mock?v=2">息</a></p>

<p class="foot">这不是一个公开产品。想用的话，找发你 token 的人。</p>
</main>`,
  })
}

const LANDING_CSS = `
.doc{
  max-width:34rem;margin:0 auto;
  padding:calc(env(safe-area-inset-top) + 12vh) 28px calc(env(safe-area-inset-bottom) + 16vh);
}
h1{
  margin:0 0 .4rem;font-size:1.9rem;font-weight:400;
  letter-spacing:.42em;text-indent:.42em;
}
.lede{margin:0 0 3.2rem;color:var(--dim);font-size:.98rem;letter-spacing:.06em}
h2{
  margin:3rem 0 .9rem;font-size:.78rem;font-weight:400;color:var(--faint);
  letter-spacing:.3em;text-indent:.3em;
}
h2::before{
  content:"";display:block;width:22px;height:1px;
  background:var(--rule);margin-bottom:1.4rem;
}
p{margin:0 0 1.1rem;color:var(--fg);opacity:.88;letter-spacing:.02em}
ol{margin:0;padding-left:1.3rem;color:var(--fg);opacity:.88}
li{margin-bottom:.55rem;padding-left:.2rem;letter-spacing:.02em}
li::marker{color:var(--faint)}
.looks a{
  display:inline-block;margin-left:.9rem;padding:.2rem .95rem;
  border:1px solid var(--rule);border-radius:999px;
  text-decoration:none;font-size:.85rem;color:var(--dim);
}
.foot{margin-top:4rem;color:var(--faint);font-size:.82rem}
`
