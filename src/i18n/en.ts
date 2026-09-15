/**
 * English translations, keyed by the Chinese source text that `t()`/`msg()`
 * calls pass as their first argument — see src/i18n/index.ts for how a key is
 * looked up and how a miss falls back to the Chinese source itself.
 *
 * Grouped by the page that introduced each key; a key used by more than one
 * page lives in the first group that needs it. test/i18n.test.ts's guard ②
 * fails as soon as a `t()`/`msg()` source anywhere in src/ has no entry here,
 * guard ③ that a translation has kept its `{placeholders}` and picked up no
 * Chinese characters or punctuation on the way.
 *
 * The voice is the Chinese one, in English: plain, concrete, quiet. No
 * exclamation marks, no adjectives selling the product back to the reader, no
 * instruction the Chinese does not also give. Curly quotes where the Chinese
 * uses 「」; every HTML tag, `href` and placeholder exactly as the source has
 * it. 一息 stays 一息 — it is the product's name, not a word.
 */
export const EN: Record<string, string> = {
  // --- shared console chrome (src/ui/console.ts) -----------------------------
  // The two faces and their tabs. 「回看」 (goal-tending) and 「回顾」
  // (interception) are both "looking back"; English splits them into Review
  // and Log so a nav never offers the same word twice.
  今日: 'Today',
  目标: 'Goals',
  回看: 'Review',
  怎么配: 'Guide',
  回顾: 'Log',
  设置: 'Settings',
  拦截: 'Breathe',
  导航: 'Navigation',
  账号: 'Account',
  发号: 'Invites',

  // --- /today (src/ui/today.ts) ----------------------------------------------
  '今日 · 一息': 'Today · 一息',
  编辑目标: 'Edit goals',
  '先写一件最重要的事。': 'Write down the one thing that matters most.',
  健身: 'Exercise',
  新目标: 'New goal',
  记下: 'Note it',
  '{title}，今天打卡': '{title}, check in for today',
  '{title}，已打卡，点击取消': '{title}, checked in. Tap to undo.',
  最近七天: 'The last seven days',
  '{title}，今天勾上': '{title}, check off for today',
  '{title}，已勾上，点击取消': '{title}, checked off. Tap to undo.',
  // The Chinese pair exists only for its spacing rule (「去 B 站」 but
  // 「去微信读书」); English has one sentence for both.
  '去 {label}': 'Open {label}',
  '去{label}': 'Open {label}',
  去做: 'Go',
  '去绑一个 App，一按就开': 'Link an app, and it opens with one tap',
  '其余目标 · {n}': 'Other goals · {n}',
  '今天的事都做了。': 'That is everything for today.',
  '其余的事，明天再说。': 'The rest can wait until tomorrow.',
  '<b>添加到主屏幕</b>，以后一按就开。Safari 底部「分享」→「添加到主屏幕」。装好后第一次打开要再登录一次。':
    '<b>Add to Home Screen</b>, and it opens with one tap. In Safari, “Share” at the bottom → “Add to Home Screen”. The first time you open it from the icon you will have to sign in once more.',
  知道了: 'Got it',

  // --- /today/goals (src/ui/goals.ts) ----------------------------------------
  '目标 · 一息': 'Goals · 一息',
  '未来一段时间最重要的几件事。排前面的 {n} 个会出现在<a href="/today">今日</a>。':
    'The few things that matter most in the weeks ahead. The top {n} show up on <a href="/today">Today</a>.',
  '还没有目标。<br>用上面的 {plus} 加第一个。': 'No goals yet.<br>Use the {plus} above to add the first one.',
  加一个目标: 'Add a goal',
  添加: 'Add',
  '目标 · 一句话': 'Goal · one line',
  '什么时候做 · 可不填': 'When you do it · optional',
  // The goal's jump section folds behind this, the same way each sub-task's
  // does. Both summaries say it, so the two folds read as one idea.
  跳去哪: 'Where it jumps',
  '去做时跳去哪 · 可不填': 'Where the button jumps · optional',
  'bilibili:// 或 https://…': 'instagram:// or https://…',
  '填<b>具体那一节课、那一本书</b>的链接，比填 App 首页少走两步。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。':
    'Link <b>the exact lesson, the exact book</b> rather than the app home screen — two steps fewer. After typing a custom scheme, <b>test it</b>: it counts only once the app really opens. An https link needs no test.',
  按钮上叫它什么: 'What the button calls it',
  '做到哪天 · 可不填': 'Until · optional',
  长期: 'Ongoing',
  保存: 'Save',
  上移: 'Up',
  下移: 'Down',
  归档: 'Archive',
  '子任务 · 每天都做': 'Sub-tasks · every day',
  '今天 {x}/{n}': 'Today {x}/{n}',
  存: 'Save',
  '这条子任务跳去哪 · 可不填': 'Where this sub-task jumps · optional',
  '不填就跟着目标走。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。':
    'Leave it empty and it follows the goal. After typing a custom scheme, <b>test it</b>: it counts only once the app really opens. An https link needs no test.',
  '还没有。': 'None yet.',
  删: 'Delete',
  加一条子任务: 'Add a sub-task',
  子任务: 'Sub-task',
  加: 'Add',
  // How many goal cards /today puts on the page, 1…9. The label names the
  // page rather than the number, because the number is the control itself.
  今日页放几个目标: 'How many goals on Today',
  '只能是 {min} 到 {max} 之间的一个数。': 'It has to be a number between {min} and {max}.',
  '已归档 · {n}': 'Archived · {n}',
  恢复: 'Restore',
  删除: 'Delete',
  // Rendered inside an onclick="return confirm('…')", so no apostrophes here.
  '删掉这个目标？子任务会一起删，打卡记录保留。': 'Delete this goal? Its sub-tasks go with it. Check-ins are kept.',
  '<b>{title}</b> 到期了（{until}）。': '<b>{title}</b> ended on {until}.',
  续四周: 'Extend by four weeks',

  // Messages the form gives back when something will not save.
  '目标名不能空着。': 'A goal needs a name.',
  '目标名太长了，{n} 个字以内。': 'That name is too long. {n} characters at most.',
  '触发时机太长了，{n} 个字以内。': 'That is too long for “When you do it”. {n} characters at most.',
  'App 名太长了，{n} 个字以内。': 'That app name is too long. {n} characters at most.',
  '跳转目标太长了。': 'That link is too long.',
  '跳转目标要长成 xxx:// 或 https:// 的样子，而且不能是脚本。':
    'The link has to look like xxx:// or https://, and it cannot be a script.',
  '日期要写成 2026-10-11 这样。': 'Write the date like 2026-10-11.',
  '表单没读出来，重试一次。': 'The form did not come through. Try again.',
  '目标编号不对。': 'That goal number is not right.',
  '子任务要有名字，{n} 个字以内。': 'A sub-task needs a name. {n} characters at most.',
  '子任务编号不对。': 'That sub-task number is not right.',
  '不认识这个操作。': 'That is not an action this page knows.',
  '先归档，再删除。': 'Archive it first, then delete it.',

  // --- /today/review (src/ui/progress.ts) ------------------------------------
  '回看 · {name}': 'Review · {name}',
  今天: 'Today',
  '最近 {days} 天': 'The last {days} days',
  最近三十天每天的完成比例: 'How much of each day was done, over the last thirty days',
  // Counted things, and every count can be 1. English agreement would make
  // 「1 days have a record」 out of the natural phrasing, so these read as a
  // stat line instead — the number is the answer, and no verb has to agree
  // with it. The Chinese is unchanged; it never had the problem.
  '{days} 天里有记录的 {n} 天，做完全部的 {full} 天。':
    'Of {days} days: {n} with a record, {full} done in full.',
  每个目标: 'Each goal',
  '没有正在进行的目标。': 'No goals running right now.',
  这周: 'This week',
  '做了 <b class="num">{n}</b> 次子任务。': 'Sub-tasks checked: <b class="num">{n}</b>.',
  '拦截那边的记录在<a href="/review">回顾</a>。':
    'Breathe keeps its own record under <a href="/review">Log</a>.',
  '{n} 天 · 打卡 {x} 天': '{n}-day span · {x} checked',
  '还没有可以回看的。先去<a href="/today">今日</a>记下一件事。':
    'Nothing to look back on yet. Go to <a href="/today">Today</a> and write down one thing.',

  // --- /today/setup (src/ui/todaysetup.ts) -----------------------------------
  '怎么配 · 一息': 'Guide · 一息',
  // The address itself is a copy line at the top of the page now, so neither
  // step repeats it: an address printed three times is three chances to copy
  // the wrong one of them.
  // No article: this is both the quiet label above the line and the {name} in
  // the button's 「复制{name}」, and 「Copy The address of the Today page」 is
  // not a thing a screen reader should have to read out.
  今日页的网址: 'Today page address',
  '<b>添加到主屏幕</b>。Safari 打开上面这条网址，底部「分享」→「添加到主屏幕」。\n    之后点图标就是全屏、没有地址栏。装好后第一次打开要<b>再登录一次</b>——主屏幕里的它和 Safari 不共享登录，登一次管半年。':
    '<b>Add to Home Screen</b>. Open the address above in Safari, then “Share” at the bottom → “Add to Home Screen”. Tapping the icon after that is full screen, with no address bar. The first time you open it you will have to <b>sign in once more</b> — the copy on the home screen does not share a login with Safari, and one sign-in lasts half a year.',
  '<b>快捷指令入口</b>。「快捷指令」App 新建一条，只放一个动作「打开 URL」，网址填上面这条网址。\n    然后三选一：主屏幕长按→小组件→「快捷指令」，把它放上去；iPhone 15 Pro 以上在「设置→操作按钮」里绑它；\n    或「设置→辅助功能→触控→轻点背面」绑它。':
    '<b>A shortcut</b>. In the Shortcuts app, make one with a single action, “Open URL”, pointing at the address above. Then pick one of three: long-press the home screen → Widgets → “Shortcuts” and put it there; on iPhone 15 Pro and later bind it under “Settings → Action Button”; or bind it under “Settings → Accessibility → Touch → Back Tap”.',
  '<b>每天早上自动打开</b>。「快捷指令」→「自动化」→「特定时间」，选每天早上的时刻，运行上面那条，\n    关掉「运行前询问」。这就是提醒，不用推送。':
    '<b>Open it by itself every morning</b>. “Shortcuts” → “Automation” → “Time of Day”, pick a time in the morning, run the shortcut above, and turn off “Ask Before Running”. That is the reminder, with no notification involved.',
  '拦截那边的配置在<a href="/setup">这里</a>。': 'Breathe is set up <a href="/setup">here</a>.',

  // --- the breathing page (src/ui/breathe.ts) --------------------------------
  // 「算了」 is the loud, filled button and 「继续打开」 the quiet underlined
  // link 800ms later; English has to keep that asymmetry audible, so the exit
  // is the short everyday phrase and proceeding is the one that admits what it
  // is. The four parting lines are one each for a quarter of the sids — plain,
  // no praise, no lecture.
  '好，就到这里。': 'All right. That is far enough.',
  '这一次，你没有点进去。': 'This time you did not go in.',
  '省下来的几分钟是你的。': 'The few minutes you saved are yours.',
  '放下就好。': 'Putting it down is enough.',
  '这个链接过期了。': 'This link has expired.',
  '回到主屏幕重新打开就好。': 'Go back to the home screen and open it again.',
  吸气: 'Inhale',
  呼气: 'Exhale',
  '可以锁屏了。': 'You can lock the screen now.',
  '正在打开{label}……': 'Opening {label}…',
  '没有反应的话，回主屏幕手动打开就好。': 'If nothing happens, go back to the home screen and open it yourself.',
  '这个 App 还没配 URL scheme，手动打开就好。': 'This app has no URL scheme set up yet. Open it yourself.',
  '你正要打开<b>{label}</b>': 'You are about to open <b>{label}</b>',
  呼吸引导: 'Breathing guide',
  算了: 'Never mind',
  继续打开: 'Open it anyway',
  '这一页需要 JavaScript。回到主屏幕重新打开就好。':
    'This page needs JavaScript. Go back to the home screen and open it again.',

  // --- the two skins (src/ui/layout.ts) --------------------------------------
  // What the /mock switcher calls them: 「墨」 the wash of ink, 「息」 the ring
  // and the dot.
  墨: 'Ink',
  息: 'Breath',

  // --- /mock (src/ui/mock.ts) ------------------------------------------------
  // The example label a visitor sees when they have not named one themselves —
  // 「小红书」 for a Chinese reader, an app an English reader would actually
  // have for the other. A label somebody typed is data and is never touched.
  '这里会跳回{label}。': 'This is where it would jump back to {label}.',
  '预览页不跳转。': 'A preview page goes nowhere.',
  小红书: 'Instagram',
  视觉预览: 'Visual preview',
  预览: 'Preview',
  再看一次: 'Again',

  // --- the landing page (src/ui/landing.ts) ----------------------------------
  // The one page written for a stranger, and the only indexable one, so the
  // title and the meta description are copy too. 一息 keeps its characters; the
  // first mention in English carries 「yixi」 beside it so it can be said out
  // loud.
  '一息 —— 打开 App 之前先呼吸十秒，「今日」收好最重要的三件事':
    '一息 (yixi) — ten seconds of breathing before an app opens, and “Today” for the three things that matter most',
  '在 iPhone 上打开小红书这类 App 之前，先看着一团墨呼吸十秒，然后再决定进不进去；「今日」一页则收好未来一段时间最重要的三件事，一按就去做。自建的 One Sec 替代品：一个网页加 iOS 快捷指令，不用装 App，跑在 Cloudflare 免费额度里。':
    'Before an app like Instagram opens on an iPhone, watch a wash of ink and breathe for ten seconds, then decide whether to go in. “Today” holds the three things that matter most in the weeks ahead, one tap from being done. A self-hosted One Sec alternative: one web page plus an iOS Shortcut, no app to install, running inside the Cloudflare free tier.',
  '在你打开一个 App 之前，先呼吸十秒。': 'Ten seconds of breathing before you open an app.',
  '一息做两件事。<b>拦</b>：打开小红书这类 App 之前先呼吸十秒。<b>引</b>：把未来一段时间最重要的三件事放在<a href="/today">今日</a>一页，一按就去做。两件事各自能用，共用一个账号。':
    '一息 (yixi) does two things. <b>Breathe</b>: ten seconds before an app like Instagram opens. <b>Steer</b>: the three things that matter most in the weeks ahead sit on one page, <a href="/today">Today</a>, one tap from being done. Either half works on its own, and they share one account.',
  '这一页是从某个 App 的内置浏览器打开的。\n逛可以，<b>但配置那一步不行</b>——内置浏览器不让网页跳去别的 App，而配置里要靠这个验证。\n点右上角的「⋯」，选「在浏览器中打开」。':
    'This page was opened inside the built-in browser of some app.\nReading is fine, <b>but the setup step is not</b> — a built-in browser will not let a page jump to another app, and setup depends on exactly that.\nTap the “⋯” in the top-right corner and choose “Open in browser”.',
  '呼吸页示意：一团墨随呼吸涨落，外圈是倒计时':
    'A look at the breathing page: a wash of ink swelling and fading with the breath, the ring outside it counting down',
  '十秒之后，页面先递给你「算了」，过一会儿才递给你「继续」。\n顺序是故意的——大多数时候你会发现，那一下其实只是手指的惯性。':
    'Ten seconds in, the page offers you “Never mind” first, and only a little later “Open it anyway”.\nThe order is deliberate — most of the time you find the tap was nothing but the habit in your thumb.',
  怎么工作: 'How it works',
  'iPhone 的「快捷指令」在你打开某个 App 时，先来这里问一句该不该拦。':
    'The iPhone Shortcuts app comes here first when you open an app, and asks whether to stop you.',
  '该拦就跳到呼吸页，倒计时期间没有任何按钮可以点。':
    'If the answer is yes, it jumps to the breathing page, where nothing can be tapped while the ring fills.',
  '选「继续」会放行一分半，免得刚跳回去又被自己拦住。':
    'Choosing “Open it anyway” lets the app through for a minute and a half, so you are not stopped again the moment you land in it.',
  它记什么: 'What it records',
  '只记时间、哪个 App、以及你那次是继续了还是放下了。\n过一阵你能看到自己一周被拦了多少次，其中多少次没进去。':
    'Only the time, which app, and whether you went on or put it down.\nAfter a while you can see how many times a week you were stopped, and how many of those you walked away from.',
  关于隐私: 'On privacy',
  '注册只要一个邮箱和一个密码。邮箱不发信、不验证，只是你下次登录的用户名。':
    'Signing up takes an email address and a password. Nothing is ever sent to the address and it is never verified; it is only the name you sign in with next time.',
  '真正的身份是一把 token，快捷指令拿它认人。它加密存在服务器上，\n所以你登录之后还能看回来——代价是数据库和密钥同时泄露时它会跟着泄。\n这是为了「忘了也找得回来」换的，值不值得你自己判断。':
    'The real identity is a token, and the Shortcut uses it to know who you are. It is stored encrypted on the server,\nso you can still read it back after signing in — the price is that it leaks along with the database if the key leaks at the same time.\nThat is the trade made for “findable again after you forget it”, and whether it is worth it is yours to judge.',
  '记录只有你自己看得到。发号的人只看得到聚合次数，看不到任何一条明细——\n不然这东西没人会真的用。':
    'Your records are yours alone. Whoever handed out the token sees aggregate counts and not one single entry —\notherwise nobody would really use this.',
  '上面这几句都可以自己核对：<a href="https://github.com/Defiabell/yixi" rel="noreferrer">代码是开源的</a>。\n不想把这类数据放在别人的服务器上，照 README 部署一份自己的，\n跑在 Cloudflare 免费额度里，不花钱。':
    'You can check every line above for yourself: <a href="https://github.com/Defiabell/yixi" rel="noreferrer">the code is open source</a>.\nIf you would rather not leave this kind of data on somebody else’s server, follow the README and deploy your own,\nrunning inside the Cloudflare free tier, at no cost.',
  长什么样: 'What it looks like',
  '上面那团就是。倒计时期间页面上没有任何按钮，十秒之后才先出现「算了」。\n<span class="looks">整页看看：<a href="/mock?v=1">墨</a><a href="/mock?v=2">息</a></span>':
    'That is the one above. Nothing on the page can be tapped while the ring fills; ten seconds in, “Never mind” appears first.\n<span class="looks">See a whole one: <a href="/mock?v=1">Ink</a><a href="/mock?v=2">Breath</a></span>',
  开始用: 'Getting started',
  注册: 'Sign up',
  登录: 'Sign in',
  '已经有别人发给你的 token 了？<a href="/claim">给它绑上邮箱和密码</a>，别重新注册——\n重新注册会拿到一把新的，旧记录就找不回来了。<br>\n配到 iPhone 上的一步一步说明在<a href="/setup">怎么配</a>，登录之后打开就行。<br>\n源码 · <a href="https://github.com/Defiabell/yixi" rel="noreferrer">github.com/Defiabell/yixi</a>':
    'Already have a token somebody sent you? <a href="/claim">Attach an email address and a password to it</a> rather than signing up again —\nsigning up again hands you a new one, and the old records are out of reach.<br>\nThe step-by-step for setting it up on an iPhone is under <a href="/setup">Guide</a>, once you have signed in.<br>\nSource · <a href="https://github.com/Defiabell/yixi" rel="noreferrer">github.com/Defiabell/yixi</a>',

  // --- the account pages (src/ui/account.ts) ---------------------------------
  // The four pages a stranger or a signed-in reader meets around their own
  // account. 「token」 stays 「token」 in both languages — it is the word the
  // Shortcut, the docs and the /setup tutorial all already use.
  '注册 · 一息': 'Sign up · 一息',
  '注册之后你会拿到一把 <b>token</b>。iPhone 的「快捷指令」拿它认出你，你被拦下的每一条记录也都记在它名下。它就是这个账号本身。':
    'Signing up hands you a <b>token</b>. The iPhone Shortcuts app knows you by it, and every time you are stopped the record is filed under it. It is the account itself.',
  先说清楚代价: 'The price, up front',
  '这里<b>没有邮件服务</b>。邮箱不发信、不验证，也不能用来找回密码——它只是你下次登录时的用户名。':
    'There is <b>no mail service here</b>. Nothing is ever sent to the address, it is never verified, and it cannot recover a password — it is only the name you sign in with next time.',
  '能救你的是两样东西，它们互为备份：': 'Two things can save you, and each is the other’s backup:',
  '<b>忘了密码</b> —— 用 token 重置。在<a href="/recover">重置那一页</a>把 token 贴进去，直接设一个新的。':
    '<b>Forgot the password</b> — reset it with the token. Paste the token into <a href="/recover">the reset page</a> and set a new one there and then.',
  '<b>忘了 token</b> —— 用密码登录，账号页上点一下就能看到它。它是加密存在服务器上的。':
    '<b>Forgot the token</b> — sign in with the password and one tap on the account page shows it. It is stored encrypted on the server.',
  '<b>两样都丢了</b> —— <b>没有办法</b>。没有验证邮件、没有客服、没有后门。这个账号连同里面所有记录都拿不回来，只能重新注册一个空的。':
    '<b>Lost both</b> — <b>there is nothing to be done</b>. No verification mail, no support desk, no back door. The account and every record in it are out of reach, and all that is left is to register an empty one.',
  '这个闭环是故意做成这样的：一个自己用的小工具不值得为它接一整套邮件系统，代价就是你得自己留住其中一样。注册完先把 token 存进密码管理器，一分钟的事。':
    'The loop is deliberate: a small tool you run for yourself is not worth wiring a whole mail system into, and the price is that keeping one of the two is your job. Once you have signed up, put the token in a password manager — it takes a minute.',
  '名字 · 选填，只显示在这几个页面上': 'Name · optional, shown only on these pages',
  '留空就用邮箱 @ 前面那截': 'Left empty, the part before the @',
  '密码 · 至少 {min} 位': 'Password · {min} characters or more',
  再打一遍: 'Type it again',
  '已经有账号了？<a href="/login">登录</a>。<br>\n手里已经有一把别人发给你的 token？<a href="/claim">给它绑上邮箱和密码</a>，别在这里重新注册——重新注册会拿到一把新的，旧记录就找不回来了。':
    'Already have an account? <a href="/login">Sign in</a>.<br>\nAlready holding a token somebody sent you? <a href="/claim">Attach an email address and a password to it</a> rather than signing up here — signing up again hands you a new one, and the old records are out of reach.',
  '邮箱 · 只当用户名用，不发信': 'Email · used as a username, never written to',
  '人机验证需要 JavaScript，请先在浏览器里打开它。': 'The human check needs JavaScript. Turn it on in your browser first.',
  '人机验证没过。刷新这一页，重新验证一次。': 'The human check did not pass. Refresh this page and take it again.',
  '两次输入的密码不一样，再来一次。': 'The two passwords do not match. Try again.',
  '去登录 →': 'Sign in →',

  '登录 · 一息': 'Sign in · 一息',
  '登录只是为了让你在这几个页面上看到自己的记录和 token。快捷指令那边不受影响，它认的一直是 token。':
    'Signing in is only so that you can see your own records and your own token on these pages. It changes nothing for the Shortcut, which has always known you by the token.',
  密码: 'Password',
  '忘了密码？<a href="/recover">用 token 重置</a>。<br>\n还没有账号？<a href="/register">注册一个</a>。':
    'Forgot the password? <a href="/recover">Reset it with the token</a>.<br>\nNo account yet? <a href="/register">Sign up</a>.',

  '绑定 · 一息': 'Attach · 一息',
  '给已有的 token 绑账号': 'Attach an account to a token you already have',
  '你手里那把 token 是发号时代给出去的，只有哈希存在服务器上。绑一次邮箱和密码，以后忘了它就能登录看回来。':
    'The token you hold was handed out in the ticket-window days, and the server keeps only its hash. Attach an email address and a password once, and if you forget it you can sign in and read it back.',
  'token · 32 位十六进制，粘贴进来': 'token · 32 hex characters, pasted in',
  '名字 · 选填，留空就沿用现在这个': 'Name · optional, left empty it keeps the current one',
  绑定: 'Attach',
  'token 本身不变，快捷指令不用改。绑定只是多给这个账号一条登录的路。':
    'The token itself does not change and the Shortcut needs no edit. Attaching only adds one more way into this account.',
  '没有 token，只是想开始用？<a href="/register">注册一个新的</a>。':
    'No token, and you just want to start? <a href="/register">Sign up for a new one</a>.',

  '重置密码 · 一息': 'Reset password · 一息',
  '用 token 重置密码': 'Reset the password with the token',
  '这里不发验证邮件。能证明你是你的，是你手里那把 token——它是 128 位随机数，比一封能被人翻走的邮件更硬。':
    'No verification mail is sent here. What proves you are you is the token in your hands — 128 random bits, harder than a mail somebody else can go through.',
  '新密码 · 至少 {min} 位': 'New password · {min} characters or more',
  重置并登录: 'Reset and sign in',
  'token 一般在你当初配快捷指令时那条「文本」动作里，或者在你的密码管理器里。重置之后 <b>token 不变</b>，快捷指令照常工作；但所有已经登录的浏览器都会被踢下线，只留你手上这一个。':
    'The token is usually in the “Text” action of the Shortcut you set up, or in your password manager. After a reset <b>the token is unchanged</b> and the Shortcut keeps working, but every browser already signed in is dropped, apart from the one in your hands.',
  'token 也丢了？那这个账号真的回不来了，只能<a href="/register">重新注册一个空的</a>。<br>\n密码想起来了？<a href="/login">去登录</a>。':
    'Lost the token as well? Then this account really is gone, and all that is left is to <a href="/register">register an empty one</a>.<br>\nRemembered the password? <a href="/login">Sign in</a>.',

  '账号 · {name}': 'Account · {name}',
  还没有绑定邮箱: 'No email address attached yet',
  '加入于 <span class="num">{date}</span>': 'Joined <span class="num">{date}</span>',
  语言: 'Language',
  '注册好了。别急着走——先点下面的「显示」，把 token 存进密码管理器。':
    'You are signed up. Before you go, tap “Show” below and put the token in a password manager.',
  '绑好了。以后忘了 token 就用邮箱和密码登录，在这一页看回来。':
    'Attached. If you forget the token, sign in with the email address and password and read it back on this page.',
  '密码已经重置，其他设备上的登录都被踢掉了。': 'The password is reset, and every sign-in on other devices was dropped.',
  '密码改好了。其他设备上的登录都被踢掉了，这台还在。':
    'The password is changed. Every sign-in on other devices was dropped; this one is still here.',
  '你的 token': 'Your token',
  '快捷指令用它认出你，它也是你所有记录的钥匙。别截图，别贴进聊天框。':
    'The Shortcut knows you by it, and it is the key to every record you have. Do not screenshot it, do not paste it into a chat.',
  显示: 'Show',
  '要把它配进 iPhone，去<a href="/setup">怎么配</a>——那一页已经替你把完整的地址拼好了，照抄就行。':
    'To put it on an iPhone, go to <a href="/setup">Guide</a> — that page has already assembled the whole address, ready to copy.',
  '服务器这边打不开你的 token 原文，只存着它的哈希。<br>它照常能用，只是这里看不到。':
    'This server cannot open the plaintext of your token; it holds only the hash.<br>The token still works — it just cannot be shown here.',
  用它绑一次账号: 'Attach an account with it',
  复制: 'Copy',
  藏起来: 'Hide it',
  已复制: 'Copied',
  '已选中，长按拷贝': 'Selected — press and hold to copy',
  // The same two words for the shared copy line (src/ui/layout.ts), which has
  // to fit them into a button beside a URL in a table cell at 390px rather
  // than under a token card with a whole row to itself. 「复制{name}」 is the
  // button's aria-label: six 「复制」 in a column are one word six times to a
  // screen reader.
  长按拷贝: 'Hold to copy',
  '复制{name}': 'Copy {name}',
  '换一把新 token': 'Swap in a new token',
  '泄漏了才需要这么做。<b>旧 token 立刻失效</b>，你手机上每一条用到它的快捷指令都得把网址里的\n  <span class="mono">k=</span> 换成新的，改完之前那些 App 不会再被拦。改密码不会换 token，两者互不影响。':
    'Only needed if it has leaked. <b>The old token stops working at once</b>, and every Shortcut on your phone that uses it needs the\n  <span class="mono">k=</span> in its address replaced; until you do, those apps go unstopped. Changing the password does not change the token — the two are independent.',
  当前密码: 'Current password',
  换一把: 'Swap it',
  '新 token': 'The new token',
  '<b>只显示这一次。</b>现在就存进密码管理器，然后去把快捷指令里的网址换掉。':
    '<b>Shown this once only.</b> Put it in a password manager now, then go and replace the address in your Shortcuts.',
  '旧的那把已经不认了。去<a href="/setup?show=1">怎么配</a>拿现成的整行网址。':
    'The old one is not recognised any more. Go to <a href="/setup?show=1">Guide</a> for the whole address, ready to copy.',
  改密码: 'Change the password',
  保存新密码: 'Save the new password',
  '改密码不会换掉 token，快捷指令不用动。但其他设备上的登录会全部失效，只留你手上这一个。':
    'Changing the password does not change the token, and the Shortcut needs no edit. Every sign-in on other devices does stop working, apart from the one in your hands.',
  给它绑上邮箱和密码: 'Attach an email address and a password to it',
  还没有密码: 'No password yet',
  '这个账号是发号时代建的，只有一把 token，没有邮箱也没有密码。现在这样也能用，但 token 一丢就没了。':
    'This account was made in the ticket-window days: one token, no email address and no password. It works as it is, but lose the token and it is gone.',
  退出登录: 'Sign out',
  '退出只清掉这台设备上的登录状态。快捷指令照常拦你——它认的是 token，不是这个登录。':
    'Signing out clears the sign-in on this device only. The Shortcut goes on stopping you — what it knows you by is the token, not this session.',
  '不想把这些记录放在别人的服务器上？\n    <a href="https://github.com/Defiabell/yixi" rel="noreferrer">源码在这里</a>，\n    照 README 部署一份自己的，跑在 Cloudflare 免费额度里。':
    'Would you rather these records did not sit on somebody else’s server?\n    <a href="https://github.com/Defiabell/yixi" rel="noreferrer">The source is here</a>;\n    follow the README and deploy your own, running inside the Cloudflare free tier.',

  // --- what src/account.ts hands back when something will not save ----------
  '这个邮箱看着不对，检查一下。': 'That address does not look right. Check it.',
  '密码至少 {min} 位，最多 {max} 位。': 'A password is {min} characters at least and {max} at most.',
  '名字不能是空的，也别超过 {max} 个字。': 'A name cannot be empty, and cannot run past {max} characters.',
  '这个邮箱已经注册过了，直接登录。': 'That address is already registered. Sign in instead.',
  '邮箱或密码不对。': 'That address or password is wrong.',
  '这个 token 不对。': 'That token is not right.',
  '这个 token 还没绑定邮箱和密码，先去绑定。':
    'That token has no email address or password attached yet. Attach them first.',
  '这个 token 已经绑过账号了，直接登录，或者用它重置密码。':
    'That token already has an account. Sign in, or use it to reset the password.',
  '当前密码不对。': 'That is not the current password.',

  // --- /settings (src/ui/settings.ts) ---------------------------------------
  '设置 · 一息': 'Settings · 一息',
  '要拦哪些 App': 'Which apps to stop',
  '每条对应 iPhone 上一条「打开 App 时」自动化。改完立刻生效，不用重建快捷指令。':
    'Each row matches one “When App Is Opened” automation on the iPhone. A change takes effect at once, with no Shortcut to rebuild.',
  '已保存 <span class="mono">{app}</span>。': 'Saved <span class="mono">{app}</span>.',
  '已在拦 · {n}': 'Being stopped · {n}',
  '还没有配置任何 App。<br>用上面的 {plus} 加第一个。':
    'No apps configured yet.<br>Use the {plus} above to add the first one.',
  // 「{escape}」 is src/inapp.ts quoting the host app's own menu, so it stays in
  // that app's language — all seven are Chinese-only apps — and so does
  // 「{name}」, which is what their icon says on the phone.
  '你现在是在<b>{name}</b>内置的浏览器里。它不让网页跳去别的 App，所以这一页的\n    <b>试跳</b>按不出反应——<b>不是你的 scheme 填错了</b>。{escape}，用 Safari 打开这一页再试。\n    <br>真正拦你的时候不受影响：快捷指令打开的是系统默认浏览器，不经过{name}。':
    'You are inside the browser built into <b>{name}</b>. It will not let a page jump to another app, so <b>test it</b> on this page\n    does nothing at all — <b>your scheme is not wrong</b>. {escape}, then open this page in Safari and try again.\n    <br>What actually stops you is unaffected: the Shortcut opens the system default browser, which does not go through {name}.',
  '加一个 App': 'Add an app',
  'App 键 · 自动化里要手打的那行文本，小写': 'App key · the line you type in the automation, lowercase',
  // The example key in the App-key box. A key is the reader's own invention —
  // it only has to match the text they type into their own Shortcut — so this
  // is a suggestion, not a contract, and it may name an app an English reader
  // would have.
  xhs: 'instagram',
  'URL scheme · 点「继续」时用它跳回 App，<b>务必先实测</b>':
    'URL scheme · what “Open it anyway” jumps back to, <b>test it before you trust it</b>',
  '显示名 · 呼吸页上会看到': 'Display name · what the breathing page shows',
  已停用: 'Off',
  '删掉这条配置？已经记下的次数不会被删。': 'Delete this row? The counts already recorded stay.',
  '等待 · 秒': 'Wait · seconds',
  '免打扰 · 秒': 'Quiet · seconds',
  '「免打扰」建议 <span class="num">90</span> 秒。设得太短（几秒）会让你<b>刚跳回 App 就又被拦</b>。':
    '“Quiet” is best at <span class="num">90</span> seconds. Set it to a few seconds and you are <b>stopped again the moment you land in the app</b>.',
  它到底管什么: 'What it actually covers',
  '<p>点了「继续」之后这段时间内不再拦你。它同时解决了跳回 App 会再次触发自动化的死循环——这段时间内的触发算机器噪音，不进统计。</p>':
    '<p>For that long after you choose “Open it anyway”, you are not stopped again. It also settles the loop where jumping back into the app fires the automation once more — a trigger inside that window counts as machine noise and stays out of the statistics.</p>',
  启用拦截: 'Stop me before this app',
  'App 键只能用小写字母、数字、- 和 _，最长 32 位。它要和你在快捷指令自动化里手打的那行文本一模一样。':
    'An app key is lowercase letters, digits, - and _, up to 32 characters. It has to match the line you type in the Shortcuts automation exactly.',
  '显示名不能空着。': 'A display name cannot be empty.',
  '显示名太长了，40 个字以内。': 'That display name is too long. 40 characters at most.',
  'URL scheme 不能空着。不知道填什么就先随便填一个候选，再去「实测」页试。':
    'A URL scheme cannot be empty. If you do not know what goes here, put in any candidate and test it.',
  'URL scheme 太长了。': 'That URL scheme is too long.',
  'URL scheme 要长成 xxx:// 的样子，比如 someapp://。':
    'A URL scheme has to look like xxx://, for instance someapp://.',
  '这个 scheme 不能用。': 'That scheme cannot be used.',
  '等待秒数要是 1 到 120 之间的整数。': 'The wait has to be a whole number of seconds, 1 to 120.',
  '免打扰秒数要是 {min} 到 3600 之间的整数。太短会让你刚跳回 App 就又被拦。':
    'The quiet window has to be a whole number of seconds, {min} to 3600. Too short and you are stopped again the moment you land in the app.',
  '要删除的 App 键不对。': 'That is not an app key this page can delete.',
  '已经有一条 {key} 了。要改它就展开下面那条，别在这里重新加一遍——直接加会把它的秒数一起覆盖掉。':
    'There is already a row for {key}. Open that row below to change it rather than adding it again here — adding it again would overwrite its seconds too.',

  // --- getting out of an in-app browser (src/inapp.ts) ----------------------
  // Quoted menu items, in apps whose menus are Chinese. The English says what
  // to tap and what it will say, rather than pretending the menu is English;
  // the app names themselves are data and never come through here.
  '点右上角「⋯」→「在浏览器中打开」': 'Tap “⋯” in the top-right corner → “Open in browser”',
  '点右上角「⋯」→「在浏览器打开」': 'Tap “⋯” in the top-right corner → “Open in browser”',
  '点右上角「⋯」→「用默认浏览器打开」': 'Tap “⋯” in the top-right corner → “Open in default browser”',
  '点右上角分享 →「用浏览器打开」': 'Tap “Share” in the top-right corner → “Open in browser”',
  '点右上角「⋯」→「在 Safari 中打开」': 'Tap “⋯” in the top-right corner → “Open in Safari”',

  // --- the scheme field and its picker (src/ui/schemefield.ts) --------------
  // The worked examples are apps an English reader would actually have, same
  // rule as /today's 「健身」. Both schemes are real.
  '例：小红书 <code class="mono">xhsdiscover://</code>，起点读书 <code class="mono">QDReader://</code>。候选都<b>没验证过</b>，填完必须点<b>试跳</b>，App 真打开了才算数。':
    'For instance Instagram <code class="mono">instagram://</code>, Reddit <code class="mono">reddit://</code>. No candidate here is <b>verified</b>, so once you have filled one in you have to tap <b>test it</b> — it counts only when the app really opens.',
  试跳: 'Test it',
  '不知道填什么？按 App 名字找': 'Not sure what goes here? Search by app name',
  起点读书: 'Reddit',
  '按 App 名字搜索候选': 'Search candidates by app name',
  找: 'Search',
  // The three tiers a candidate is labelled with, shortest first — they sit in
  // a badge beside a seal and must not wrap.
  实测过: 'Tested',
  清单里有: 'On a list',
  猜的: 'A guess',
  两份清单一致: 'Two lists agree',
  '建议 App 键': 'Suggested app key',
  用这个: 'Use this',
  '表里没有这个 App。下面几条是<b>从 App Store 的 bundle id 猜出来的</b>，没人验证过 —— 一定要先试跳。':
    'This app is not in the table. The rows below are <b>guessed from the bundle id in the App Store</b> and verified by nobody — test one before you trust it.',
  '没找到这个 App。可以自己在上面的格子里填一个 scheme，再点<b>试跳</b>试试。':
    'This app was not found. You can put a scheme into the box above yourself and tap <b>test it</b>.',
  'App Store 拒了我们这次查询（它会拒绝 Cloudflare 的出口地址）。表里没有的 App 只能自己找 scheme。':
    'The App Store refused this query — it turns away Cloudflare’s outbound addresses. For an app that is not in the table, finding the scheme is yours to do.',
  '连 App Store 超时了。过一会儿再试，或者自己填一个 scheme 直接试跳。':
    'The App Store timed out. Try again in a while, or fill in a scheme yourself and test it.',
  'App Store 返回的内容看不懂。自己填一个 scheme 直接试跳也行。':
    'What the App Store returned could not be read. Filling in a scheme yourself and testing it works too.',
  '名字太短了，多打几个字。': 'That name is too short. Type a few more characters.',
  '这次没查成。': 'This search did not get through.',
  '先填 App 的名字。': 'Type the app name first.',
  '找…': 'Searching…',
  '没查成，网络或者服务的问题。自己填一个 scheme 直接试跳也行。':
    'The search did not get through — a network or a service problem. Filling in a scheme yourself and testing it works too.',
  '这条不像能跳的 scheme。': 'This does not look like a scheme that can be opened.',
  '这个不像能跳的 scheme，形状要是 xxx:// 。':
    'This does not look like a scheme that can be opened; the shape is xxx:// .',
  '先填一个 scheme。': 'Fill in a scheme first.',

  // --- /review (src/ui/review.ts) -------------------------------------------
  // The interception ledger. 「忍住」 is a deliberate walk-away and 「没做选择」
  // is the page being swiped past, and English has to keep those apart — the
  // whole honesty of the page is that the second is not counted as the first.
  '回顾 · {name}': 'Log · {name}',
  '今天还没有被拦下过。': 'Nothing has stopped you today.',
  次拦下: 'times stopped',
  忍住: 'Held',
  没做选择: 'No choice',
  进去了: 'Went in',
  '「忍住」是明确点了「算了」；「没做选择」是开了呼吸页直接切走——同样没进 App，但不算你主动放弃，所以分开记。':
    '“Held” is having tapped “Never mind”; “No choice” is the breathing page opening and being swiped away — the app went unopened either way, but only the first was a decision, so they are counted apart.',
  '这七天一次都没被拦下。': 'Nothing stopped you in these seven days.',
  '共 <b class="num">{n}</b> 次拦下，忍住 <b class="num">{hold}</b> 次，放弃率 <b class="num">{rate}</b>。':
    'stops in all: <b class="num">{n}</b>, held: <b class="num">{hold}</b>, walk-away rate: <b class="num">{rate}</b>.',
  '{date}：拦下 {n} 次，忍住 {hold}，没做选择 {idle}，进去了 {go}':
    '{date}: stopped {n}, held {hold}, no choice {idle}, went in {go}',
  '哪个 App 最消耗你': 'Which app costs you most',
  '这 {days} 天还没有记录。': 'No record in these {days} days yet.',
  '最近 {days} 天，按拦下次数排。': 'The last {days} days, ordered by how often you were stopped.',
  '<b class="num">{n}</b> 次': 'stops: <b class="num">{n}</b>',
  '忍住 {hold} · 没做选择 {idle} · 进去了 {go}': 'Held {hold} · no choice {idle} · went in {go}',
  '放弃率 {rate}': 'Walk-away rate {rate}',
  '其中 {idle} 次开了呼吸页但没做选择，{go} 次撑过等待还是进去了。':
    'Of those, {idle} opened the breathing page without choosing, and {go} sat through the wait and went in anyway.',
  '这 {days} 天没有记录。': 'No record in these {days} days.',
  次忍住: 'times held',
  放弃率: 'walk-away rate',
  有记录的天: 'days with a record',
  '记录始于 {date}。': 'Records begin {date}.',
  '另有 {n} 次是点「继续」跳回 App 时自动化重复触发的，属于机器噪音，未计入以上任何数字。':
    'Plus {n} from the automation firing again as “Open it anyway” jumped back into the app — machine noise, counted in none of the numbers above.',
  '这页只有你能看到。': 'This page is yours alone.',
  还没有记录: 'No records yet',
  '你还没有被拦下过一次。': 'You have not been stopped even once.',
  '先去 <a href="/settings">设置</a> 添加要拦的 App，再在 iPhone「快捷指令」里为它建一条「打开 App 时」自动化。之后每一次冲动都会记在这里。':
    'Go to <a href="/settings">Settings</a> first and add an app to stop, then build it a “When App Is Opened” automation in the iPhone Shortcuts app. After that every impulse is recorded here.',

  // --- scheme caveats (src/schemes.ts) ---------------------------------------
  // The reason to distrust one particular candidate, shown under it in the
  // picker on /settings. These sentences are what keep a guess from being read
  // as an answer, so they are the last copy in the product that could be left
  // untranslated. Two things stay verbatim because they are strings somebody
  // types or looks for rather than words: scheme tokens (`kwai`, `gifshow`,
  // `moble`, the `-iphone` suffix) and bundle-id vocabulary
  // (`App/Store/iPhone`). The Chinese 「数字」 standing in for a run of digits is
  // *not* one of them — it is prose, and English says so in square brackets:
  // `tencent[digits]://`. Angle brackets are deliberately not reused for it.
  // `<数字>` was carried into English verbatim for a while because guard ③'s
  // `TAG_RE` matched any `<…>` and tag parity then pinned it; the regex now
  // asks for an HTML tag name, and `<digits>` would walk straight back into
  // that trap because `digits` is a tag name as far as any regex can tell.
  // App names are given in the spelling the table's own `aliases` already use,
  // so a reader can find the row being pointed at.
  'iOS-URL-Scheme 把这一条同时记给了「火山小视频」。两个 App 不可能共用一个 scheme，所以至少有一条是抄错的。':
    'iOS-URL-Scheme files this same string under Huoshan as well. Two apps cannot share one scheme, so at least one of the two was copied down wrong.',
  '两份清单在这个 App 上不一致，一份记 kwai、一份记 gifshow。只能两个都试。':
    'The two collections disagree about this app: one records kwai, the other gifshow. There is nothing for it but to try both.',
  'iOS-URL-Scheme 把同一个 scheme 记在「微博轻享版」名下。两个名字指的可能是同一个 App，也可能不是。':
    'iOS-URL-Scheme files the same scheme under Weibo Lite. The two names may be one app, or may not.',
  '这一条就是 bundle id 本身当 scheme 用，看着不像但清单确实这么记。':
    'This one is the bundle id itself used as a scheme. It does not look like one, but that is how the collection records it.',
  '这种 tencent<数字>:// 的形状是腾讯开放平台分配的 App ID，很容易随版本换掉。':
    'A scheme shaped like tencent[digits]:// carries an App ID handed out by the Tencent open platform, and a release can change it easily enough.',
  '两份清单不一致。qiyi-iphone:// 看着像更老的那一版，但没人验证过。':
    'The two collections disagree. qiyi-iphone:// looks like the older of the two, but nobody has checked.',
  '两份清单不一致，差一个 -iphone 后缀。': 'The two collections disagree, by one -iphone suffix.',
  '结尾的 ap 看着像 app 被截断了，但清单就是这么记的。':
    'The ap at the end looks like a truncated app, but that is how the collection records it.',
  '两份清单都把 moble 写成了这样（不是 mobile）。可能是京东自己拼错的，也可能是一份抄错了另一份跟着传。照抄试一次就知道。':
    'Both collections spell it moble, not mobile. It may be JD’s own misspelling, or one collection’s slip that the other copied. Type it as written and one try settles it.',
  'tencentlaunch<数字>:// 里的数字是腾讯开放平台的 App ID，换版本就可能变。':
    'The number in a tencentlaunch[digits]:// is a Tencent open-platform App ID, and a new release can change it.',
  'bundle id 的最后一段，去掉 App/Store/iPhone 这类后缀。这一类猜对过（起点读书就是这么来的），也错过很多次。':
    'The last segment of the bundle id, with a suffix like App/Store/iPhone taken off. This kind of guess has been right before — Qidian came from it — and wrong many times.',
  'bundle id 的最后一段，原样。': 'The last segment of the bundle id, as it stands.',
  'bundle id 倒数第二段——通常是公司或产品名（知乎、豆瓣都对上了）。':
    'The second-to-last segment of the bundle id — usually the company or the product name. It matched for Zhihu and for Douban.',
  '整个 bundle id 当 scheme（百度贴吧就是这么记的）。':
    'The whole bundle id used as the scheme. That is how Baidu Tieba is recorded.',

  // The evidence behind a `verified` row, shown in the picker directly above
  // the caveat — the one line in the payload that is not a transcription but
  // an observation, so it has to survive into English intact. Both rows in the
  // table carry the same sentence, hence one entry.
  '作者的 iPhone 上从呼吸页点「继续」跳转成功':
    'Tapping “Open it anyway” on the breathing page jumped successfully, on the author’s iPhone',
}
