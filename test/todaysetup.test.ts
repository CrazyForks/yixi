import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { renderTodaySetup } from '../src/ui/todaysetup'
import type { User } from '../src/types'

const BASE = 'https://yixi.example.workers.dev'
const user: User = { id: 1, name: '张三', is_owner: 0, created_at: 0 }

async function render(): Promise<string> {
  const res = await renderTodaySetup(new Request(`${BASE}/today/setup`), env, user)
  expect(res.status).toBe(200)
  return await res.text()
}

describe('/today/setup', () => {
  it('carries the home-screen and Shortcut walkthrough that used to live on /setup', async () => {
    const html = await render()
    expect(html).toContain('让今日页一按就开')
    expect(html).toContain('添加到主屏幕')
    expect(html).toContain('再登录一次')
    expect(html).toContain('特定时间')
    expect(html).toContain(`${BASE}/today`)
  })

  it('marks 今日 · 怎么配 as the current tab', async () => {
    const html = await render()
    expect(html).toMatch(/<a href="\/today\/setup" class="on" aria-current="page"/)
  })

  it('points back to /setup for the interception side', async () => {
    const html = await render()
    expect(html).toContain('<a href="/setup">这里</a>')
  })

  it('stays calm — no exclamation marks in the copy, half-width or full-width', async () => {
    const html = await render()
    const main = html.match(/<main>([\s\S]*?)<\/main>/)
    expect(main, 'no <main> found').toBeTruthy()
    // Not the whole document: <!doctype html> carries a "!" that has nothing
    // to do with tone of voice.
    expect(main![1]).not.toContain('!')
    expect(main![1]).not.toContain('！')
  })
})
