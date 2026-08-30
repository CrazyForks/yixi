# 一息

打开小红书之前，先喘一口气。

一个自建的 [One Sec](https://one-sec.app/) 替代品：你在 iPhone 上点开某个干扰类 App，手机先跳到一个网页让你看着圆圈呼吸十秒；十秒后你可以选「继续」进去，也可以选「算了」放下手机。它会把每一次都记下来，过一阵你能看到自己一周被拦了多少次、其中多少次忍住了。

整个东西是**一个 Cloudflare Worker 加一个 D1 数据库**，跑在免费额度里，成本约等于零。

---

## 为什么是网页，不是 App

iPhone 上装自制 App，用免费 Apple ID 签名只能撑 7 天，每周都要连电脑重签一次；不想重签就得买 Apple Developer，$99/年，大概率比 One Sec 本身还贵。

所以走网页路线：iOS「快捷指令」的自动化在你打开 App 时触发 → 问服务端该不该拦 → 该拦就跳 Safari 呼吸页 → 结束后用 URL scheme 跳回目标 App。零签名成本、永不过期、不需要 Xcode。

代价是动画不如原生顺滑，Safari 冷启动有一点感知延迟。可以接受。

## 它是怎么转起来的

```
打开小红书 → iOS「打开 App 时」自动化触发
   → 快捷指令 GET /gate?app=xhs&k=<token>
      ├─ {action:"pass"}        → 快捷指令直接结束，你无感进 App
      └─ {action:"block", url}  → 打开那个 url
            → Safari 呼吸页，倒计时
            → 点「算了」→ 记一笔，你自己退出去
            → 点「继续」→ 记一笔，开一个 90 秒的免打扰窗口 → 跳回小红书
```

跳回小红书的那一瞬间，「打开 App 时」自动化会**再次触发**——这是这个方案最容易死掉的地方。解法是把免打扰窗口放在服务端：那次触发会被判定为机器噪音（`grace_pass`），直接放行，而且**不进统计**。否则每次「继续」都会给自己刷一笔假的冲动记录，放弃率会完全失真。

## 部署（约 10 分钟）

需要一个 Cloudflare 账号和 Node 18+。

```bash
cd personal-projects/yixi
npm install
npx wrangler login

# 1. 建 D1 数据库（名字必须和 wrangler.toml 里的 database_name 一致）
npx wrangler d1 create yixi
# 把返回的 database_id 填进 wrangler.toml，替换掉占位的
# database_id = "PLACEHOLDER_RUN_wrangler_d1_create_yixi"

# 2. 建表
npx wrangler d1 migrations apply yixi --remote

# 3. 设 cookie 签名密钥（回顾页登录态用的，随便一串长随机）
openssl rand -hex 32
npx wrangler secret put COOKIE_SECRET

# 4. 部署
npm run deploy
```

部署完拿到 `https://yixi.<你的子域>.workers.dev`。如果还没有 workers.dev 子域，去 Cloudflare 面板 Workers & Pages 开一次（一次性的）。

### 种下第一个 owner

系统里没有注册流程——**token 就是身份**，由 owner 在 `/admin` 手动发。但第一个 owner 得自己塞进去：

```bash
TOKEN=$(openssl rand -hex 16)
HASH=$(printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1)
echo "你的 token（只有这一次机会，现在就存进密码管理器）：$TOKEN"

npx wrangler d1 execute yixi --remote --command \
  "INSERT INTO users (name, token_hash, is_owner, created_at) VALUES ('你的名字', '$HASH', 1, $(($(date +%s) * 1000)));"
```

`token_hash` 的约定是**明文 token 的 UTF-8 字节做 SHA-256，取小写十六进制**，和 `/admin` 发号时用的是同一套（`src/auth.ts` 的 `sha256Hex`）。

然后浏览器打开 `https://<你的地址>/settings?k=<你的token>`。第一次带 `?k=` 访问会种下一个 HttpOnly cookie，之后网址里就不用再带 token 了——回顾页是很私密的东西，token 不该长期躺在浏览器历史和书签里。

## 回来之后要亲自做的三件事

有三件事机器替不了，而且任何一件不成立，方案都得改。

1. **在 iPhone 上逐个实测 URL scheme。** 打开 `/probe`，把你配的每个 App 挨个点一遍，跳得动的才算数。**这个项目里没有任何一个 scheme 是写死的**，网上流传的清单大量过期，凭记忆写死会让你在点了「继续」之后卡在 Safari 里哪也去不了。
2. **在「快捷指令」里为每个要拦的 App 建一条「打开 App 时」自动化。** 步骤见 [`shortcut/README.md`](shortcut/README.md)。iOS 不支持批量，拦几个 App 就得建几条。
3. **在 `/mock` 页对比两版呼吸页视觉，挑一版。** v1「墨」是水墨晕圈加衬线中文，v2「息」是极简细圆环。选完改 `src/ui/layout.ts` 里的 `DEFAULT_THEME`。

第 1 件和第 2 件跑通之后，把实测出来的 scheme 填回 `shortcut/README.md` 末尾那张表——那张表现在是空的，等着你填。

## 页面

| 地址 | 谁能看 | 干什么 |
|---|---|---|
| `/` | 所有人 | 落地说明 |
| `/gate?app=&k=` | token | 闸门决策，快捷指令打的就是它，返回 pass / block |
| `/b?s=<sid>` | sid | 呼吸页 |
| `/review` | 本人 | 回顾：今天、七天、哪个 App 最消耗你 |
| `/settings` | 本人 | 增删改自己要拦的 App |
| `/probe` | 本人 | 逐个实测 URL scheme |
| `/mock?v=1\|2` | 所有人 | 两版呼吸页视觉对比 |
| `/admin` | owner | 发号，看聚合计数 |

## 配置一个要拦的 App

`/settings` 里一条配置有这几项：

| 字段 | 说明 |
|---|---|
| **App 键** | 短键，比如 `xhs`。只能用小写字母、数字、`-`、`_`。**这就是你在 iOS 自动化里手打的那行文本，必须一字不差**，对不上的表现是「自动化跑了但从来没拦过你」 |
| **显示名** | 呼吸页上显示的名字，比如「小红书」 |
| **URL scheme** | 点「继续」时用它跳回 App。**先去 `/probe` 实测再填** |
| **等待** | 呼吸多少秒，默认 10 |
| **免打扰** | 点「继续」之后多久内不再拦你，默认 90 秒。这段时间同时挡掉了「跳回 App 又触发自动化」的死循环 |
| **启用** | 关掉就不拦了，但已有的记录还在 |

90 秒这个默认值是有讲究的：够覆盖跳转和误触，又短到「放下手机一分半后再拿起来会被重新拦」——这正是想要的行为。

## 多用户和隐私

这个 App 没有社交、没有共享、没有协作，一个人的数据和另一个人完全不相干。所以「多用户」就等于**一个 token 一套数据**：不需要注册、密码、邮箱。owner 在 `/admin` 手动建人、生成 token，线下发给对方。

不做公开注册是想清楚的：注册流意味着验证码、滥用防护、隐私条款、成本兜底、客服，而这个 App 没有网络效应，这些换不来什么。

隐私上有三条硬规矩：

- **token 只存 SHA-256，不存明文**，生成时只显示一次。库被拖走也变不回可用的凭据。
- **owner 的 `/admin` 只能看到聚合计数**（某人最近 7 天被拦了几次），**读不到任何人的 events 明细**。这条不是靠自觉：`/admin` 里唯一碰 `events` 表的查询是一个 `GROUP BY` 计数，结果立刻被收窄成 `{id, name, attempts}` 三个字段才交给渲染层，`/admin` 下也只有一个 GET 路由，猜不出别的地址。`test/admin.test.ts` 用真实种下的 events 守着这条线。
  理由很实际：`/review` 是一个人「几点几分没忍住刷了小红书」的完整记录。朋友只要怀疑你能翻他的记录，这个 App 他就不会真用。
- **`/review` 首次带 `?k=` 访问后种 HttpOnly cookie**，之后网址不带 token，减少书签、历史、截图里的泄漏面。

## 开发

```bash
npm run dev            # 本地起 Worker
npm test               # vitest + @cloudflare/vitest-pool-workers
npm run typecheck      # tsc --noEmit（src 和 test 各一遍）
npm run migrate:local  # 本地库建表
```

页面全部服务端渲染，CSS 和 JS 内联，**零外部依赖**——没有 CDN、没有网络字体、连 favicon 都是 `data:`。理由不是洁癖：打开这些页面的时刻，人正伸手去够一个干扰源，网络还经常不好，多一次阻塞请求这个产品就废了。CSP 把这条从承诺变成了强制。

## 已知的限制

- **iOS 的「打开 App 时」自动化必须一个 App 建一条**，无法批量。拦 5 个 App 就要手动建 5 条。这是 iOS 的限制，One Sec 也一样，代码层面消不掉。
- **有些 App 已经彻底移除了自己的 URL scheme**，`/probe` 里怎么点都不动。这种只能对它放弃拦截，或者接受「点完继续自己再手动点一次 App 图标」。
- **每次开 App 都要等一次网络往返**。信号差的时候有感知。
- **没有客户端缓存、没有离线兜底**。Worker 挂了就等于不拦。这个方向的失败是安全的（放你进去），而不是把你锁在门外——但这个性质**不在服务端，在快捷指令里**：那个「如果」必须写成「等于 `block` 才打开 URL」。写成「不等于 `pass` 就打开」的话，服务一挂，你的几个 App 就全废了。理由和写法见 [`shortcut/README.md`](shortcut/README.md) 的「坏掉的时候必须放你进去」。
- **呼吸页放很久之后仍然可以点「继续」**，`/resolve` 故意不做时效校验。拒绝它就开不出免打扰窗口，跳回 App 会被自动化立刻再拦，转进死循环。只有页面被刷新、需要重新渲染时才会认过期。

## 说人话

给自己做一个「刷手机之前先喘口气」的小工具。你一点小红书，手机先跳到一个网页让你看着圆圈呼吸十秒，十秒后你可以继续进去，也可以放弃。它会偷偷记账，过一阵你能看到自己一周被拦了多少次、其中多少次忍住了。做成网页而不是 App，是因为往 iPhone 上装自制 App 每周都要重装一次，太麻烦，还得花钱。
