/**
 * Password hashing and token sealing. Both sit on WebCrypto, which is all the
 * Workers runtime offers — there is no bcrypt/argon2 here.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export function b64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// --- passwords -------------------------------------------------------------

/**
 * PBKDF2 rounds. OWASP wants 600k for SHA-256, which this cannot afford: a
 * Worker on the free plan gets 10ms of CPU per request and the derivation runs
 * inline with the login.
 *
 * Measured in the Workers runtime rather than guessed —
 *   50k → 5ms   100k → 6ms   200k → 11ms   400k → 23ms   600k → 35ms
 * so anything past ~150k cannot fit, and 600k would be four failed logins out
 * of four. 100k leaves headroom for the rest of the request.
 *
 * Only /register, /login and /recover pay this. The hot path — /gate, hit every
 * time a phone opens a watched app — does one SHA-256 and never lands here.
 *
 * The shortfall is survivable because a password is not the only thing standing
 * between an attacker and an account: the gate token is 128 bits of randomness
 * and cannot be brute-forced at all. A weak password protects the *convenience*
 * layer, and the stored value is per-user salted, so a stolen database still
 * has to be attacked one account at a time.
 *
 * Stored per row as `password_iters`, so raising this later re-hashes people on
 * their next login instead of locking them out.
 */
export const PBKDF2_ITERATIONS = 100_000

export interface PasswordRecord {
  hash: string
  salt: string
  iterations: number
}

export async function hashPassword(
  password: string,
  opts: { salt?: string; iterations?: number } = {},
): Promise<PasswordRecord> {
  const iterations = opts.iterations ?? PBKDF2_ITERATIONS
  const salt = opts.salt ? unb64(opts.salt) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return { hash: b64(new Uint8Array(bits)), salt: b64(salt), iterations }
}

/**
 * Compares in constant time. The two hashes are public-ish values rather than
 * secrets, but a length-dependent early return would still leak how far a
 * guess got.
 */
export async function verifyPassword(password: string, rec: PasswordRecord): Promise<boolean> {
  const again = await hashPassword(password, { salt: rec.salt, iterations: rec.iterations })
  return timingSafeEqualStr(again.hash, rec.hash)
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// --- token sealing ---------------------------------------------------------

/**
 * The gate token, encrypted so a logged-in holder can read it back.
 *
 * AES-GCM under a key that lives in the TOKEN_KEY secret and never reaches D1,
 * so a stolen database alone yields nothing. A fresh 96-bit IV per seal: GCM
 * repeats catastrophically under IV reuse, and these are sealed rarely enough
 * that randomness is safe.
 */
async function aesKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('TOKEN_KEY is not set')
  // The secret is arbitrary text; SHA-256 turns it into the 256 bits AES wants.
  const material = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export interface SealedToken {
  cipher: string
  iv: string
}

export async function sealToken(secret: string, token: string): Promise<SealedToken> {
  const key = await aesKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const out = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token))
  return { cipher: b64(new Uint8Array(out)), iv: b64(iv) }
}

/**
 * Returns null rather than throwing when the ciphertext will not open — a row
 * sealed under a rotated key should degrade to "we cannot show you this key"
 * on one page, not 500 the whole console.
 */
export async function openToken(secret: string, sealed: SealedToken): Promise<string | null> {
  try {
    const key = await aesKey(secret)
    const out = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(sealed.iv) as BufferSource },
      key,
      unb64(sealed.cipher) as BufferSource,
    )
    return dec.decode(out)
  } catch {
    return null
  }
}

// --- random ----------------------------------------------------------------

/** Hex, `bytes * 2` characters. Used for gate tokens and session ids alike. */
export function randomHex(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
