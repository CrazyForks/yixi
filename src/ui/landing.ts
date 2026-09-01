import { DEFAULT_THEME, page } from './layout'

/**
 * GET / — what a stranger sees, and now the front door as well: /register and
 * /login are the two links that used to be "ask the person who gave you a
 * token". Wearing the same skin as the breathing page means flipping
 * DEFAULT_THEME re-dresses the whole product at once.
 *
 * The 隐私 section is the part to keep honest rather than flattering. Sealing a
 * copy of the token so people can get it back is strictly weaker than storing
 * only a hash, and this page says so in the same breath as the guarantee that
 * still holds — otherwise the first paragraph is doing marketing.
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
<p>注册只要一个邮箱和一个密码。邮箱不发信、不验证，只是你下次登录的用户名。</p>
<p>真正的身份是一把 token，快捷指令拿它认人。它加密存在服务器上，
所以你登录之后还能看回来——代价是数据库和密钥同时泄露时它会跟着泄。
这是为了「忘了也找得回来」换的，值不值得你自己判断。</p>
<p>记录只有你自己看得到。发号的人只看得到聚合次数，看不到任何一条明细——
不然这东西没人会真的用。</p>
<p>上面这几句都可以自己核对：<a href="https://github.com/Defiabell/yixi" rel="noreferrer">代码是开源的</a>。
不想把这类数据放在别人的服务器上，照 README 部署一份自己的，
跑在 Cloudflare 免费额度里，不花钱。</p>

<h2>长什么样</h2>
<p class="looks">两版视觉，还没定：
<a href="/mock?v=1">墨</a><a href="/mock?v=2">息</a></p>

<h2>开始用</h2>
<p class="looks go"><a href="/register">注册</a><a href="/login">登录</a></p>

<p class="foot">已经有别人发给你的 token 了？<a href="/claim">给它绑上邮箱和密码</a>，别重新注册——
重新注册会拿到一把新的，旧记录就找不回来了。<br>
配到 iPhone 上的一步一步说明在<a href="/setup">怎么配</a>，登录之后打开就行。<br>
源码 · <a href="https://github.com/Defiabell/yixi" rel="noreferrer">github.com/Defiabell/yixi</a></p>
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
  margin:3rem 0 .9rem;font-size:.84rem;font-weight:400;color:var(--faint);
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
/* The one thing on this page anybody is meant to press, so it is the one thing
   wearing the breathing page's own button. */
.looks.go a{margin:0 .8rem 0 0;padding:.5rem 1.6rem;font-size:.95rem;min-height:44px;color:var(--fg)}
.looks.go a:first-child{background:var(--stop-bg);color:var(--stop-fg);border-color:var(--stop-border)}
.foot{margin-top:4rem;color:var(--faint);font-size:.87rem;line-height:1.9}
.foot a{color:var(--dim);text-underline-offset:3px}
`
