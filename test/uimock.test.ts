import { describe, expect, it } from 'vitest'
import { renderUiMock } from '../src/ui/uimock'

/**
 * The icon-redesign mockup is a static page with no session and no database, so
 * these tests are not about behaviour. They guard the four promises the page
 * makes, each of which is easy to break silently while editing markup:
 *
 *   1. both directions render at all,
 *   2. no emoji (they render differently on every device and are the wrong
 *      register for this product),
 *   3. no external resource of any kind — the product's zero-request rule,
 *   4. the three warnings that must never disappear are still on the page.
 *
 * (4) is the one worth having. Compressing text is exactly the kind of edit
 * that quietly loses a sentence, and one of these three sentences is the
 * difference between "today it did not stop you" and "you are locked out of
 * your own phone".
 */

const BASE = 'https://yixi.example'

async function render(query = ''): Promise<{ res: Response; html: string }> {
  const res = renderUiMock(new URL(`${BASE}/mock-ui${query}`))
  return { res, html: await res.text() }
}

describe('/mock-ui — icon redesign mockup', () => {
  const queries = ['', '?v=1', '?v=2', '?v=nonsense']

  it('renders every variant as HTML', async () => {
    for (const q of queries) {
      const { res, html } = await render(q)
      expect(res.status, q).toBe(200)
      expect(res.headers.get('content-type'), q).toContain('text/html')
      // Went through layout.page(), so it inherits the CSP that enforces rule 3.
      expect(res.headers.get('content-security-policy'), q).toContain("default-src 'none'")
      expect(html.length, q).toBeGreaterThan(4000)
    }
  })

  it('draws its icons inline and loads no image', async () => {
    for (const q of queries) {
      const { html } = await render(q)
      expect(html, q).toContain('<svg')
      expect(html, q).not.toContain('<img')
    }
  })

  it('gives the two directions genuinely different markup', async () => {
    const line = (await render('?v=1')).html
    const ink = (await render('?v=2')).html
    expect(line).toContain('class="v-line"')
    expect(ink).toContain('class="v-ink"')
    // The 印 direction rebuilds the three tier marks as rotated seals.
    expect(ink).toContain('rotate(-2 12 12)')
    expect(line).not.toContain('rotate(-2 12 12)')
  })

  it('contains no emoji', async () => {
    // Emoji blocks only. The Arrows block (U+2190–U+21FF), enclosed numbers
    // (①②③) and math symbols (≠) are deliberately allowed: they are typography
    // this project already uses in prose, not pictographs, and they render
    // identically everywhere.
    const emoji = /[\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F000}-\u{1FAFF}]/u
    for (const q of queries) {
      const { html } = await render(q)
      const hit = html.match(emoji)
      expect(hit, `${q} contains ${hit ? JSON.stringify(hit[0]) : ''}`).toBeNull()
    }
  })

  it('references nothing outside the page', async () => {
    // Every URL-bearing attribute plus CSS url(). Anything absolute or
    // protocol-relative would be a network request the CSP is meant to forbid;
    // `data:` (layout's inert favicon) is the one allowed non-local form.
    const attrs = /(?:src|srcset|href|xlink:href)\s*=\s*"([^"]*)"/g
    const cssUrl = /url\(\s*['"]?([^'")]*)/g
    for (const q of queries) {
      const { html } = await render(q)
      const found: string[] = []
      for (const m of html.matchAll(attrs)) found.push(m[1] ?? '')
      for (const m of html.matchAll(cssUrl)) found.push(m[1] ?? '')
      const external = found.filter((u) => /^(?:https?:)?\/\//i.test(u.trim()))
      expect(external, q).toEqual([])
    }
  })

  it('keeps the three warnings that may be folded but never deleted', async () => {
    for (const q of queries) {
      const { html } = await render(q)
      // 1. fail-open: a condition written backwards locks the user out.
      expect(html, q).toContain('锁在手机外面')
      expect(html, q).toContain('不包含')
      // 2. these are only candidates; a real jump is the only proof.
      expect(html, q).toContain('没验证过')
      // 3. too short a grace window intercepts you the moment you land.
      expect(html, q).toContain('又被拦')
    }
  })

  it('keeps the try-then-save ordering visible on the buttons', async () => {
    // The rule used to live in a paragraph three blocks up; the mockup moves it
    // onto the buttons, so losing the ordinals loses the rule.
    const { html } = await render('?v=1')
    expect(html).toContain('class="ord"')
    const tryAt = html.indexOf('试跳「小红书」')
    const saveAt = html.indexOf('存进 xhs')
    expect(tryAt).toBeGreaterThan(-1)
    expect(saveAt).toBeGreaterThan(-1)
    // 试跳 is step 1 and must come first, the same asymmetry /lookup relies on.
    expect(tryAt).toBeLessThan(saveAt)
  })
})
