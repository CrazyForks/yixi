// Shared chrome for the three "console" pages — /settings, /probe, /admin (and
// the nav /review renders too). They must read as one surface that people tab
// between, not four separate designs.
//
// This lives in its own module rather than inside any one page: a page module
// that doubles as the shared library for its siblings is a dependency direction
// that only gets worse as pages are added.

import type { User } from '../types'
import { escapeHtml } from './layout'

// --- shared console chrome -------------------------------------------------

export type ConsolePage = 'review' | 'settings' | 'probe' | 'setup' | 'account' | 'admin'

export function consoleHeader(user: User, active: ConsolePage): string {
  const tab = (href: string, name: ConsolePage, text: string) =>
    `<a href="${href}"${active === name ? ' class="on"' : ''}>${text}</a>`
  return `<header>
  <span class="brand">一息</span>
  <span class="who">${escapeHtml(user.name)}</span>
  <nav>
    ${tab('/review', 'review', '回顾')}
    ${tab('/settings', 'settings', '设置')}
    ${tab('/probe', 'probe', '实测')}
    ${tab('/setup', 'setup', '怎么配')}
    ${tab('/account', 'account', '账号')}
    ${user.is_owner ? tab('/admin', 'admin', '发号') : ''}
  </nav>
</header>`
}

/**
 * Extends the theme tokens layout.ts already emitted (--bg/--fg/--dim/--faint/
 * --rule/--font), so these pages wear whichever face the owner picks at /mock,
 * and matches /review's shell measurements exactly — the four pages are one
 * surface that people tab between, not four designs.
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
body{font-size:15px;line-height:1.7}
header,main{max-width:520px;margin:0 auto;padding:0 18px}
header{display:flex;align-items:baseline;gap:10px;padding-top:26px;padding-bottom:14px}
.brand{font-size:19px;font-weight:600;letter-spacing:.24em;text-indent:.24em}
.who{font-size:12px;color:var(--faint)}
header nav{
  margin-left:auto;display:flex;gap:15px;font-size:13px;
  overflow-x:auto;white-space:nowrap;scrollbar-width:none;
}
header nav::-webkit-scrollbar{display:none}
header nav a{flex:none}
header nav a{color:var(--dim);text-decoration:none}
header nav a.on{color:var(--fg)}
main{padding-bottom:calc(40px + env(safe-area-inset-bottom))}
h1{font-size:17px;font-weight:600;margin:8px 0 6px}
h2{margin:0 0 10px;font-size:13px;font-weight:400;color:var(--dim);letter-spacing:.12em}
p{margin:0 0 10px}
.num{font-family:var(--num);font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.lede{font-size:13px;line-height:1.75;color:var(--dim);margin-bottom:18px}
.note{font-size:12px;line-height:1.75;color:var(--faint);margin:10px 0 0}
.note a,.lede a{color:var(--dim)}
.card{border:1px solid var(--rule);border-radius:14px;padding:16px 16px 18px;margin:0 0 14px}
.card.off{opacity:.6}
.card-head{display:flex;align-items:baseline;gap:9px;margin-bottom:14px}
.card-head .name{font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.card-head .key{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--faint)}
.badge{margin-left:auto;font-size:11px;letter-spacing:.08em;border:1px solid var(--rule);border-radius:99px;padding:1px 9px;color:var(--dim);white-space:nowrap}
label{display:block;font-size:12px;color:var(--dim);margin:0 0 5px;line-height:1.5}
input[type=text],input[type=number]{display:block;width:100%;font:inherit;font-size:16px;line-height:1.4;
  padding:10px 12px;color:var(--fg);background:transparent;border:1px solid var(--rule);border-radius:10px}
input[type=number]{font-family:var(--num)}
input:focus{outline:1px solid var(--ring-prog);outline-offset:0}
.field{margin-bottom:14px}
.row{display:flex;gap:10px}
.row .field{flex:1;min-width:0}
.check{display:flex;align-items:center;gap:10px;margin:0 0 16px}
.check input{width:20px;height:20px;accent-color:var(--fg);margin:0;flex:0 0 auto}
.check label{margin:0;color:var(--fg);font-size:14px}
.actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
button.primary{background:var(--stop-bg);color:var(--stop-fg);border:1px solid var(--stop-border);
  border-radius:99px;padding:11px 24px;font-size:15px;min-height:44px}
button.primary:active{opacity:.72}
button.linky{color:var(--dim);font-size:13px;text-decoration:underline;text-underline-offset:3px;padding:11px 0;min-height:44px}
button.linky.danger{color:var(--danger)}
a.linky{color:var(--dim);font-size:13px}
.banner{border:1px solid var(--rule);border-radius:12px;padding:11px 14px;font-size:13px;line-height:1.7;margin:0 0 16px}
.banner.bad{border-color:var(--danger);color:var(--danger)}
.banner.good{color:var(--dim)}
.banner-go{margin-left:.5rem;white-space:nowrap;text-underline-offset:3px;color:inherit}
.empty{border:1px dashed var(--rule);border-radius:14px;padding:24px 16px;text-align:center;color:var(--dim);font-size:14px;margin-bottom:16px}
hr.sep{border:0;border-top:1px solid var(--rule);margin:28px 0 18px}
.note-tight{margin-bottom:14px}
.note.flat{margin:0}
p.flat{margin:0}
`
