// Shared chrome for every signed-in page — /review, /settings, /setup,
// /account, /admin. They must read as one surface that people tab between, not
// five separate designs.
//
// /review used to render its own header, and that is exactly the failure this
// module now prevents: its private copy had drifted to three text-only tabs, so
// tabbing to 「回顾」 visibly changed the furniture AND stranded the reader —
// 「怎么配」, 「账号」 and 「发号」 had no link on that page at all. The nav is
// shared code now, and a test renders all six pages and diffs their navs.
//
// This lives in its own module rather than inside any one page: a page module
// that doubles as the shared library for its siblings is a dependency direction
// that only gets worse as pages are added.

import type { User } from '../types'
import { escapeHtml } from './layout'
import { ICON_CSS, icon, type IconName } from './icons'

// --- shared console chrome -------------------------------------------------

/**
 * Every page name is also an icon name, deliberately: a tab that cannot be
 * drawn is a compile error rather than a blank square on someone's phone.
 */
export type ConsolePage = Extract<
  IconName,
  'review' | 'settings' | 'setup' | 'account' | 'admin'
>

/**
 * Four tabs, five for the owner. It was seven.
 *
 * The three that left were all the same mistake: a step of one job given a
 * destination of its own. 「实测」 merged into 「候选」 (finding a string and
 * trying it are two halves of one task), and then 「候选」 itself merged into
 * the URL scheme field on /settings — nobody ever wanted to go look at a list
 * of candidates; they wanted to fill in that one box, and being sent away from
 * a half-typed form to do it lost the form.
 *
 * Every remaining tab keeps its word: 「回顾」 and 「怎么配」 have no icon
 * anyone would guess, and an icon-only nav would trade a scroll nobody can see
 * for a guess nobody can make. The current tab sits on a pale ink disc.
 */
export function consoleHeader(user: User, active: ConsolePage): string {
  const tab = (href: string, name: ConsolePage, text: string): string =>
    `<a href="${href}"${active === name ? ' class="on" aria-current="page"' : ''}>${icon(name)}<span class="lb">${text}</span></a>`
  return `<header>
  <span class="brand">一息</span>
  <span class="who">${escapeHtml(user.name)}</span>
  <nav aria-label="导航">
    ${tab('/review', 'review', '回顾')}
    ${tab('/settings', 'settings', '设置')}
    ${tab('/setup', 'setup', '怎么配')}
    ${tab('/account', 'account', '账号')}
    ${user.is_owner ? tab('/admin', 'admin', '发号') : ''}
  </nav>
</header>`
}

/**
 * Extends the theme tokens layout.ts already emitted (--bg/--fg/--dim/--faint/
 * --rule/--font), so these pages wear whichever face the owner picks at /mock.
 * /review appends its chart CSS to this rather than carrying a shell of its own.
 *
 * The type scale is deliberately not small. It was: 15px body, 12px notes, and
 * 9.5px nav labels, which is below what Apple will even render legibly on a
 * phone held at arm's length. Nothing here is smaller than 11px now, and the
 * body sits at 17px — iOS's own default.
 *
 * Two additions of their own:
 *   - `--num`, a UI font for figures and numeric inputs. The 「墨」 skin sets a
 *     serif for prose, and 宋体 digits are proportional — fine in a sentence,
 *     bad in a seconds field. Same split /review makes.
 *   - `font-size:16px` on every input, which is load-bearing rather than a
 *     style choice: mobile Safari zooms the viewport on focus for anything
 *     smaller, and never zooms back out.
 */
export const CONSOLE_CSS = `
:root{
  --num:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",system-ui,sans-serif;
  --danger:#a8543c;
}
@media (prefers-color-scheme:dark){:root{--danger:#c9795c}}
body{font-size:17px;line-height:1.75}
header,main{max-width:520px;margin:0 auto;padding:0 18px}
header{display:flex;align-items:center;gap:10px;padding-top:22px;padding-bottom:12px}
.brand{font-size:20px;font-weight:600;letter-spacing:.24em;text-indent:.24em}
.who{font-size:13px;color:var(--faint)}
/* Wrapping is the safety net, not the design: six items at this size fit one
   row inside a 375px phone, and a wrap only ever beats the horizontal scroll
   this used to need — that scrollbar is hidden, so nothing announced it. */
header nav{
  margin-left:auto;display:flex;align-items:flex-end;justify-content:flex-end;
  flex-wrap:wrap;gap:1px;min-width:0;
}
header nav a{flex:none;display:inline-flex;flex-direction:column;align-items:center;gap:3px;
  padding:5px 5px;border-radius:8px;color:var(--faint);text-decoration:none}
header nav a .lb{font-size:11px;line-height:1.3;letter-spacing:0;white-space:nowrap}
header nav a.on{color:var(--fg);background:var(--ring-track)}
main{padding-bottom:calc(40px + env(safe-area-inset-bottom))}
h1{font-size:20px;font-weight:600;margin:8px 0 6px}
h2{margin:0 0 10px;font-size:14px;font-weight:400;color:var(--dim);letter-spacing:.12em}
p{margin:0 0 10px}
.num{font-family:var(--num);font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px}
.lede{font-size:15px;line-height:1.75;color:var(--dim);margin-bottom:18px}
.note{font-size:13px;line-height:1.8;color:var(--faint);margin:10px 0 0}
.note a,.lede a{color:var(--dim)}
.card{border:1px solid var(--rule);border-radius:14px;padding:16px 16px 18px;margin:0 0 14px}
.card.off{opacity:.6}
.card-head{display:flex;align-items:baseline;gap:9px;margin-bottom:14px}
.card-head .name{font-size:17px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-head .key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;color:var(--faint)}
.badge{margin-left:auto;font-size:12px;letter-spacing:.08em;border:1px solid var(--rule);border-radius:99px;padding:1px 9px;color:var(--dim);white-space:nowrap}
label{display:block;font-size:13px;color:var(--dim);margin:0 0 5px;line-height:1.5}
input[type=text],input[type=number]{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;
  padding:10px 12px;color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
input[type=number]{font-family:var(--num)}
input:focus{outline:1px solid var(--ring-prog);outline-offset:0}
.field{margin-bottom:14px}
.row{display:flex;gap:10px}
.row .field{flex:1;min-width:0}
.check{display:flex;align-items:center;gap:10px;margin:0 0 16px}
.check input{width:20px;height:20px;accent-color:var(--fg);margin:0;flex:0 0 auto}
.check label{margin:0;color:var(--fg);font-size:15px}
.actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
button.primary{background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:99px;padding:12px 26px;font-size:16px;min-height:46px}
button.primary:active{opacity:.72}
button.linky{color:var(--dim);font-size:14px;text-decoration:underline;text-underline-offset:3px;padding:11px 0;min-height:44px}
button.linky.danger{color:var(--danger)}
a.linky{color:var(--dim);font-size:14px}
.banner{border:1px solid var(--rule);border-radius:12px;padding:12px 15px;font-size:14px;line-height:1.75;margin:0 0 16px}
.banner.bad{border-color:var(--danger);color:var(--danger)}
.banner.good{color:var(--dim)}
.banner-go{margin-left:.5rem;white-space:nowrap;text-underline-offset:3px;color:inherit}
.empty{border:1px dashed var(--rule);border-radius:14px;padding:26px 16px;text-align:center;color:var(--dim);font-size:15px;margin-bottom:16px}
hr.sep{border:0;border-top:1px solid var(--rule);margin:28px 0 18px}
.note-tight{margin-bottom:14px}
.note.flat{margin:0}
p.flat{margin:0}
${ICON_CSS}`
