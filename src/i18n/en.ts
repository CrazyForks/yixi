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
  怎么配: 'Setup',
  回顾: 'Log',
  设置: 'Settings',
  拦截: 'Intercept',
  导航: 'Navigation',
  账号: 'Account',
  发号: 'Invites',

  // --- /today (src/ui/today.ts) ----------------------------------------------
  '今日 · 一息': 'Today · 一息',
  编辑目标: 'Edit goals',
  '先写一件最重要的事。': 'Write down the one thing that matters most.',
  健身: 'Exercise',
  记下: 'Note it',
  '{title}，今天打卡': '{title}, check in for today',
  '{title}，已打卡，点击取消': '{title}, checked in. Tap to undo.',
  最近七天: 'The last seven days',
  下一步: 'Next',
  '完成：{title}': 'Done: {title}',
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
  '今天的事都做了。': 'Today’s things are done.',
  '其余的事，明天再说。': 'The rest can wait until tomorrow.',
  '<b>添加到主屏幕</b>，以后一按就开。Safari 底部「分享」→「添加到主屏幕」。装好后第一次打开要再登录一次。':
    '<b>Add to Home Screen</b>, and it opens with one tap. In Safari, “Share” at the bottom → “Add to Home Screen”. The first time you open it from the icon you sign in once more.',
  知道了: 'Got it',

  // --- /today/goals (src/ui/goals.ts) ----------------------------------------
  '目标 · 一息': 'Goals · 一息',
  '未来一段时间最重要的几件事。排前面的三个会出现在<a href="/today">今日</a>。':
    'The few things that matter most for a while. The top three show up on <a href="/today">Today</a>.',
  '还没有目标。<br>用上面的 {plus} 加第一个。': 'No goals yet.<br>Use the {plus} above to add the first one.',
  加一个目标: 'Add a goal',
  添加: 'Add',
  '目标 · 一句话': 'Goal · one line',
  '什么时候做 · 可不填': 'When you do it · optional',
  早饭后: 'After breakfast',
  '去做时跳去哪 · 可不填': 'Where the button jumps · optional',
  'bilibili:// 或 https://…': 'bilibili:// or https://…',
  '填<b>具体那一节课、那一本书</b>的链接，比填 App 首页少走两步。自定义 scheme 填完点<b>试跳</b>，App 真打开了才算数；https 链接不用试。':
    'Link <b>the exact lesson, the exact book</b> rather than the app home screen — two steps fewer. After typing a custom scheme, <b>test it</b>: it counts only once the app really opens. An https link needs no test.',
  按钮上叫它什么: 'What the button calls it',
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
  续四周: 'Extend four weeks',

  // Messages the form gives back when something will not save.
  '目标名不能空着。': 'A goal needs a name.',
  '目标名太长了，{n} 个字以内。': 'That name is too long. {n} characters at most.',
  '触发时机太长了，{n} 个字以内。': 'That cue is too long. {n} characters at most.',
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
    'The interception side keeps its record under <a href="/review">Log</a>.',
  '{n} 天 · 打卡 {x} 天': '{n} days · {x} checked',
  '还没有可以回看的。先去<a href="/today">今日</a>记下一件事。':
    'Nothing to look back on yet. Go to <a href="/today">Today</a> and write down one thing.',

  // --- /today/setup (src/ui/todaysetup.ts) -----------------------------------
  '怎么配 · 一息': 'Setup · 一息',
  '让今日页一按就开。<a href="/today">今日</a>是每天要开的那一页，别去找网址，给它一个入口：':
    'Open the Today page with one tap. <a href="/today">Today</a> is the page you open every morning, so rather than hunting for the address, give it a way in:',
  '<b>添加到主屏幕</b>。Safari 打开 <code>{origin}/today</code>，底部「分享」→「添加到主屏幕」。\n    之后点图标就是全屏、没有地址栏。装好后第一次打开要<b>再登录一次</b>——主屏幕里的它和 Safari 不共享登录，登一次管半年。':
    '<b>Add to Home Screen</b>. Open <code>{origin}/today</code> in Safari, then “Share” at the bottom → “Add to Home Screen”. Tapping the icon after that is full screen, with no address bar. The first time you open it you have to <b>sign in once more</b> — the copy on the home screen does not share a login with Safari, and one sign-in lasts half a year.',
  '<b>快捷指令入口</b>。「快捷指令」App 新建一条，只放一个动作「打开 URL」，网址填 <code>{origin}/today</code>。\n    然后三选一：主屏幕长按→小组件→「快捷指令」，把它放上去；iPhone 15 Pro 以上在「设置→操作按钮」里绑它；\n    或「设置→辅助功能→触控→轻点背面」绑它。':
    '<b>A shortcut</b>. In the Shortcuts app, make one with a single action, “Open URL”, pointing at <code>{origin}/today</code>. Then pick one of three: long-press the home screen → Widgets → “Shortcuts” and put it there; on iPhone 15 Pro and later bind it under “Settings → Action Button”; or bind it under “Settings → Accessibility → Touch → Back Tap”.',
  '<b>每天早上自动打开</b>。「快捷指令」→「自动化」→「特定时间」，选每天早上的时刻，运行上面那条，\n    关掉「运行前询问」。这就是提醒，不用推送。':
    '<b>Open it by itself every morning</b>. “Shortcuts” → “Automation” → “Time of Day”, pick a time in the morning, run the shortcut above, and turn off “Ask Before Running”. That is the reminder, with no notification involved.',
  '拦截那边的配置在<a href="/setup">这里</a>。': 'The interception side is set up <a href="/setup">here</a>.',
}
