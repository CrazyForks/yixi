[English](README.md) | 简体中文

# 一息

打开小红书之前，先喘一口气。

一个自建的 [One Sec](https://one-sec.app/) 替代品：你在 iPhone 上点开某个干扰类 App，手机先跳到一个网页让你看着圆圈呼吸十秒；十秒后你可以选「继续」进去，也可以选「算了」放下手机。它会把每一次都记下来，过一阵你能看到自己一周被拦了多少次、其中多少次忍住了。

整个东西是**一个 Cloudflare Worker 加一个 D1 数据库**，跑在免费额度里，成本约等于零。

**给谁用**：一个人，或者几个朋友——想要一点摩擦而不是一道墙，并且宁愿自己跑，也不愿意把「几点几分没忍住打开了哪个 App」这种日志交给别人的服务器。它是摩擦，不是强制：自动化随时可以两下关掉，这是刻意的。

```
你点开小红书
   │
   ▼
iOS「打开 App 时」自动化触发
   │
   ▼
快捷指令：GET /gate?app=xhs&k=<token>&fmt=text
   │
   ├── 返回 pass                  → 快捷指令直接结束，你无感进 App
   │                                （没配这个 App／在免打扰窗口里／服务挂了，
   │                                  都是这一支，见下文「坏了就放行」）
   │
   └── 返回 https://…/b?s=…       → 快捷指令打开这个网址
                                     │
                                     ▼
                              Safari 呼吸页，倒计时
                              倒计时期间一个按钮都没有
                                     │
                          ┌──────────┴──────────┐
                          ▼                     ▼
                      「算了」                「继续」
                    先出现，显眼         800ms 后才出，很轻
                          │                     │
                    记一笔，你自己       记一笔，开免打扰窗口，
                    退出这一页           跳回目标 App
                                                │
                                                ▼
                                     跳回去的一瞬间自动化**再次触发**
                                     → 落在免打扰窗口里 → pass
                                     → 记为机器噪音，绝不算成一次冲动
```

最后那个框是这个项目不止五十行代码的全部原因。把控制权交回 App 会再次触发同一条自动化，写得天真一点就是死循环。见下文[免打扰窗口为什么放在服务端](#免打扰窗口为什么放在服务端)。

## 为什么是网页，不是 App

iPhone 上装自制 App，用免费 Apple ID 签名只能撑 7 天，之后每周都要连电脑重签一次。永远如此。

不想重签就得买 Apple Developer，$99/年——对一个全部功能就是「延迟十秒」的工具来说，这笔钱大概率比你想省的那个付费 App 还贵。

所以不做 App。iOS 的「快捷指令」本来就有「打开 App 时」这个触发条件，Safari 本来就能打开网页，网页本来就能靠 URL scheme 把控制权交回 App。零签名成本、永不过期、不需要 Xcode。

代价是动画不如原生顺滑，Safari 冷启动有一点感知延迟。对一个存在意义就是让你慢下来的界面，这个交换可以接受——甚至算个特性。

## 它是什么

一个 Cloudflare Worker 加一个 D1。整个 App 就是一个 `fetch` 处理函数，外加一条每日 cron。

- 页面全部服务端渲染，CSS 和 JS 内联，**零外部请求**——没有 CDN、没有网络字体、连 favicon 都是 `data:`。这一条由 `default-src 'none'` 的 CSP 强制，不只是承诺：打开这些页面的时刻，人正伸手去够一个干扰源，网络还经常不好，多一次阻塞请求这个产品就废了。
- 没有前端框架，没有运行时依赖。`package.json` 里只有五个 devDependencies。
- 拦截记录永不删除。session、登录态、限流窗口每晚清理，`events` 表是这个产品本身，一直留着。
- 账号是邮箱加密码，但密码只是方便。真正的身份是一把 128 位随机的 **gate token**，快捷指令拿它认人。

### 页面

| 地址 | 谁能看 | 干什么 |
| --- | --- | --- |
| `/` | 所有人 | 落地说明，注册／登录入口 |
| `/gate?app=&k=` | gate token | 闸门决策，快捷指令打的就是它，返回 `pass` 或一条网址 |
| `/b?s=<sid>` | sid | 呼吸页 |
| `POST /resolve` | sid | 记 proceed／abandon，开免打扰窗口 |
| `/register` `/login` `/claim` `/recover` | 所有人 | 注册、登录、给老 token 绑账号、用 token 重置密码 |
| `/review` | 本人 | 今天、七天、哪个 App 最消耗你 |
| `/settings` | 本人 | 增删改自己要拦的 App |
| `/lookup` | 本人 | 输入 App 名字，给出带来源的 scheme 候选 |
| `/probe` | 本人 | 在真手机上逐个实测 URL scheme |
| `/setup` | 本人 | 快捷指令配置向导，印着你自己的地址和 token |
| `/account` | 本人 | 看回自己的 gate token、改密码、退出登录 |
| `/mock?v=1\|2` | 所有人 | 两版呼吸页视觉对比 |
| `/admin` | owner | 线下发号，看每个人的 attempt 计数 |

其余一律 404。`/admin` 下面没有别的地址可以猜——见 [SECURITY.md](SECURITY.md)。

## 为什么要部署两次

一份代码，两处 Cloudflare 部署，共用同一个 D1：

| 部署 | 配置 | 作用 |
| --- | --- | --- |
| **Pages** | `pages/wrangler.toml` | 人访问的那个地址 |
| **Worker** | `wrangler.toml` | 只跑每日清理的 cron |

**`*.workers.dev` 在中国大陆被 DNS 污染。**这是实测出来的，不是猜的：`yixi.defiabell.workers.dev` 在国内三家公共 DNS（223.5.5.5 / 119.29.29.29 / 114.114.114.114）各自返回一个互不相同的地址，而且都不等于境外解析值。这是典型的域名级污染，不是 Cloudflare 被封——`cloudflare.com` 和 `*.pages.dev` 在国内外解析逐字节一致。被单独针对的是 `workers.dev` 这个共享后缀。

`*.pages.dev` 目前干净，所以人访问的地址交给 Pages。同一个边缘、同一个运行时、同一份代码、同一个数据库，只有主机名不同。`pages/functions/[[path]].ts` 里只有一行，把请求转进同一个 Worker `fetch` 处理函数。

**Worker 那份必须留着，因为 Pages 不支持 Cron Trigger。**清理任务由 Cloudflare 自己触发，不需要从国内访问，所以它的主机名被污染无所谓。

照抄这个方案之前有两件事要知道：

- Cloudflare 自己的 CLI 明确推荐新项目用 Workers 而不是 Pages。这里反着来，**纯粹是为了那个能访问的域名**。
- **如果你有自己的域名，更好的做法是把它绑到 Worker 上**（Custom Domain）。域名和 cron 两个问题一起消失，`pages/` 整个目录都可以删掉。`pages.dev` 同样是共享后缀，今天干净不代表永远干净——绑自有域名才是真正一劳永逸的解法。

另外：`wrangler pages deploy` 不支持 `-c` 指定配置文件路径，所以 Pages 的配置只能放在自己的目录里，不能和 Worker 共用一份 `wrangler.toml`。

## 自己部署（约 15 分钟）

前置条件：一个 Cloudflare 账号和 Node 18+。

### 1. 安装并登录

```bash
cd yixi
npm install
npx wrangler login
```

### 2. 建 D1 数据库

```bash
npx wrangler d1 create yixi
```

把返回的 `database_id` 填进 **`wrangler.toml` 和 `pages/wrangler.toml` 两处**。两个文件必须指向同一个数据库——这正是两处部署成为同一个 App 的原因。（`database_name` 要保持 `yixi`，否则两个文件加上 `package.json` 里的脚本都得一起改。）

### 3. 生成两个密钥，并自己留一份

```bash
openssl rand -base64 48    # 这是 TOKEN_KEY
openssl rand -base64 48    # 这是 COOKIE_SECRET
```

**不要**直接管道灌进 `wrangler secret put`。同一个 `TOKEN_KEY` 要填进两处部署，而 Cloudflare 的 secret 是读不回来的。

> ### ⚠️ `TOKEN_KEY` 丢了，所有人都再也看不到自己的 gate token
>
> `TOKEN_KEY` 是 gate token 的 AES-GCM 主密钥，作用是让登录后的人能把自己那把 token 读回来。它永不写进 D1——库被单独拖走解不出任何东西。
>
> 丢了它，拦截照常工作：`/gate` 验的是 SHA-256 哈希，从不碰密文。坏掉的是**找回**。忘了 token 的人再也读不回来，也就再也配不了新手机，`/recover`（用 token 重置密码）对他也失效了。没有重置路径，也没法反推。**继续往下之前，先存进密码管理器。**

然后设到 Worker 上：

```bash
npx wrangler secret put TOKEN_KEY        # 粘贴第一个值
npx wrangler secret put COOKIE_SECRET    # 粘贴第二个值
```

`COOKIE_SECRET` 是历史遗留。浏览器会话曾经是签名 cookie，现在改成了 `sessions_web` 表里的行，cookie 只带一个不透明 id，已经没有任何东西需要签名了，代码里也没有一处读它。这里写出来只是因为已有部署都设过它，而删一个 secret 比留着麻烦——全新部署可以不设。

### 4. 建表并部署 Worker

```bash
npm run deploy    # 先对远端 D1 apply migration，再发布
```

migration 只需要跑一次，Pages 那份共用同一个数据库。

### 5. 部署 Pages

```bash
cd pages
npx wrangler pages project create yixi --production-branch main

# TOKEN_KEY 必须和 Worker 那份【逐字节一致】，
# 否则 Pages 打不开 Worker 侧封存的 token，反之亦然。
npx wrangler pages secret put TOKEN_KEY --project-name yixi
npx wrangler pages secret put COOKIE_SECRET --project-name yixi

npx wrangler pages deploy --branch main
```

部署完会给你一个 `https://<项目名>.pages.dev`。注意 `*.pages.dev` 的子域名是**全局唯一**的，名字被占用时 Cloudflare 会自动加后缀，那个带后缀的主机名才是后面到处要用的地址。

### 6. 注册，然后把自己设成 owner

打开 `https://<你的地址>/register`，用邮箱和密码注册。普通使用者到这里就够了，注册是开放的。

owner 是另一回事，而且刻意没有任何界面能授予。想用 `/admin`（线下给人发号），直接改数据库：

```bash
npx wrangler d1 execute yixi --remote --command \
  "UPDATE users SET is_owner = 1 WHERE email = 'you@example.com';"
```

`/admin` 完全是可选的。既然注册已经开放，它剩下的唯一用途是给一个不想注册账号的人递一把 token。

### 7. 配上第一个 App

1. `/settings` —— 加一个 App。**App 键**（比如 `xhs`）就是你之后要在 iOS 自动化里手打的那行文本，必须一字不差。只能用小写字母、数字、`-`、`_`。
2. `/lookup` —— 输入 App 名字，拿到一组 scheme 候选，每条都标着来源。**没有一条是被验证过的。**
3. `/probe` —— 在 iPhone 上打开这一页，挨个点。**只有真的跳进那个 App 的才算数。**
4. `/setup` —— 快捷指令向导，你要粘的每一行都已经填好了真实地址和 token。

## iOS 快捷指令怎么配

**真正配的时候看应用内 `/setup`，不要照抄文档。**那一页知道你的地址、你的 token、你配了哪些 App，印出来的是可以直接长按复制的成品；任何文档只能写 `<你的地址>`、`<你的token>` 让你自己替换，而替换错正是这套配置最常见的失败方式。下面写的是形状，让你知道目标长什么样。

### 一个快捷指令，三个动作，一个变量都不用挑

**① 获取 URL 的内容。**把这一整条粘进 URL 那一栏：

```
https://<你的地址>/gate?app=xhs&k=<你的token>&fmt=text
```

展开「显示更多」，确认方法是 `GET`。请求头和请求体留空。

**② 如果** —— 「URL 的内容」**包含** `https`

**③ 打开 URL** —— 「URL 的内容」，拖到「如果」**里面**。

```
获取 URL 的内容    （粘好的整条网址）        GET
如果   「URL 的内容」   包含   https
    打开 URL   「URL 的内容」
结束如果
```

「如果」和「打开 URL」的左边都会自动接上一步的结果，你从头到尾不用打开变量选择器。起个名字，比如 `一息 小红书`，存好。

这就是 `&fmt=text` 的用途。JSON 模式下同样的逻辑需要「获取词典值」取 `action`、「如果」比较词典值、再「获取词典值」取 `url`——六个动作、三次插变量，而且**「如果」的编辑器并不可靠地把词典值作为可比较对象给出来**，真实用户就卡死在这一步。把解析挪到服务端，六个动作降成三个。

### 然后，一个 App 一条自动化

「快捷指令」App → 底部 **自动化** → 右上角 **+**：

1. 触发条件选 **App**，点进去勾选**要拦的那一个**。
2. 选 **已打开**（不是「已关闭」）。
3. 让你选运行什么时，直接选刚建的那个快捷指令。不用加动作，不用传输入。
4. **关掉「运行前询问」。**
5. 「运行时通知我」也关掉，不然每次开 App 都弹横幅。

再加一个 App：长按那个快捷指令 → 拷贝，把网址里 `app=` 后面那一个词换掉，改个名字，再照上面建一条自动化。`/setup` 会为你配过的每个 App 印出可以直接粘的整行。

### 为什么条件是「包含 `https`」这么怪的写法——以及为什么绝对不能写反

这一条同时干两件事：该拦时打开呼吸页；以及——**任何异常都自动放行**。

`/gate` 有很多种给不出正常答复的理由：token 被换了、Worker 挂了、网络超时、返回一片空白、DNS 被污染。**这些回答里没有一个含有 `https`**，所以「如果」不成立，快捷指令什么都不做，你的 App 正常打开。最坏的结果是「今天没拦住你」。

反过来写成「**不包含 `pass` 就打开**」的话，服务一挂，每次开 App 都会跳去一个打不开的网页。你会被自己写的工具**锁在自己的手机外面**，而且当时多半正急着用。

这两种坏法完全不对等：一边少拦一次，一边几个 App 全废。所以默认行为必须是**拿不准就放行**。

同理还有两条：

- **不要给「获取 URL 的内容」加出错处理。**网络失败时 iOS 会让整条快捷指令中止，中止意味着后面的「打开 URL」根本不会执行，App 照常打开——这正是要的。
- **不要在「如果」后面加「否则」去打开任何东西。**「否则」就是「服务没说要拦」，那就该什么都不做。

## 免打扰窗口为什么放在服务端

点「继续」会把控制权交给 App 的 URL scheme——而这会再次触发同一条「打开 App 时」自动化。原生 One Sec 在自己进程内绕开了这一点，它可以无手势直接跳走；Safari 不行，它只在真实点击的**同步调用栈**内才肯跳自定义 scheme。

所以状态必须放在网页之外。`/resolve` 写一行 **grace**（`user_id`、`app`、`until`），下一次 `/gate` 落在这个窗口里就回 `pass`。用户零多余点击，循环干净解决。

后半件事同样重要。那次回弹是机器噪音，不是冲动，所以它被记成 **`grace_pass`**，绝不记成 `attempt`。`/review` 上每一个比率的分母都只用 `attempt`。把噪音算进去，每次点「继续」都会给自己刷一笔假的冲动记录，放弃率彻底失真。

默认窗口 **90 秒**，可以按 App 单独调（下限 30，上限 3600）。够覆盖跳转、App 冷启动和误触，又短到「放下手机一分半后再拿起来会被重新拦」——这正是想要的行为。

## 已知的限制

部署之前先读完。有几条在代码层面消不掉。

- **iOS 的「打开 App 时」自动化必须一个 App 建一条。**它只接受一个 App，不能批量、不能多选。拦 5 个 App 就要手动建 5 条。One Sec 和所有同类工具都这样，服务端绕不过去。
- **有些 App 已经彻底移除了自己的 URL scheme。**`/probe` 里怎么点都不动，换哪个候选都一样。只能对它放弃拦截，或者接受「点完继续自己再点一次图标」（第二次会落在免打扰窗口里，不会再被拦）。
- **每次开 App 都要等一次网络往返。**没有客户端缓存，没有离线兜底。信号差的时候有感知。慢到不可接受的话，那是要改方案的信号，不是配置问题。
- **`/lookup` 的 App Store 兜底查询从 Cloudflare 边缘调不通。**表里查不到某个 App 时，`/lookup` 会去 `itunes.apple.com` 确认它存在并拿 bundle id。这个调用在 Worker 运行时里失败，本机直连正常。**已知问题，尚未修**。页面会明说「这一步没走通」并且拒绝替你编一个 scheme，所以不会悄悄给出错的东西；主路径不受影响。
- **中国大陆访问要用 Pages 那个地址。**见上文[为什么要部署两次](#为什么要部署两次)。`pages.dev` 是共享后缀，今天干净不代表永远——绑自有域名是唯一持久的解法。
- **界面全是中文。**每一页、每个按钮、每条报错。欢迎 i18n PR。
- **呼吸页放很久之后仍然可以点「继续」。**`/resolve` 刻意不做时效校验：拒绝过期的 resolve 就开不出免打扰窗口，跳回 App 会被立刻再拦，转进死循环。`/b` 确实会拒绝**渲染**超过十分钟的 session，所以这条只对已经加载出来的页面成立。
- **呼吸页需要 JavaScript**（没有时会显示一句 `<noscript>` 提示，让你回主屏幕重新打开）。
- **两版视觉还没定。**`/mock?v=1` 是「墨」（近黑底水墨晕圈加衬线中文），`?v=2` 是「息」（一个细圆环加一个圆点）。`src/ui/layout.ts` 里的 `DEFAULT_THEME` 目前是 `ink`。改这一个常量就换整个产品的脸。
- **它是提醒，不是拦路。**任何人都能两下关掉那条自动化。这是刻意的设计（见上文关于 fail-open 的讨论），也意味着这个工具只对自己想要它的人有效。

## 技术栈

| | |
| --- | --- |
| 运行时 | Cloudflare Workers（同时以 Pages Function 部署一份） |
| 存储 | Cloudflare D1（SQLite） |
| 语言 | TypeScript，strict，零运行时依赖 |
| 渲染 | 服务端 HTML，CSS/JS 内联，零外部请求（CSP 强制） |
| 加密 | 只用 WebCrypto —— PBKDF2-SHA256 密码，AES-GCM 封存 token |
| 客户端 | iOS 快捷指令 + Safari |
| 测试 | 13 个文件 281 条（Vitest + `@cloudflare/vitest-pool-workers`） |
| 成本 | 在 Cloudflare 免费额度内 |

## 目录结构

```
src/index.ts        路由表、三种认证形态、每日 cron
src/gate.ts         /gate 与 /resolve —— 唯一两条机器面对的路由
src/auth.ts         ?k= token、cookie session、常数时间比较
src/account.ts      注册／登录／绑定／找回，闭环找回逻辑
src/crypto.ts       PBKDF2 密码、AES-GCM 封存 token、随机 hex
src/db.ts           全部 D1 语句，只有 D1 语句
src/stats.ts        /review 的聚合层，grace_pass 的排除规则在这里
src/ratelimit.ts    开放端点的每 IP 固定窗口限流
src/scheme.ts       URL scheme 黑名单 —— 一份正本，三处调用
src/schemes.ts      两份公开 scheme 清单的固化快照（60 个 App）
src/types.ts        Env、User、事件类型、共享常量
src/ui/*.ts         一个页面一个模块，全部服务端渲染
src/api/admin.ts    owner 的发号台，以及那条隐私红线
migrations/*.sql    D1 schema，三个 migration
pages/              Pages 入口（一行）加它自己的 wrangler.toml
shortcut/README.md  快捷指令为什么长这样
docs/architecture.md  请求生命周期、表结构、记账语义
```

## 开发

```bash
npm test               # vitest run —— 完整测试套件
npm run typecheck      # tsc --noEmit（src）+ tsc -p test --noEmit
npm run dev            # wrangler dev —— 本地服务器
npm run migrate:local  # 本地库建表
npm run deploy         # 远端 apply migration，然后部署 Worker
```

动手改之前先读 [CONTRIBUTING.md](CONTRIBUTING.md)。它很短，而里面每一条都来自真实踩过的坑。

## 文档

- [SECURITY.md](SECURITY.md) —— 威胁模型、token 双存储的取舍、自托管注意事项
- [CONTRIBUTING.md](CONTRIBUTING.md) —— 五条不能被「顺手清理」掉的约束
- [docs/architecture.md](docs/architecture.md) —— 请求生命周期、D1 表、记账语义
- [shortcut/README.md](shortcut/README.md) —— 快捷指令那套形状背后的推理

作者自己在 `yixi-psh.pages.dev` 上跑了一个实例。那是个人部署，里面是个人记录，不是 demo——请自己部署一份。

## 说人话

给自己做一个「刷手机之前先喘口气」的小工具。你一点小红书，手机先跳到一个网页让你看着圆圈呼吸十秒，十秒后你可以继续进去，也可以放弃。它会偷偷记账，过一阵你能看到自己一周被拦了多少次、其中多少次忍住了。做成网页而不是 App，是因为往 iPhone 上装自制 App 每周都要重装一次，太麻烦，还得花钱。

## License

[MIT](LICENSE)
