// crypto.ts is where the account feature's two irreversible mistakes would
// live: a password stored in a way that survives a database leak, and a sealed
// token that either cannot be opened or opens for the wrong key. Neither shows
// up as a failing page — the first is silent forever, the second only when
// somebody has already lost their token — so both are pinned here.

import { describe, expect, it } from 'vitest'
import {
  PBKDF2_ITERATIONS,
  b64,
  hashPassword,
  openToken,
  randomHex,
  sealToken,
  timingSafeEqualStr,
  unb64,
  verifyPassword,
} from '../src/crypto'

const KEY = 'test-token-key'
const OTHER_KEY = 'a-different-token-key'

describe('base64 helpers', () => {
  it('round-trips arbitrary bytes, including the ones that are not text', async () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 200, 255])

    expect([...unb64(b64(bytes))]).toEqual([...bytes])
    expect([...unb64(b64(new Uint8Array(0)))]).toEqual([])
  })
})

describe('hashPassword', () => {
  it('never returns the password, and salts every call differently', async () => {
    const first = await hashPassword('correct horse battery staple')
    const second = await hashPassword('correct horse battery staple')

    expect(first.hash).not.toContain('horse')
    expect(first.salt).not.toBe(second.salt)
    // Same password, different salt — so a leaked table cannot be attacked once
    // for everyone who picked the same weak password.
    expect(first.hash).not.toBe(second.hash)
  })

  it('is deterministic given the stored salt and cost — that is what makes verification possible', async () => {
    const stored = await hashPassword('hunter2hunter2')

    const again = await hashPassword('hunter2hunter2', { salt: stored.salt, iterations: stored.iterations })

    expect(again.hash).toBe(stored.hash)
  })

  it('records the cost it used, so raising it later cannot lock anybody out', async () => {
    const cheap = await hashPassword('hunter2hunter2', { iterations: 1000 })

    expect(cheap.iterations).toBe(1000)
    expect((await hashPassword('hunter2hunter2')).iterations).toBe(PBKDF2_ITERATIONS)
    // An old row still verifies against its own recorded cost.
    expect(await verifyPassword('hunter2hunter2', cheap)).toBe(true)
  })

  it('uses a 16-byte salt and yields a 256-bit hash', async () => {
    const rec = await hashPassword('hunter2hunter2')

    expect(unb64(rec.salt).length).toBe(16)
    expect(unb64(rec.hash).length).toBe(32)
  })
})

describe('verifyPassword', () => {
  it('accepts the right password and rejects everything else', async () => {
    const rec = await hashPassword('hunter2hunter2', { iterations: 1000 })

    expect(await verifyPassword('hunter2hunter2', rec)).toBe(true)
    expect(await verifyPassword('hunter2hunter3', rec)).toBe(false)
    expect(await verifyPassword('hunter2hunter2 ', rec)).toBe(false)
    expect(await verifyPassword('', rec)).toBe(false)
  })

  it('fails rather than throws when the stored record has been tampered with', async () => {
    const rec = await hashPassword('hunter2hunter2', { iterations: 1000 })

    expect(await verifyPassword('hunter2hunter2', { ...rec, hash: b64(new Uint8Array(32)) })).toBe(false)
    expect(await verifyPassword('hunter2hunter2', { ...rec, iterations: 999 })).toBe(false)
  })
})

describe('timingSafeEqualStr', () => {
  it('matches equal strings and rejects every kind of difference', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true)
    expect(timingSafeEqualStr('', '')).toBe(true)
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false)
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false)
  })
})

describe('sealToken / openToken', () => {
  it('round-trips the token that /gate will verify', async () => {
    const token = randomHex(16)

    const opened = await openToken(KEY, await sealToken(KEY, token))

    expect(opened).toBe(token)
  })

  it('hides the token in the ciphertext', async () => {
    const token = randomHex(16)

    const sealed = await sealToken(KEY, token)

    expect(sealed.cipher).not.toContain(token)
    expect(unb64(sealed.iv).length).toBe(12)
  })

  it('uses a fresh IV per seal — GCM fails catastrophically if one repeats', async () => {
    const token = randomHex(16)

    const a = await sealToken(KEY, token)
    const b = await sealToken(KEY, token)

    expect(a.iv).not.toBe(b.iv)
    expect(a.cipher).not.toBe(b.cipher)
    expect(await openToken(KEY, a)).toBe(token)
    expect(await openToken(KEY, b)).toBe(token)
  })

  it('returns null for the wrong key instead of throwing', async () => {
    const sealed = await sealToken(KEY, 'a-token')

    // A row sealed under a rotated key must degrade to "cannot show you this",
    // not take down the page that renders it.
    await expect(openToken(OTHER_KEY, sealed)).resolves.toBeNull()
  })

  it('returns null for tampered ciphertext, a tampered IV, and garbage', async () => {
    const sealed = await sealToken(KEY, 'a-token')
    const flipped = unb64(sealed.cipher)
    flipped[0] ^= 0xff

    expect(await openToken(KEY, { ...sealed, cipher: b64(flipped) })).toBeNull()
    expect(await openToken(KEY, { ...sealed, iv: b64(new Uint8Array(12)) })).toBeNull()
    expect(await openToken(KEY, { cipher: 'not base64 at all !!', iv: sealed.iv })).toBeNull()
    expect(await openToken(KEY, { cipher: '', iv: '' })).toBeNull()
  })

  it('refuses to seal with an unset key rather than encrypting under ""', async () => {
    await expect(sealToken('', 'a-token')).rejects.toThrow(/TOKEN_KEY/)
    // And opening with one is a null, since a missing secret is a deployment
    // problem to notice on one page, not a 500 on every page.
    expect(await openToken('', await sealToken(KEY, 'a-token'))).toBeNull()
  })
})

describe('randomHex', () => {
  it('is lowercase hex of the requested byte length', () => {
    expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/)
    expect(randomHex(8)).toMatch(/^[0-9a-f]{16}$/)
    expect(randomHex()).toMatch(/^[0-9a-f]{32}$/)
  })

  it('does not repeat — this is the gate token and the session id both', () => {
    const seen = new Set(Array.from({ length: 200 }, () => randomHex(16)))

    expect(seen.size).toBe(200)
  })
})
