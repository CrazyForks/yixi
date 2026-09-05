// In-app browsers, and the notice that exists because 试跳 cannot work in one.
//
// The failure this guards against is silent by nature: WeChat refuses a
// navigation to a custom scheme and says nothing, so the reader taps 试跳,
// gets no reaction, and concludes their scheme is wrong. They then try every
// candidate in the list, all failing for one reason that has nothing to do with
// any of them.
//
// Which makes FALSE POSITIVES the expensive direction here, not false
// negatives. Telling a Safari user that their working button cannot work is
// worse than saying nothing at all, so the negative cases below carry as much
// weight as the positive ones — real Safari, real Chrome on iOS, and QQ Browser
// (a standalone browser that does allow the jump, whose UA is one character
// away from the QQ app's).

import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { detectInAppBrowser, inAppBrowserPattern } from '../src/inapp'
import { handleSettings } from '../src/ui/settings'
import { renderSetup } from '../src/ui/setup'
import { renderLanding } from '../src/ui/landing'
import { upsertUserApp } from '../src/db'
import type { User } from '../src/types'

const user: User = { id: 1, name: '张三', is_owner: 0, created_at: Date.now() }

const WECHAT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x18003629) NetType/WIFI Language/zh_CN'
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1'
const QQ_BROWSER =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 MQQBrowser/13.9 Mobile/15E148 Safari/604.1'
const QQ_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/9.1.5.680 V1_IPH_SQ_9.1.5'

async function reset(): Promise<void> {
  await env.DB.batch([env.DB.prepare('DELETE FROM user_apps'), env.DB.prepare('DELETE FROM users')])
  await env.DB.prepare(
    'INSERT INTO users (id, name, token_hash, is_owner, created_at) VALUES (1, ?1, ?2, 0, ?3)',
  )
    .bind('张三', 'hash-inapp', Date.now())
    .run()
  await upsertUserApp(env.DB, {
    user_id: 1,
    app: 'xhs',
    label: '小红书',
    scheme: 'xhsdiscover://',
    wait_seconds: 10,
    grace_seconds: 90,
    enabled: 1,
  })
}
beforeEach(reset)

function req(path: string, ua?: string): Request {
  return new Request(`https://yixi.test${path}`, ua ? { headers: { 'user-agent': ua } } : undefined)
}

describe('detection', () => {
  it('recognises the apps people actually share links through', () => {
    const cases: Array<[string, string]> = [
      [WECHAT, '微信'],
      ['... AlipayClient/10.7.0 ...', '支付宝'],
      ['... AliApp(DingTalk/7.6.0) ...', '钉钉'],
      ['... Lark/7.30.0 ...', '飞书'],
      ['... XiaoHongShu/8.60 ...', '小红书'],
      ['... Weibo (iPhone14,2__weibo__15.4.0) ...', '微博'],
      [QQ_APP, 'QQ'],
    ]
    for (const [ua, name] of cases) {
      expect(detectInAppBrowser(ua)?.name, ua.slice(0, 40)).toBe(name)
    }
  })

  it('says nothing for a real browser — the expensive mistake is the other way', () => {
    // A false positive tells somebody their working button is broken, and sends
    // them hunting for a browser they are already in.
    for (const ua of [SAFARI, CHROME_IOS, QQ_BROWSER]) {
      expect(detectInAppBrowser(ua), ua.slice(0, 60)).toBeNull()
    }
  })

  it('does not mistake QQ Browser for the QQ app', () => {
    // MQQBrowser is a standalone browser and does allow the jump. The rule
    // matches `QQ/<version>`, which QQ Browser's UA does not contain.
    expect(detectInAppBrowser(QQ_BROWSER)).toBeNull()
    expect(detectInAppBrowser(QQ_APP)?.name).toBe('QQ')
  })

  it('handles a missing or empty User-Agent without guessing', () => {
    expect(detectInAppBrowser(null)).toBeNull()
    expect(detectInAppBrowser('')).toBeNull()
  })

  it('gives every host a way out, not just a diagnosis', () => {
    // A notice that says "this cannot work here" and stops is worse than none:
    // the reader now knows they are stuck and not how to get unstuck.
    for (const ua of [WECHAT, QQ_APP, '... AlipayClient/10 ...', '... Lark/7 ...']) {
      const host = detectInAppBrowser(ua)
      expect(host, ua.slice(0, 30)).not.toBeNull()
      expect(host!.escape.length).toBeGreaterThan(4)
    }
  })

  it('exports the same list as one pattern, so the two copies cannot drift', () => {
    const re = new RegExp(inAppBrowserPattern(), 'i')
    for (const ua of [WECHAT, QQ_APP, '... AlipayClient ...', '... XiaoHongShu ...']) {
      expect(re.test(ua), ua.slice(0, 30)).toBe(true)
    }
    for (const ua of [SAFARI, CHROME_IOS, QQ_BROWSER]) {
      expect(re.test(ua), ua.slice(0, 40)).toBe(false)
    }
  })
})

describe('/settings', () => {
  it('warns before the first tap, and says it is not the scheme’s fault', async () => {
    const page = await (await handleSettings(req('/settings', WECHAT), env, user)).text()
    expect(page).toContain('微信')
    expect(page).toContain('试跳')
    // The sentence that stops them working through every candidate in the list.
    expect(page).toContain('不是你的 scheme 填错了')
    expect(page).toContain('在浏览器中打开')
  })

  it('says the interception itself still works', async () => {
    const page = await (await handleSettings(req('/settings', WECHAT), env, user)).text()
    // Without this the notice reads as 「这工具在微信里坏了」 rather than
    // 「这一步要换个浏览器做」. The Shortcut opens the system default browser,
    // so the breathing page never runs in here.
    expect(page).toContain('真正拦你的时候不受影响')
    expect(page).toContain('系统默认浏览器')
  })

  it('stays quiet in Safari', async () => {
    const page = await (await handleSettings(req('/settings', SAFARI), env, user)).text()
    expect(page).not.toContain('banner warn')
    expect(page).not.toContain('内置的浏览器')
  })

  it('is a caution, not an error — nothing was rejected', async () => {
    const page = await (await handleSettings(req('/settings', WECHAT), env, user)).text()
    expect(page).toContain('class="banner warn"')
    expect(page).not.toContain('class="banner bad"')
  })

  it('escapes the host name it echoes, however the list grows', async () => {
    const page = await (await handleSettings(req('/settings', WECHAT), env, user)).text()
    expect(page).not.toMatch(/<script>(?![\s\S]*?\(function)/)
  })
})

describe('/setup', () => {
  it('warns at the top of the walkthrough it is about to invalidate', async () => {
    const page = await (await renderSetup(req('/setup', WECHAT), env, user)).text()
    expect(page).toContain('微信')
    expect(page).toContain('不会有反应')
    expect(page).toContain('用 Safari 打开')
  })

  it('stays quiet in Safari', async () => {
    const page = await (await renderSetup(req('/setup', SAFARI), env, user)).text()
    expect(page).not.toContain('内置的浏览器')
  })
})

describe('the landing page', () => {
  it('ships the notice hidden and reveals it in the browser, not on the server', async () => {
    // This page is edge-cacheable, so a UA-dependent body would serve one
    // visitor's answer to the next. Same HTML for everyone; the script decides.
    const wechat = await renderLanding(new URL('https://yixi.example/')).text()
    expect(wechat).toContain('id="inapp"')
    expect(wechat).toContain('hidden')
    expect(wechat).toContain('navigator.userAgent')
  })

  it('keeps its cache, which is the whole reason it is done client-side', async () => {
    const cc = renderLanding(new URL('https://yixi.example/')).headers.get('cache-control') ?? ''
    expect(cc).toContain('max-age')
    expect(cc).not.toContain('no-store')
  })

  it('reveals by toggling hidden, not by writing markup from a UA string', async () => {
    const js = (await renderLanding(new URL('https://yixi.example/')).text()).match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(js).toContain('el.hidden = false')
    expect(js).not.toContain('innerHTML')
  })

  it('carries the same host list as the server, generated not retyped', async () => {
    const js = (await renderLanding(new URL('https://yixi.example/')).text()).match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(js).toContain('MicroMessenger')
    expect(js).toContain('AlipayClient')
  })
})
