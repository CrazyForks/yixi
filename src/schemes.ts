/**
 * A frozen snapshot of two public URL-scheme collections, plus the rules for
 * guessing when neither of them has heard of an app.
 *
 * Why this file exists at all: 「试跳」 can tell you whether a scheme works, but
 * it cannot tell you what to type into it, and the honest answer to "what is
 * 起点读书's scheme" is that nobody on the server knows. Twice already this
 * project has had an unverified string read as an answer — the `someapp://`
 * placeholder in a form, and a made-up address in a diagram that got copied.
 * So every line below carries where it came from and how much it is worth, and
 * the word 'verified' is reserved for something no server-side table can ever
 * earn.
 *
 * Three tiers, and the gap between them is the whole point:
 *
 *   verified — a scheme that made a real iPhone jump. Nothing in this file is
 *              ever this tier; only the phone in the reader's hand can promote
 *              a candidate, by jumping from /settings. The tier exists in the type
 *              so the UI has a name for the thing these candidates are not.
 *   listed   — copied out of a public collection. Traceable, and stale the
 *              moment an app ships a change nobody logged.
 *   derived  — pattern-matched off a bundle id. A guess, labelled as one.
 *
 * The data is compiled in rather than fetched: these pages open in the moment
 * somebody is reaching for a distraction, and layout.ts forbids a single
 * external request. A build-time copy costs nothing at runtime.
 */

import { msg } from './i18n'
import { safeScheme } from './scheme'

/** When the two collections below were read. They are not watched for changes. */
export const SNAPSHOT_DATE = '2026-08-31'

export type Confidence = 'verified' | 'listed' | 'derived'

export interface SchemeSource {
  /** Short name shown beside the candidate. */
  label: string
  url: string
}

export interface Candidate {
  scheme: string
  confidence: Confidence
  /**
   * Where the string was copied from. A `derived` candidate has none, and that
   * emptiness is the signal — there is nothing to point at because nobody
   * recorded it, it was guessed here.
   */
  sources: SchemeSource[]
  /**
   * A reason to distrust this particular line, rendered verbatim to the user.
   *
   * The only field on this type that is *copy* rather than data, and so the
   * only one wrapped in `msg()`: `name`, `aliases` and `category` are what the
   * two collections call these apps and what a search has to match against, and
   * translating them would break the lookup while telling the reader nothing.
   * A caveat is a sentence written for whoever is deciding whether to trust a
   * guess, and it reaches them through `/api/candidates`, which resolves it
   * against the request's language before answering.
   */
  caveat?: string
  /** ISO date the jump was observed on a real device. Only for `verified`. */
  verifiedOn?: string
  /** What was observed, and on what — so a reader can judge how far it carries. */
  verifiedNote?: string
}

export type Category = '社交' | '短视频' | '影音' | '小说阅读' | '购物' | '资讯' | '音乐' | '游戏' | '其他'

export interface AppEntry {
  /** The name as the collections spell it. */
  name: string
  /**
   * Suggested app key — the short lowercase text that has to be retyped inside
   * an iOS automation. Same charset /settings enforces, so a row written from
   * here is indistinguishable from one typed by hand.
   */
  key: string
  /** Other spellings, for matching only. Never rendered as the app's name. */
  aliases: string[]
  bundleId?: string
  category: Category
  /** Best-supported first: agreed by both collections, then single-source. */
  candidates: Candidate[]
}

// --- the two sources -------------------------------------------------------

const APP_INFO: SchemeSource = {
  label: 'iOS-app-info',
  url: 'https://github.com/WengYuehTing/iOS-app-info',
}

const URL_SCHEME: SchemeSource = {
  label: 'iOS-URL-Scheme',
  url: 'https://github.com/lu2412/iOS-URL-Scheme',
}

function fromAppInfo(scheme: string, caveat?: string): Candidate {
  return { scheme, confidence: 'listed', sources: [APP_INFO], caveat }
}

function fromUrlScheme(scheme: string, caveat?: string): Candidate {
  return { scheme, confidence: 'listed', sources: [URL_SCHEME], caveat }
}

/**
 * Both collections record the same string. Worth showing first — two
 * independent transcriptions agreeing rules out one of them mistyping it — but
 * it is still not evidence the app answers to it today.
 */
function fromBoth(scheme: string, caveat?: string): Candidate {
  return { scheme, confidence: 'listed', sources: [APP_INFO, URL_SCHEME], caveat }
}

/**
 * Someone pressed 「继续」 on a real iPhone and the app opened.
 *
 * This is the only tier that is evidence rather than transcription, and the
 * only way to earn it is a device. `date` and `note` are required so a reader
 * can weigh it: one phone on one iOS version is not a guarantee for every
 * phone, and a scheme that worked in 2026 can be removed in the next release.
 * A tier that cannot say when and on what would just be a louder `listed`.
 */
function verified(scheme: string, date: string, note: string, sources: SchemeSource[]): Candidate {
  return { scheme, confidence: 'verified', sources, verifiedOn: date, verifiedNote: note }
}

/** Whether a candidate is backed by more than one independent transcription. */
export function isCorroborated(c: Candidate): boolean {
  return c.sources.length > 1
}

// --- the table -------------------------------------------------------------

/**
 * Chinese apps people actually lose evenings to. Deliberately not the whole of
 * either collection: a list of 200 rows including 美团骑手 and six banks is
 * harder to search than a short one, and every extra row is another string
 * nobody here has tested.
 *
 * Bundle ids come from iOS-app-info; iOS-URL-Scheme records no bundle ids, so
 * rows sourced only from it have none. A missing bundle id costs nothing except
 * that the picker cannot offer derived fallbacks for that row.
 */
export const APPS: AppEntry[] = [
  // --- 短视频 --------------------------------------------------------------
  {
    name: '抖音',
    key: 'dy',
    aliases: ['douyin', 'dy', '抖音短视频'],
    bundleId: 'com.ss.iphone.ugc.Aweme',
    category: '短视频',
    candidates: [
      fromBoth('snssdk1128://'),
      fromUrlScheme(
        'wb1462309810://',
        msg('iOS-URL-Scheme 把这一条同时记给了「火山小视频」。两个 App 不可能共用一个 scheme，所以至少有一条是抄错的。'),
      ),
    ],
  },
  {
    name: '抖音极速版',
    key: 'dylite',
    aliases: ['douyin lite', '抖音极速'],
    bundleId: 'com.ss.iphone.ugc.aweme.lite',
    category: '短视频',
    candidates: [fromAppInfo('snssdk2329://')],
  },
  {
    name: '快手',
    key: 'ks',
    aliases: ['kuaishou', 'ks'],
    bundleId: 'com.jiangjia.gif',
    category: '短视频',
    candidates: [
      fromAppInfo('kwai://'),
      fromUrlScheme(
        'gifshow://',
        msg('两份清单在这个 App 上不一致，一份记 kwai、一份记 gifshow。只能两个都试。'),
      ),
    ],
  },
  {
    name: '快手极速版',
    key: 'kslite',
    aliases: ['kuaishou lite', '快手极速'],
    bundleId: 'com.kuaishou.nebula',
    category: '短视频',
    candidates: [fromAppInfo('ksnebula://')],
  },
  {
    name: '西瓜视频',
    key: 'xigua',
    aliases: ['xigua', '西瓜'],
    bundleId: 'com.ss.iphone.article.Video',
    category: '短视频',
    candidates: [fromAppInfo('snssdk32://')],
  },
  {
    name: '皮皮虾',
    key: 'pipixia',
    aliases: ['pipixia', '皮皮'],
    bundleId: 'com.bd.iphone.super',
    category: '短视频',
    candidates: [fromAppInfo('bds://')],
  },
  {
    name: '微视',
    key: 'weishi',
    aliases: ['weishi'],
    bundleId: 'com.tencent.microvision',
    category: '短视频',
    candidates: [fromAppInfo('weishi://')],
  },

  // --- 社交 ----------------------------------------------------------------
  {
    name: '小红书',
    key: 'xhs',
    aliases: ['xhs', 'xiaohongshu', 'rednote', '红书', '小红薯'],
    bundleId: 'com.xingin.discover',
    category: '社交',
    // Promoted out of `listed` on 2026-08-31: the author tapped 「继续」 on the
    // breathing page and 小红书 opened. Before that it had only ever been
    // agreement between this project's own docs and iOS-app-info — which is
    // agreement between two transcriptions, not a phone answering.
    candidates: [
      verified('xhsdiscover://', '2026-08-31', '作者的 iPhone 上从呼吸页点「继续」跳转成功', [APP_INFO]),
    ],
  },
  {
    name: '微信',
    key: 'wx',
    aliases: ['wechat', 'weixin', 'wx'],
    bundleId: 'com.tencent.xin',
    category: '社交',
    candidates: [fromAppInfo('weixin://')],
  },
  {
    name: 'QQ',
    key: 'qq',
    aliases: ['qq', 'tencent qq'],
    bundleId: 'com.tencent.mqq',
    category: '社交',
    candidates: [fromBoth('mqq://')],
  },
  {
    name: '微博',
    key: 'weibo',
    aliases: ['weibo', '新浪微博', 'sinaweibo'],
    bundleId: 'com.sina.weibo',
    category: '社交',
    candidates: [fromBoth('sinaweibo://')],
  },
  {
    name: '微博国际版',
    key: 'weibointl',
    aliases: ['weibo intl', '微博国际', 'weibointernational'],
    bundleId: 'com.weibo.international',
    category: '社交',
    candidates: [
      fromAppInfo(
        'weibointernational://',
        msg('iOS-URL-Scheme 把同一个 scheme 记在「微博轻享版」名下。两个名字指的可能是同一个 App，也可能不是。'),
      ),
    ],
  },
  {
    name: '知乎',
    key: 'zhihu',
    aliases: ['zhihu', 'zh'],
    bundleId: 'com.zhihu.ios',
    category: '社交',
    candidates: [fromAppInfo('zhihu://')],
  },
  {
    name: '豆瓣',
    key: 'douban',
    aliases: ['douban'],
    bundleId: 'com.douban.frodo',
    category: '社交',
    candidates: [fromAppInfo('douban://')],
  },
  {
    name: '百度贴吧',
    key: 'tieba',
    aliases: ['tieba', '贴吧', 'baidutieba'],
    bundleId: 'com.baidu.tieba',
    category: '社交',
    candidates: [
      fromAppInfo(
        'com.baidu.tieba://',
        msg('这一条就是 bundle id 本身当 scheme 用，看着不像但清单确实这么记。'),
      ),
    ],
  },
  {
    name: '陌陌',
    key: 'momo',
    aliases: ['momo'],
    bundleId: 'com.wemomo.momoappdemo1',
    category: '社交',
    candidates: [fromBoth('momochat://')],
  },
  {
    name: '探探',
    key: 'tantan',
    aliases: ['tantan'],
    category: '社交',
    candidates: [fromUrlScheme('tantanapp://')],
  },
  {
    name: '绿洲',
    key: 'oasis',
    aliases: ['oasis', 'lvzhou'],
    bundleId: 'com.sina.oasis',
    category: '社交',
    candidates: [fromAppInfo('oasis://')],
  },
  {
    name: '酷安',
    key: 'coolapk',
    aliases: ['coolapk', 'kuan'],
    category: '社交',
    candidates: [
      fromUrlScheme(
        'tencent100336226://',
        msg('这种 tencent<数字>:// 的形状是腾讯开放平台分配的 App ID，很容易随版本换掉。'),
      ),
    ],
  },

  // --- 影音 ----------------------------------------------------------------
  {
    name: '哔哩哔哩',
    key: 'bili',
    aliases: ['bilibili', 'b站', 'bzhan', '哔哩', 'b 站'],
    bundleId: 'tv.danmaku.bilianime',
    category: '影音',
    candidates: [fromBoth('bilibili://')],
  },
  {
    name: '腾讯视频',
    key: 'tenvideo',
    aliases: ['tencent video', '腾讯'],
    bundleId: 'com.tencent.live4iphone',
    category: '影音',
    candidates: [fromBoth('tenvideo://')],
  },
  {
    name: '爱奇艺',
    key: 'iqiyi',
    aliases: ['iqiyi', 'aiqiyi', '爱奇艺视频'],
    bundleId: 'com.qiyi.iphone',
    category: '影音',
    candidates: [
      fromAppInfo('iqiyi://'),
      fromUrlScheme(
        'qiyi-iphone://',
        msg('两份清单不一致。qiyi-iphone:// 看着像更老的那一版，但没人验证过。'),
      ),
    ],
  },
  {
    name: '优酷',
    key: 'youku',
    aliases: ['youku', '优酷视频'],
    bundleId: 'com.youku.YouKu',
    category: '影音',
    candidates: [fromBoth('youku://')],
  },
  {
    name: '芒果TV',
    key: 'mgtv',
    aliases: ['mgtv', 'mangguo', '芒果'],
    bundleId: 'com.hunantv.imgotv',
    category: '影音',
    candidates: [fromAppInfo('imgotv://')],
  },
  {
    name: '搜狐视频',
    key: 'sohuvideo',
    aliases: ['sohu video', '搜狐'],
    bundleId: 'com.sohu.iPhoneVideo',
    category: '影音',
    candidates: [
      fromAppInfo('sohuvideo://'),
      fromUrlScheme('sohuvideo-iphone://', msg('两份清单不一致，差一个 -iphone 后缀。')),
    ],
  },
  {
    name: '斗鱼',
    key: 'douyu',
    aliases: ['douyu', '斗鱼直播'],
    bundleId: 'tv.douyu.live',
    category: '影音',
    candidates: [fromAppInfo('douyutv://')],
  },
  {
    name: '虎牙',
    key: 'huya',
    aliases: ['huya', '虎牙直播'],
    bundleId: 'com.yy.kiwi',
    category: '影音',
    candidates: [fromAppInfo('yykiwi://')],
  },

  // --- 小说阅读 ------------------------------------------------------------
  {
    name: '起点读书',
    key: 'qidian',
    aliases: ['qidian', '起点', 'qd', '起点中文网'],
    bundleId: 'm.qidian.QDReaderAppStore',
    category: '小说阅读',
    // Promoted out of `listed` on 2026-08-31 on the same device as xhs. Before
    // that: iOS-app-info recorded QDReader:// against exactly this bundle id and
    // the bundle's own last segment reduced to the same string — two independent
    // hints, still nobody's phone.
    candidates: [
      verified('QDReader://', '2026-08-31', '作者的 iPhone 上从呼吸页点「继续」跳转成功', [APP_INFO]),
    ],
  },
  {
    name: '番茄小说',
    key: 'fanqie',
    aliases: ['fanqie', '番茄', '番茄免费小说'],
    bundleId: 'com.dragon.read',
    category: '小说阅读',
    candidates: [fromAppInfo('dragon1967://')],
  },
  {
    name: '七猫免费小说',
    key: 'qimao',
    aliases: ['qimao', '七猫'],
    category: '小说阅读',
    candidates: [fromUrlScheme('freereader://')],
  },
  {
    name: '书旗小说',
    key: 'shuqi',
    aliases: ['shuqi', '书旗'],
    bundleId: 'com.shuqicenter.reader',
    category: '小说阅读',
    candidates: [
      fromAppInfo('shuqireaderap://', msg('结尾的 ap 看着像 app 被截断了，但清单就是这么记的。')),
    ],
  },
  {
    name: '微信读书',
    key: 'weread',
    aliases: ['weread', '微读'],
    bundleId: 'com.tencent.weread',
    category: '小说阅读',
    candidates: [fromBoth('weread://')],
  },
  {
    name: 'QQ阅读',
    key: 'qqreader',
    aliases: ['qqreader', 'qq 阅读'],
    bundleId: 'com.tencent.qqreaderiphone',
    category: '小说阅读',
    candidates: [fromAppInfo('qqreader://')],
  },
  {
    name: '掌阅',
    key: 'ireader',
    aliases: ['ireader', 'zhangyue', '掌阅ireader'],
    category: '小说阅读',
    candidates: [fromUrlScheme('iReader://')],
  },
  {
    name: '喜马拉雅',
    key: 'ximalaya',
    aliases: ['ximalaya', 'xmly', '喜马'],
    bundleId: 'com.gemd.iting',
    category: '小说阅读',
    candidates: [fromAppInfo('iting://')],
  },
  {
    name: '得到',
    key: 'dedao',
    aliases: ['dedao', '罗辑思维'],
    bundleId: 'com.luojilab.LuoJiFM-IOS',
    category: '小说阅读',
    candidates: [fromAppInfo('dedaoapp://')],
  },

  // --- 购物 ----------------------------------------------------------------
  {
    name: '淘宝',
    key: 'taobao',
    aliases: ['taobao', 'tb'],
    bundleId: 'com.taobao.taobao4iphone',
    category: '购物',
    candidates: [fromBoth('taobao://')],
  },
  {
    name: '拼多多',
    key: 'pdd',
    aliases: ['pinduoduo', 'pdd'],
    bundleId: 'com.xunmeng.pinduoduo',
    category: '购物',
    candidates: [fromBoth('pinduoduo://')],
  },
  {
    name: '京东',
    key: 'jd',
    aliases: ['jingdong', 'jd'],
    bundleId: 'com.360buy.jdmobile',
    category: '购物',
    candidates: [
      fromBoth(
        'openapp.jdmoble://',
        msg('两份清单都把 moble 写成了这样（不是 mobile）。可能是京东自己拼错的，也可能是一份抄错了另一份跟着传。照抄试一次就知道。'),
      ),
    ],
  },
  {
    name: '天猫',
    key: 'tmall',
    aliases: ['tmall'],
    bundleId: 'com.taobao.tmall',
    category: '购物',
    candidates: [fromBoth('tmall://')],
  },
  {
    name: '闲鱼',
    key: 'xianyu',
    aliases: ['xianyu', '咸鱼', 'fleamarket'],
    bundleId: 'com.taobao.fleamarket',
    category: '购物',
    candidates: [fromAppInfo('fleamarket://')],
  },
  {
    name: '唯品会',
    key: 'vip',
    aliases: ['vipshop', 'wph'],
    bundleId: 'com.vipshop.iphone',
    category: '购物',
    candidates: [fromBoth('vipshop://')],
  },
  {
    name: '得物',
    key: 'dewu',
    aliases: ['dewu', 'poizon', '毒'],
    bundleId: 'com.siwuai.duapp',
    category: '购物',
    candidates: [fromAppInfo('dewuapp://')],
  },
  {
    name: '什么值得买',
    key: 'smzdm',
    aliases: ['smzdm', '值得买'],
    bundleId: 'com.smzdm.client.ios',
    category: '购物',
    candidates: [fromAppInfo('smzdm://')],
  },
  {
    name: '转转',
    key: 'zhuanzhuan',
    aliases: ['zhuanzhuan'],
    bundleId: 'com.wuba.zhuanzhuan',
    category: '购物',
    candidates: [fromAppInfo('zhuanzhuan://')],
  },
  {
    name: '苏宁易购',
    key: 'suning',
    aliases: ['suning', '苏宁'],
    bundleId: 'SuningEMall',
    category: '购物',
    candidates: [fromAppInfo('suning://')],
  },
  {
    name: '美团',
    key: 'meituan',
    aliases: ['meituan', 'mt'],
    bundleId: 'com.meituan.imeituan',
    category: '购物',
    candidates: [fromBoth('imeituan://')],
  },
  {
    name: '大众点评',
    key: 'dianping',
    aliases: ['dianping', 'dzdp'],
    bundleId: 'com.dianping.dpscope',
    category: '购物',
    candidates: [fromBoth('dianping://')],
  },
  {
    name: '饿了么',
    key: 'eleme',
    aliases: ['eleme', '饿了吗', '饿了'],
    bundleId: 'me.ele.ios.eleme',
    category: '购物',
    candidates: [fromAppInfo('eleme://')],
  },

  // --- 资讯 ----------------------------------------------------------------
  {
    name: '今日头条',
    key: 'toutiao',
    aliases: ['toutiao', '头条'],
    bundleId: 'com.ss.iphone.article.News',
    category: '资讯',
    candidates: [fromBoth('snssdk141://')],
  },
  {
    name: '腾讯新闻',
    key: 'qqnews',
    aliases: ['tencent news'],
    bundleId: 'com.tencent.info',
    category: '资讯',
    candidates: [fromBoth('qqnews://')],
  },
  {
    name: '网易新闻',
    key: 'wynews',
    aliases: ['netease news', '网易'],
    bundleId: 'com.netease.news',
    category: '资讯',
    candidates: [fromBoth('newsapp://')],
  },
  {
    name: '搜狐新闻',
    key: 'sohunews',
    aliases: ['sohu news'],
    bundleId: 'com.sohu.newspaper',
    category: '资讯',
    candidates: [fromAppInfo('sohunews://')],
  },
  {
    name: 'UC浏览器',
    key: 'uc',
    aliases: ['uc', 'ucbrowser', 'uc 浏览器'],
    bundleId: 'com.ucweb.iphone.lowversion',
    category: '资讯',
    candidates: [fromBoth('ucbrowser://')],
  },

  // --- 音乐 ----------------------------------------------------------------
  {
    name: '网易云音乐',
    key: 'wyy',
    aliases: ['netease music', '网易云', 'ncm', 'wangyiyun'],
    bundleId: 'com.netease.cloudmusic',
    category: '音乐',
    candidates: [fromBoth('orpheus://')],
  },
  {
    name: 'QQ音乐',
    key: 'qqmusic',
    aliases: ['qq music'],
    bundleId: 'com.tencent.QQMusic',
    category: '音乐',
    candidates: [fromBoth('qqmusic://')],
  },
  {
    name: '酷狗音乐',
    key: 'kugou',
    aliases: ['kugou', '酷狗'],
    bundleId: 'com.kugou.kugou1002',
    category: '音乐',
    candidates: [fromBoth('kugouURL://')],
  },
  {
    name: '全民K歌',
    key: 'kege',
    aliases: ['quanmin k', 'kge', '全民k歌'],
    bundleId: 'com.tencent.QQKSong',
    category: '音乐',
    candidates: [fromAppInfo('qmkege://')],
  },

  // --- 游戏 ----------------------------------------------------------------
  {
    name: '王者荣耀',
    key: 'wzry',
    aliases: ['wzry', 'wangzherongyao', '王者'],
    category: '游戏',
    candidates: [
      fromUrlScheme(
        'tencentlaunch1104466820://',
        msg('tencentlaunch<数字>:// 里的数字是腾讯开放平台的 App ID，换版本就可能变。'),
      ),
    ],
  },
  {
    name: '原神',
    key: 'ys',
    aliases: ['genshin', 'yuanshen', '原神启动'],
    category: '游戏',
    candidates: [fromUrlScheme('yuanshengame://')],
  },
]

// --- fuzzy match -----------------------------------------------------------

/**
 * Folds away everything people vary when typing an app name: case, spaces,
 * full-width spaces, interpuncts, hyphens, underscores. Applied to both sides
 * of every comparison, so 「b 站」 and 'B站' are the same query.
 */
function fold(s: string): string {
  return s.toLowerCase().replace(/[\s　·・.\-_]/g, '')
}

/**
 * Ranked matches for a typed name. Ordered so an exact name beats a prefix
 * beats a substring, because a search for 「抖音」 that led with 抖音极速版 would
 * be read as the page not understanding the question.
 *
 * Bundle ids and the candidate schemes themselves are searched too, but only
 * for queries of three characters or more: they are long haystacks, and a
 * one-letter query against them matches almost everything.
 */
export function findApps(query: string, limit = 8): AppEntry[] {
  const q = fold(query)
  if (q === '') return []

  const wide = q.length >= 3
  const scored: { entry: AppEntry; score: number; order: number }[] = []

  APPS.forEach((entry, order) => {
    let best = 0
    const consider = (hay: string, weight: number): void => {
      const h = fold(hay)
      if (h === '') return
      let s = 0
      if (h === q) s = 100
      else if (h.startsWith(q)) s = 60
      else if (h.includes(q)) s = 40
      else if (h.length >= 2 && q.includes(h)) s = 25
      if (s > 0) best = Math.max(best, s + weight)
    }

    consider(entry.name, 4)
    consider(entry.key, 2)
    for (const a of entry.aliases) consider(a, 0)
    if (wide) {
      if (entry.bundleId !== undefined) consider(entry.bundleId, -10)
      for (const c of entry.candidates) consider(c.scheme.replace(/:\/*$/, ''), -12)
    }

    if (best > 0) scored.push({ entry, score: best, order })
  })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return scored.slice(0, limit).map((s) => s.entry)
}

// --- reverse lookup: scheme -> app -----------------------------------------

/**
 * The protocol part of a scheme, lowercased: `QDReader://` and `qdreader:`
 * both reduce to `qdreader`.
 *
 * Matching on the protocol rather than on the whole stored string is what makes
 * this survive the shapes that are actually in `user_apps`. RFC 3986 makes the
 * scheme case-insensitive, and a row inserted by hand (as the README's
 * bootstrap does) may carry the `//` or not.
 */
function protocolOf(scheme: string): string {
  const s = scheme.trim()
  const colon = s.indexOf(':')
  return (colon === -1 ? s : s.slice(0, colon)).toLowerCase()
}

/**
 * Every scheme in the table, pointing back at the row that claims it. Built
 * once at module load, same as the table itself is compiled in.
 *
 * First writer wins. That matches the table's own ordering rule — candidates
 * are listed best-supported first — so a row that offers two spellings resolves
 * to the same app either way. Nothing in the snapshot collides today, and
 * test/candidates.test.ts is where a collision introduced by a later snapshot
 * gets caught. Deliberately not a throw: a duplicate is a data typo, and a typo
 * in a table must not take the Worker down on boot.
 */
const BY_PROTOCOL = new Map<string, AppEntry>()
for (const entry of APPS) {
  for (const c of entry.candidates) {
    const p = protocolOf(c.scheme)
    if (p !== '' && !BY_PROTOCOL.has(p)) BY_PROTOCOL.set(p, entry)
  }
}

/**
 * Which app a configured scheme belongs to, or undefined when the table has
 * never heard of it.
 *
 * The inverse of `findApps`, and it exists so that counting can stop trusting
 * the app key. That key is the string somebody had to retype inside an iOS
 * automation, so people shorten and rename it — `dy` for one person, `douyin`
 * for the next, both pointing at `snssdk1128://`. Grouping by it splits one app
 * into several rows; grouping by what this returns does not, because the scheme
 * is the part they picked off the table rather than invented.
 *
 * `undefined` is an answer, not a failure, and callers must keep it that way by
 * falling back to the raw key. A hand-typed `wechat://` is in production right
 * now and appears in neither collection this table was built from; folding it
 * into 微信 would be exactly the unverified-string-read-as-an-answer mistake
 * this file exists to prevent, and leaving it as its own row is what puts it in
 * front of someone who can check it on a phone.
 */
export function appForScheme(scheme: string): AppEntry | undefined {
  return BY_PROTOCOL.get(protocolOf(scheme))
}

// --- derivation from a bundle id -------------------------------------------

/**
 * Marketing noise that shows up at the end of a bundle id but not in the
 * scheme — `m.qidian.QDReaderAppStore` answers to `QDReader://`. Longest first,
 * so 'appstore' is stripped as one piece rather than leaving 'QDReaderApp'.
 */
const TRAILING_NOISE = ['appstore', 'iphoneclient', 'client', 'iphone', 'store', 'mobile', 'ios', 'app']

function stripNoise(segment: string): string {
  let s = segment
  for (let pass = 0; pass < 2; pass++) {
    const lower = s.toLowerCase()
    const hit = TRAILING_NOISE.find((n) => lower.endsWith(n) && s.length > n.length)
    if (hit === undefined) break
    s = s.slice(0, s.length - hit.length)
  }
  return s
}

/**
 * Guesses, in descending order of how often the pattern held across the two
 * collections. Every one of these is wrong for some app in the snapshot —
 * `com.xingin.discover` is `xhsdiscover://`, which none of these rules produce —
 * so the caller must present them as guesses and nothing more.
 *
 * Filtered through `safeScheme` rather than a local regex: a bundle segment can
 * contain characters a URL scheme cannot, and the denylist that keeps
 * `javascript:` away from `location.href` has exactly one home.
 */
export function deriveFromBundleId(bundleId: string): Candidate[] {
  const parts = bundleId.split('.').filter((p) => p.length > 0)
  const out: Candidate[] = []

  const push = (raw: string | undefined, why: string): void => {
    if (raw === undefined || raw === '') return
    const scheme = safeScheme(`${raw}://`)
    if (scheme === '') return
    if (out.some((c) => c.scheme.toLowerCase() === scheme.toLowerCase())) return
    out.push({ scheme, confidence: 'derived', sources: [], caveat: why })
  }

  const last = parts[parts.length - 1]
  if (last !== undefined) {
    push(stripNoise(last), msg('bundle id 的最后一段，去掉 App/Store/iPhone 这类后缀。这一类猜对过（起点读书就是这么来的），也错过很多次。'))
    push(last, msg('bundle id 的最后一段，原样。'))
  }
  if (parts.length >= 2) {
    push(parts[parts.length - 2], msg('bundle id 倒数第二段——通常是公司或产品名（知乎、豆瓣都对上了）。'))
  }
  push(bundleId, msg('整个 bundle id 当 scheme（百度贴吧就是这么记的）。'))

  return out
}

/**
 * Turns an app name or bundle id into something /settings would accept as an
 * app key. Only used for apps that are not in the table, where there is no
 * curated key to fall back on.
 */
export function suggestKey(bundleId: string, fallback: string): string {
  const parts = bundleId.split('.').filter((p) => p.length > 0)
  const tail = parts[parts.length - 1] ?? ''
  const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32)
  return clean(stripNoise(tail)) || clean(tail) || clean(fallback) || 'app'
}
