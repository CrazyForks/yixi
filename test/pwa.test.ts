import { describe, expect, it } from 'vitest'
import { PWA_HEAD, iconResponse, manifestResponse } from '../src/ui/pwa'
import { pageHtml, page, DEFAULT_THEME } from '../src/ui/layout'

describe('manifest', () => {
  it('starts on /today, standalone, scoped to the whole site', async () => {
    const res = manifestResponse()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/application\/manifest\+json/)
    expect(res.headers.get('cache-control')).toMatch(/max-age=/)
    const m = (await res.json()) as Record<string, unknown>
    expect(m).toMatchObject({
      name: '一息',
      short_name: '一息',
      start_url: '/today',
      scope: '/',
      display: 'standalone',
      background_color: '#f3f0e8',
      theme_color: '#f3f0e8',
    })
    const icons = m['icons'] as { src: string; sizes: string; type: string; purpose: string }[]
    expect(icons[0]).toEqual({ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' })
  })
})

describe('icon', () => {
  it('is a real PNG, cacheable, and public', async () => {
    const res = iconResponse()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    const bytes = new Uint8Array(await res.arrayBuffer())
    // PNG signature
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    // IHDR width/height 512
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(16)).toBe(512)
    expect(view.getUint32(20)).toBe(512)
    expect(bytes.length).toBeGreaterThan(200)
    expect(bytes.length).toBeLessThan(40_000)
  })
})

describe('every page carries the home-screen head', () => {
  const html = pageHtml({ title: 't', theme: DEFAULT_THEME, body: '' })
  it('links the manifest and the touch icon', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">')
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon.png">')
  })
  it('asks iOS and Android for a standalone window with our name', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">')
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">')
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="一息">')
    expect(html).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="default">')
  })
  it('lets the manifest through the CSP, and nothing else new', () => {
    const csp = page({ title: 't', theme: DEFAULT_THEME, body: '' }).headers.get('content-security-policy')!
    expect(csp).toContain("manifest-src 'self'")
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toMatch(/https?:\/\//)
  })
  it('PWA_HEAD is what pageHtml inlines', () => {
    expect(html).toContain(PWA_HEAD)
  })
})
