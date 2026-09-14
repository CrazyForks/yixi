// /today/setup — the 今日 face's own "怎么配": getting /today onto the home
// screen without typing a URL every morning.
//
// This section used to live inside /setup, wedged between the interception
// walkthrough and its troubleshooting table — fine while /today was one more
// link off that same console, wrong once it grew a nav of its own. Someone
// who only cares about goal-tending should never have to skim past Shortcuts
// automations for xhs or 起点读书 to find this.

import type { Env, User } from '../types'
import { COPY_LINE_CSS, DEFAULT_THEME, copyLine, copyLinesScript, page } from './layout'
import { CONSOLE_CSS, consoleHeader } from './console'
import { localeOf, translator } from '../i18n'

/**
 * GET /today/setup — the three ways to open /today without hunting for the
 * address bar: add to the home screen, a Shortcut, and a timed automation
 * that opens it on its own.
 *
 * Content is the section /setup used to carry verbatim; only the heading and
 * the closing line changed, since this page no longer has to share space
 * with anything about interception.
 */
export async function renderTodaySetup(request: Request, _env: Env, user: User): Promise<Response> {
  // Raw, not escaped: `copyLine` escapes what it is given, and the address is
  // the one thing on this page that has to survive verbatim into a clipboard.
  const todayUrl = `${new URL(request.url).origin}/today`
  const loc = localeOf(request, user)
  const t = translator(loc)

  // Each <li> is one source string, newline and indent included, so the
  // Chinese renders byte for byte what it always did; English collapses the
  // same break to a space.
  //
  // None of them prints the address any more. It used to appear twice, inside
  // <code>, where it was neither tappable nor selectable in one gesture — so
  // the reader was being asked to retype a URL off a screen to get it onto the
  // same screen's home. It is one line now, at the top, with a button.
  const body = `${consoleHeader(user, 'todaysetup', t)}
<main>
<h1>${t('怎么配')}</h1>
<p class="lede">${t('让今日页一按就开。<a href="/today">今日</a>是每天要开的那一页，别去找网址，给它一个入口：')}</p>
${copyLine(t, { label: t('今日页的网址'), name: t('今日页的网址'), text: todayUrl, href: todayUrl })}
<ol>
  <li>${t('<b>添加到主屏幕</b>。Safari 打开上面这条网址，底部「分享」→「添加到主屏幕」。\n    之后点图标就是全屏、没有地址栏。装好后第一次打开要<b>再登录一次</b>——主屏幕里的它和 Safari 不共享登录，登一次管半年。')}</li>
  <li>${t('<b>快捷指令入口</b>。「快捷指令」App 新建一条，只放一个动作「打开 URL」，网址填上面这条网址。\n    然后三选一：主屏幕长按→小组件→「快捷指令」，把它放上去；iPhone 15 Pro 以上在「设置→操作按钮」里绑它；\n    或「设置→辅助功能→触控→轻点背面」绑它。')}</li>
  <li>${t('<b>每天早上自动打开</b>。「快捷指令」→「自动化」→「特定时间」，选每天早上的时刻，运行上面那条，\n    关掉「运行前询问」。这就是提醒，不用推送。')}</li>
</ol>
<p class="note">${t('拦截那边的配置在<a href="/setup">这里</a>。')}</p>
</main>`

  return page({
    title: t('怎么配 · 一息'),
    theme: DEFAULT_THEME,
    lang: loc,
    css: CONSOLE_CSS + COPY_LINE_CSS,
    body,
    script: copyLinesScript(t),
  })
}
