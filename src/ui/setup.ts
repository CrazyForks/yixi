import type { Env, User } from '../types'
import { DEFAULT_THEME, escapeHtml, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { listUserApps } from '../db'
import { revealToken } from '../account'

/**
 * GET /setup — how to actually wire this up, on the phone that has to do it.
 *
 * The repo carries a longer manual, but a friend handed a token has no repo.
 * Worse, a manual has to write `<你的地址>` and `<你的token>` and trust the
 * reader to substitute correctly — and the single most common way this setup
 * fails is a mistyped URL or a token pasted with a stray space. This page knows
 * both values, so it prints the finished string to copy rather than a template
 * to fill in.
 *
 * Accounts changed what "knows" means here. This page used to be able to print
 * the token only for a reader who still had `?k=` in the address bar, because a
 * cookie session had nothing but the hash to work from — which meant the normal
 * way to reach this page was also the way that could not finish the job. Now the
 * token is kept sealed under TOKEN_KEY as well, so any signed-in holder gets the
 * finished string. The old degraded path survives for the one case that is still
 * genuinely unreadable: a row from the ticket-window era that was never claimed,
 * or one sealed under a key that has since been rotated.
 */
export async function renderSetup(request: Request, env: Env, user: User): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin
  // `?k=` still wins: it is the token the reader is holding right now, and it
  // needs no decrypt. Falling back rather than always unsealing also keeps a
  // freshly-issued token working before it has been sealed.
  // Gated the same way /account gates it. This page is one nav tap from every
  // other console page, and the string it prints is the key to that person's
  // whole record — a page that shows it to anyone who picks up an unlocked
  // phone is a worse default than one extra tap. A token still in the address
  // bar is already on screen, so there is nothing left to withhold there.
  const fromQuery = url.searchParams.get('k')
  const reveal = fromQuery !== null || url.searchParams.get('show') === '1'
  const token = reveal ? (fromQuery ?? (await revealToken(env, user))) : null
  const apps = await listUserApps(env.DB, user.id)

  // The literal line to paste, with this person's own token already in it. A
  // manual can only print a template and hope the reader substitutes correctly,
  // and mis-substitution is the most common way this setup fails.
  const firstApp = apps.find((a) => a.enabled) ?? apps[0]
  const exampleApp = firstApp?.app ?? 'xhs'

  const rawLineFor = (appKey: string): string =>
    `${origin}/gate?app=${appKey}&k=${token ?? ''}&fmt=text`

  const lineFor = (appKey: string): string =>
    `${origin}/gate?app=${appKey}&amp;k=${token ?? '&lt;先点上面的「显示」&gt;'}&amp;fmt=text`

  // The first app's line, shown inline in step one so the reader can paste
  // without scrolling. Everything else lives in the table below.
  const firstPasteLine = firstApp
    ? `<pre class="copy">${lineFor(escapeHtml(firstApp.app))}</pre>`
    : `<pre class="copy">${escapeHtml(origin)}/gate?app=&lt;先去设置加一个 App&gt;&amp;k=${
        token ? escapeHtml(token) : '&lt;先点上面的「显示」&gt;'
      }&amp;fmt=text</pre>`

  // One finished line per configured app. Step two is then literally "paste
  // this", which is the only part that repeats per app and the only part iOS
  // will not let anyone automate away.
  const pasteRows = apps.length
    ? apps
        .map(
          (a) => `<tr>
  <td>${escapeHtml(a.label)}${a.enabled ? '' : '<span class="off"> · 已停用</span>'}</td>
  <td>
    <pre class="copy tight">${lineFor(escapeHtml(a.app))}</pre>
    ${
      token
        ? `<a class="linky try" href="${escapeHtml(rawLineFor(a.app))}">在 Safari 里试一下这条</a>`
        : ''
    }
  </td>
</tr>`,
        )
        .join('\n')
    : `<tr><td colspan="2" class="none">还没有配置 App。先去<a href="/settings">设置</a>加一个，这里就会出现可以直接粘的整行。</td></tr>`

  const tokenLine = token
    ? `<pre class="copy">${escapeHtml(token)}</pre>`
    : reveal
      ? `<p class="warn">服务器这边读不到你的 token 原文，只存着它的哈希——这个账号是发号时代建的，
         从来没绑过邮箱和密码。<a href="/claim">绑一次</a>，以后这一页就能直接印出来；
         或者现在带上 <code>?k=你的token</code> 重新打开这一页。</p>`
      : `<p class="masked">············ <a class="linky" href="/setup?show=1">显示</a>
         <span class="hint">它是你所有记录的钥匙，别在别人能看见屏幕的时候点。</span></p>`

  return page({
    title: '一息 · 怎么配',
    theme: DEFAULT_THEME,
    css: CONSOLE_CSS + SETUP_CSS,
    cacheControl: 'no-store',
    body: `${consoleHeader(user, 'setup')}
<main class="wrap doc">

<h1>怎么配</h1>
<p class="lede">全部在 iPhone 自带的「快捷指令」App 里完成，不用越狱，不用装别的东西。
第一次约 5 分钟，之后每多拦一个 App 再花 1 分钟。</p>

<div class="box">
<h3>先记住一件事</h3>
<p>整套配置里 <strong>token 只出现一次</strong>，就在下面第一步那个共用快捷指令里。
后面每个 App 的自动化都只是调用它，不重复填。将来换 token 只改那一处。</p>
</div>

<h2>你的 token</h2>
<p>下面第一步那串网址里已经带上它了，正常配置不用单独复制。放在这里是为了你换设备、
或者想核对时能拿到：</p>
${tokenLine}

<h2>第一步 · 给一个 App 建快捷指令</h2>

<div class="box">
<h3>一个变量都不用挑</h3>
<p>网址直接整条粘进去，不要去找「快捷指令输入」那个变量——它只有在快捷指令被设成
「接收输入」时才会出现，新建的默认没有。整条链路只有三个动作，全部照抄即可。</p>
</div>

<h3>① 「获取 URL 的内容」</h3>
<p>动作搜索框里搜 <code>URL</code>，选「获取 URL 的内容」。
把下面这一整条<b>粘进 URL 那一栏</b>（已经是你的真实地址和 token）：</p>
${firstPasteLine}
<p>展开「显示更多」，确认方法是 <code>GET</code>。请求头和请求体留空。</p>

<h3>② 「如果」</h3>
<pre class="shape">如果   「URL 的内容」   包含   https</pre>
<p>中间选<b>「包含」</b>，右边手打 <code>https</code> 五个字母。
左边那栏会自动接上一步的结果，不用动。</p>

<h3>③ 「打开 URL」，拖到「如果」里面</h3>
<p>URL 那一栏同样自动接「URL 的内容」，不用动。</p>

<h3>建完是这三行</h3>
<pre class="shape">获取 URL 的内容    （粘好的整条网址）        GET
如果   「URL 的内容」   包含   https
    打开 URL   「URL 的内容」
结束如果</pre>

<p>起个名字，比如 <b>一息 小红书</b>，存好。</p>

<h2>第二步 · 让它在打开 App 时自动跑</h2>

<p>「快捷指令」App → 底部 <b>自动化</b> → 右上角 <b>+</b>：</p>

<ol>
<li>触发条件选 <b>App</b>，点进去勾选<b>要拦的那一个</b></li>
<li>选 <b>已打开</b>（不是「已关闭」），下一步</li>
<li>让你选运行什么时，直接选刚建的 <b>「一息 小红书」</b>——不用加动作、不用传输入</li>
<li><b>关掉「运行前询问」</b>，弹出确认时选「不询问」</li>
<li>把「运行时通知我」也关掉，不然每次开 App 都弹横幅</li>
</ol>

<h3>再加一个 App</h3>
<p>不用重头来。快捷指令列表里<b>长按「一息 小红书」→ 拷贝</b>，
在副本里把网址中的 <code>app=</code> 后面那个词换成新 App 的键，改个名字，
再照第二步建一条自动化。<b>只有那一个词要改。</b></p>

<h3>各个 App 对应的整条网址</h3>
<table class="apps paste">
<tbody>
${pasteRows}
</tbody>
</table>
<p class="warn">整条复制，末尾的 <code>&amp;fmt=text</code> 少了就不工作。
<b>粘完先点「在 Safari 里试一下这条」</b>——看到 <code>pass</code> 或一条
<code>https://…</code> 网址就说明地址没问题；Safari 要是打不开，那就是地址本身缺了一截
或混进了奇怪字符，这时候放进快捷指令里只会得到一句 <code>kCFErrorDomainCFNetwork</code>，
看不出原因。</p>

<div class="box">
<h3>每个 App 都要来一遍，这是 iOS 的限制</h3>
<p>「打开 App 时」的自动化<b>必须一个 App 建一条</b>，不能批量、不能一条选多个。
拦 5 个 App 就是 5 条。One Sec 和所有同类工具都这样，iOS 没给别的口子。</p>
</div>

<div class="box">
<h3>为什么条件是「包含 https」这么怪的写法</h3>
<p>服务器只回两种东西：该拦你时回一条 <code>https://…</code> 开头的网址，不该拦时回 <code>pass</code> 这个词。</p>
<p>所以这一条同时干了两件事：该拦时打开呼吸页；而<b>只要出任何问题</b>——服务挂了、
token 错了、网络断了、返回空白——结果里都没有 <code>https</code>，
「如果」不成立，快捷指令什么都不做，<b>你的 App 正常打开</b>。</p>
<p>所以<b>绝对不能反过来写成「不包含 pass」</b>。那样服务一挂，
每次开 App 都跳去一个打不开的网页，你会被自己写的工具锁在手机外面。</p>
</div>


<h2>第三步 · 跑通一次</h2>
<ol>
<li>从桌面点开你刚配的那个 App</li>
<li>应该闪一下跳到 Safari，出现呼吸页</li>
<li>等倒计时走完</li>
<li>点「算了」→ 给你一句话，你自己退出去</li>
<li>点「继续」→ 应该跳回那个 App</li>
</ol>
<p>第 5 步跳不回去，说明这个 App 的 scheme 不对，去 <a href="/probe">实测</a> 挨个试。</p>
<p>跳回去的一瞬间自动化<b>会被再次触发，这是正常的</b>。服务端有一分半的免打扰窗口，
这次直接放行，也不会被算成一次冲动。放下手机超过一分半再拿起来才会重新拦你——这是刻意的。</p>

<h2>验一下配对没</h2>
<p>别在快捷指令编辑页里直接点运行——那样没有输入，<code>app=</code> 是空的，会报一个和你配置无关的错。</p>
<p>要验地址和 token，在 Safari 里打开这个（<code>zzztest</code> 是个故意没配过的键，服务端一律放行且什么都不记）：</p>
<pre class="copy">${token ? `${origin}/gate?app=zzztest&amp;k=${escapeHtml(token)}` : `${origin}/gate?app=zzztest&amp;k=&lt;你的token&gt;`}</pre>
<table class="apps">
<tbody>
<tr><td><code>{"action":"pass"}</code></td><td>都对，往下走</td></tr>
<tr><td><code>{"error":"unauthorized"}</code></td><td>token 不对，多半复制时带了空格</td></tr>
<tr><td><code>{"error":"missing app"}</code></td><td>网址里 <code>app=</code> 后面空了</td></tr>
<tr><td>连不上 / 404</td><td>地址写错，或 Worker 没部署成功</td></tr>
</tbody>
</table>

<h2>坏掉的时候必须放你进去</h2>

<p>第二步②的条件写的是「<b>包含 <code>https</code></b>」。这不是随手写的，
<b>永远不要改成「不包含 <code>pass</code>」</b>。</p>

<p>差别在服务出问题的时候。<code>/gate</code> 有一堆理由给不出正常答复：token 被换了、Worker 挂了、
网络超时、DNS 被污染、返回了一片空白。</p>

<ul>
<li><b>写「包含 https 才打开」</b>：上面每种异常的返回里都没有 <code>https</code>，「如果」不成立，
快捷指令什么都不做直接结束，<b>你的 App 正常打开</b>。最坏结果是「今天没拦住你」。</li>
<li><b>写「不包含 pass 就打开」</b>：服务一挂，每次开 App 都跳去一个打不开的网页。
你被自己写的工具<b>锁在自己手机外面</b>，而且当时多半正急着用。</li>
</ul>

<p>这两种坏法完全不对等：一边少拦一次，一边几个 App 全废。所以默认行为必须是拿不准就放行。</p>

<p>同理还有两条：<b>别给「获取 URL 的内容」加出错处理</b>（网络失败时整条快捷指令中止，
后面的「打开 URL」就不会执行，App 照常打开，这正是要的）；
<b>别在「如果」后面加「否则」去打开任何东西</b>（「否则」就是「服务没说要拦」，那就该什么都不做）。</p>

<h2>出问题了</h2>

<h3>App 打不开了 / 每次开 App 都跳到打不开的网页</h3>
<p><b>先止血</b>：「快捷指令」→「自动化」，把那条的开关关掉，App 立刻恢复。
一息挂了不该影响你用手机。然后回上一节检查「如果」的条件是不是写反了。</p>

<h3>点「继续」跳不回 App</h3>
<p>大概率 scheme 不对。去 <a href="/probe">实测</a>，找到这个 App 的按钮点一下：跳走了说明
scheme 对，问题在别处；没反应就在那页顶部的输入框里换候选试，试通了回 <a href="/settings">设置</a> 改。
有些 App 已经彻底没有 scheme，怎么点都不动——那就只能对它放弃拦截。</p>

<h3>打开 App，自动化压根没触发</h3>
<ol>
<li>「运行前询问」没关干净，回自动化详情页再确认一次</li>
<li>触发条件选错了，必须是「已打开」</li>
<li>从后台切回前台在部分 iOS 版本上不触发，先把 App 从后台划掉再从桌面点</li>
<li>自动化被关了，列表里每条右侧有开关</li>
<li>重启 iPhone。「打开 App 时」偶发失灵是 iOS 的老毛病</li>
</ol>

<h3>每次都直接进 App，从来没被拦过</h3>
<p>自动化跑了，但服务端判定「不管这个 App」：app 键对不上（大小写敏感，<code>XHS</code> ≠ <code>xhs</code>）、
在<a href="/settings">设置</a>里被停用了、或者你一直在一分半的免打扰窗口里。</p>

<h3>刚点「继续」跳回去，马上又被拦</h3>
<p>免打扰窗口没生效。要么 <code>/resolve</code> 没打成功（网络断了），
要么这个 App 的 grace 秒数设得太短，去<a href="/settings">设置</a>调大。</p>

<h3>开 App 明显变慢</h3>
<p>每次开 App 都要等一次到 Cloudflare 的网络往返，信号差时会有感知。没有客户端缓存。
慢到不可接受的话，这是要改方案的信号，不是配置问题。</p>

</main>`,
  })
}

const SETUP_CSS = `
.doc{max-width:38rem}
.doc h1{margin:0 0 .6rem;font-size:1.5rem;font-weight:400;letter-spacing:.2em}
.doc .lede{margin:0 0 2rem;color:var(--dim);font-size:.92rem;line-height:1.8}
.doc h2{
  margin:2.8rem 0 1rem;font-size:.76rem;font-weight:400;color:var(--faint);
  letter-spacing:.3em;text-indent:.3em;
}
.doc h2::before{content:"";display:block;width:22px;height:1px;background:var(--rule);margin-bottom:1.2rem}
.doc h3{margin:1.6rem 0 .5rem;font-size:.95rem;font-weight:400;color:var(--fg)}
.doc p{margin:0 0 .9rem;line-height:1.85;opacity:.9}
.doc ol,.doc ul{margin:0 0 1rem;padding-left:1.3rem;line-height:1.9;opacity:.9}
.doc li{margin-bottom:.35rem}
.doc li::marker{color:var(--faint)}
.doc code{
  font-family:var(--num);font-size:.86em;
  background:var(--rule);border-radius:4px;padding:.1em .38em;
}
pre.copy,pre.shape{
  font-family:var(--num);font-size:.8rem;line-height:1.7;
  background:var(--rule);border-radius:10px;
  padding:12px 14px;margin:0 0 1rem;
  overflow-x:auto;white-space:pre;-webkit-user-select:all;user-select:all;
}
pre.copy{-webkit-user-select:all;user-select:all}
.box{
  border:1px solid var(--rule);border-radius:12px;
  padding:14px 16px 4px;margin:0 0 1.4rem;
}
.box h3{margin:0 0 .5rem;font-size:.88rem;color:var(--dim)}
p.warn{
  border-left:2px solid var(--faint);padding-left:12px;
  color:var(--dim);font-size:.89rem;
}
table.apps{width:100%;border-collapse:collapse;margin:0 0 1.2rem;font-size:.88rem}
table.apps th{
  text-align:left;font-weight:400;color:var(--faint);font-size:.76rem;
  letter-spacing:.16em;padding:0 8px 6px 0;border-bottom:1px solid var(--rule);
}
table.apps td{padding:8px 8px 8px 0;border-bottom:1px solid var(--rule);vertical-align:top}
table.apps .off{color:var(--faint)}
table.apps .none{color:var(--dim);text-align:center;padding:18px 0}
.doc a{color:var(--fg);text-underline-offset:3px}
pre.copy.tight{margin:0;padding:8px 10px;font-size:.72rem}
table.paste td{vertical-align:middle}
a.try{display:inline-block;margin-top:6px;font-size:.78rem;color:var(--dim)}
table.paste td:first-child{white-space:nowrap;padding-right:12px}
p.masked{
  font-family:var(--num);letter-spacing:.18em;color:var(--faint);
  background:var(--rule);border-radius:10px;padding:12px 14px;margin:0 0 1rem;
}
p.masked .linky{margin-left:.6rem;font-family:var(--font);letter-spacing:0}
p.masked .hint{
  display:block;margin-top:.5rem;font-family:var(--font);
  font-size:.8rem;letter-spacing:0;color:var(--dim);
}
`
