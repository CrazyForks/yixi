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
  下一步: 'Next',
  '完成：{title}': 'Mark done: {title}',
  撤销: 'Undo',
  '还有 {n} 条，去<a href="/today/goals#goal-{id}">目标</a>里看。':
    '{n} more — see them under <a href="/today/goals#goal-{id}">Goals</a>.',
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
  '未来一段时间最重要的几件事。排前面的三个会出现在<a href="/today">今日</a>。':
    'The few things that matter most in the weeks ahead. The top three show up on <a href="/today">Today</a>.',
  '还没有目标。<br>用上面的 {plus} 加第一个。': 'No goals yet.<br>Use the {plus} above to add the first one.',
  加一个目标: 'Add a goal',
  添加: 'Add',
  '目标 · 一句话': 'Goal · one line',
  '什么时候做 · 可不填': 'When you do it · optional',
  早饭后: 'After breakfast',
  '去做时跳去哪 · 可不填': 'Where the button jumps · optional',
  'bilibili:// 或 https://…': 'instagram:// or https://…',
  '填<b>具体那一节课、那一本书</b>的链接，比填 App 首页少走两步。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。':
    'Link <b>the exact lesson, the exact book</b> rather than the app home screen — two steps fewer. After typing a custom scheme, <b>test it</b>: it counts only once the app really opens. An https link needs no test.',
  按钮上叫它什么: 'What the button calls it',
  // An example inside a placeholder, not a translation: 「B 站」 here is the
  // sample answer to 「按钮上叫它什么」, so English offers an app an English
  // reader would name. A label a user actually typed is data — it is escaped
  // and interpolated, never passed through `t()`, so 「Open B 站」 stays 「Open
  // B 站」 in both languages.
  'B 站': 'Reddit',
  '做到哪天 · 可不填': 'Until · optional',
  长期: 'Ongoing',
  保存: 'Save',
  上移: 'Up',
  下移: 'Down',
  归档: 'Archive',
  '子任务 · 一次性的待办': 'Sub-tasks · one-off to-dos',
  '还没有。': 'None yet.',
  删: 'Delete',
  加一条子任务: 'Add a sub-task',
  子任务: 'Sub-task',
  加: 'Add',
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
  '{days} 天里有记录的 {n} 天，做完全部的 {full} 天。':
    'Of {days} days, {n} have a record and {full} were done in full.',
  每个目标: 'Each goal',
  '没有正在进行的目标。': 'No goals running right now.',
  这周: 'This week',
  '划掉了 <b class="num">{n}</b> 条子任务。': 'Crossed off <b class="num">{n}</b> sub-tasks.',
  '拦截那边的记录在<a href="/review">回顾</a>。':
    'Breathe keeps its own record under <a href="/review">Log</a>.',
  '{n} 天 · 打卡 {x} 天': '{n} days · {x} checked',
  '还没有可以回看的。先去<a href="/today">今日</a>记下一件事。':
    'Nothing to look back on yet. Go to <a href="/today">Today</a> and write down one thing.',

  // --- /today/setup (src/ui/todaysetup.ts) -----------------------------------
  '怎么配 · 一息': 'Guide · 一息',
  '让今日页一按就开。<a href="/today">今日</a>是每天要开的那一页，别去找网址，给它一个入口：':
    'Open the Today page with one tap. <a href="/today">Today</a> is the page you open every morning, so rather than hunting for the address, give it a way in:',
  '<b>添加到主屏幕</b>。Safari 打开 <code>{origin}/today</code>，底部「分享」→「添加到主屏幕」。\n    之后点图标就是全屏、没有地址栏。装好后第一次打开要<b>再登录一次</b>——主屏幕里的它和 Safari 不共享登录，登一次管半年。':
    '<b>Add to Home Screen</b>. Open <code>{origin}/today</code> in Safari, then “Share” at the bottom → “Add to Home Screen”. Tapping the icon after that is full screen, with no address bar. The first time you open it you will have to <b>sign in once more</b> — the copy on the home screen does not share a login with Safari, and one sign-in lasts half a year.',
  '<b>快捷指令入口</b>。「快捷指令」App 新建一条，只放一个动作「打开 URL」，网址填 <code>{origin}/today</code>。\n    然后三选一：主屏幕长按→小组件→「快捷指令」，把它放上去；iPhone 15 Pro 以上在「设置→操作按钮」里绑它；\n    或「设置→辅助功能→触控→轻点背面」绑它。':
    '<b>A shortcut</b>. In the Shortcuts app, make one with a single action, “Open URL”, pointing at <code>{origin}/today</code>. Then pick one of three: long-press the home screen → Widgets → “Shortcuts” and put it there; on iPhone 15 Pro and later bind it under “Settings → Action Button”; or bind it under “Settings → Accessibility → Touch → Back Tap”.',
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
}
