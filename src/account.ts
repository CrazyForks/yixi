import type { Env, User } from './types'
import { issueCookie, revokeCookie, sha256Hex, userFromToken } from './auth'
import {
  attachAccount,
  createAccount,
  deleteWebSessionsForUser,
  findAccountByEmail,
  findAccountById,
  getSealedToken,
  isEmailTakenError,
  updateUserPassword,
  rotateUserToken,
} from './db'
import type { AccountRecord } from './db'
import { PBKDF2_ITERATIONS, hashPassword, openToken, randomHex, sealToken, verifyPassword } from './crypto'
import { msg, type T } from './i18n'

/**
 * Accounts: sign up, sign in, sign out, and the two ways to change a password.
 *
 * The design this replaces had the owner minting tokens by hand and handing
 * them over offline, which meant a lost token was gone forever and every new
 * person cost the owner a conversation. An account is a way to get your own
 * token back, and nothing more — it does not become the credential. /gate still
 * verifies the token and only the token.
 *
 * WHY THERE IS NO EMAIL DELIVERY HERE. A password reset normally needs a second
 * channel, which means a mail provider, a sending domain, deliverability, and a
 * bounce story — for a tool with a handful of users. The two secrets here are
 * already a second channel for each other: forget the token and you log in to
 * read it; forget the password and you reset it with the token. The loop closes
 * on itself, and the email address is only ever a username.
 *
 * That is a deliberate trade, not an oversight: lose both and the account is
 * unrecoverable, because there is no third thing that proves you are you.
 *
 * Everything here returns a discriminated result rather than a Response — the
 * pages own their own copy and status codes — and every failure carries a
 * stable code, with `accountErrorMessage` offering wording for callers that
 * would otherwise invent their own.
 */

// --- shapes ----------------------------------------------------------------

export type AccountError =
  | 'invalid_email'
  | 'weak_password'
  | 'invalid_name'
  | 'email_taken'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'no_account'
  | 'token_has_account'

export interface Signed {
  user: User
  /** A ready-made Set-Cookie value; the caller attaches it to its response. */
  setCookie: string
}

export type Failure = { ok: false; error: AccountError }

export type RegisterResult = ({ ok: true; token: string } & Signed) | Failure
export type LoginResult = ({ ok: true } & Signed) | Failure
export type ClaimResult = ({ ok: true } & Signed) | Failure
export type ResetResult = ({ ok: true } & Signed) | Failure
export type ChangePasswordResult = { ok: true; setCookie: string } | Failure

export interface AccountSummary {
  email: string | null
  /** False for a token that was handed out before accounts existed. */
  hasPassword: boolean
}

// --- validation ------------------------------------------------------------

const MAX_EMAIL_LENGTH = 254
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 200
const MAX_NAME_LENGTH = 40

// Deliberately loose. Anything stricter rejects addresses that are perfectly
// valid, and there is no verification mail here to be right about — the address
// is a username. All this has to catch is a typo the user can see.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Lowercased and trimmed, which is also how it is stored and looked up. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function validEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email)
}

function validPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
}

/** The part before the @, so signing up does not also demand a display name. */
function defaultName(email: string): string {
  const local = email.split('@')[0] ?? ''
  return local.slice(0, MAX_NAME_LENGTH)
}

/**
 * Wording for a failure, in the reader's language.
 *
 * The translator is a parameter rather than something this module builds for
 * itself: a Worker isolate serves many requests at once, so the only correct
 * place to decide a language is the request, and the page already knows. The
 * three limits are interpolated through `{min}`/`{max}` placeholders rather
 * than a template literal, because the Chinese source doubles as the key
 * src/i18n/en.ts is written against — a template literal would key the
 * dictionary on a string that changes with the numbers. `msg()` is the marker
 * that makes those sources as findable to test/i18n.test.ts's guard here as a
 * `t('…')` call is on a page.
 */
export function accountErrorMessage(error: AccountError, t: T): string {
  switch (error) {
    case 'invalid_email':
      return t(msg('这个邮箱看着不对，检查一下。'))
    case 'weak_password':
      return t(msg('密码至少 {min} 位，最多 {max} 位。'), {
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
      })
    case 'invalid_name':
      return t(msg('名字不能是空的，也别超过 {max} 个字。'), { max: MAX_NAME_LENGTH })
    case 'email_taken':
      return t(msg('这个邮箱已经注册过了，直接登录。'))
    case 'invalid_credentials':
      return t(msg('邮箱或密码不对。'))
    case 'invalid_token':
      return t(msg('这个 token 不对。'))
    case 'no_account':
      return t(msg('这个 token 还没绑定邮箱和密码，先去绑定。'))
    case 'token_has_account':
      return t(msg('这个 token 已经绑过账号了，直接登录，或者用它重置密码。'))
  }
}

const fail = (error: AccountError): Failure => ({ ok: false, error })

// --- register --------------------------------------------------------------

export interface RegisterInput {
  email: string
  password: string
  /** Optional; defaults to the local part of the email. */
  name?: string
}

/**
 * Signs somebody up and mints their gate token in the same breath.
 *
 * The token is written twice, and the two copies are for different readers:
 * `token_hash` is what /gate compares against, and the sealed copy is what this
 * account exists to hand back. Both are derived from the same plaintext in this
 * one function, which is the only place that plaintext ever exists on the
 * server — it goes out in the result and is never written down.
 */
export async function register(env: Env, input: RegisterInput): Promise<RegisterResult> {
  const email = normalizeEmail(input.email)
  if (!validEmail(email)) return fail('invalid_email')
  if (!validPassword(input.password)) return fail('weak_password')

  const name = (input.name ?? defaultName(email)).trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return fail('invalid_name')

  const token = randomHex(16)
  const [password, sealedToken, tokenHash] = await Promise.all([
    hashPassword(input.password),
    sealToken(env.TOKEN_KEY, token),
    sha256Hex(token),
  ])

  const createdAt = Date.now()
  let id: number
  try {
    id = await createAccount(env.DB, { name, email, password, tokenHash, sealedToken, createdAt })
  } catch (err) {
    // The index is the authority, not a prior SELECT: two people submitting the
    // same address in the same second would both pass a check-then-insert. A
    // duplicate is an ordinary answer to give a stranger, not a 500.
    if (isEmailTakenError(err)) return fail('email_taken')
    throw err
  }

  const user: User = { id, name, is_owner: 0, created_at: createdAt }
  return { ok: true, user, token, setCookie: await issueCookie(env, user) }
}

// --- login -----------------------------------------------------------------

export interface LoginInput {
  email: string
  password: string
}

/**
 * A fixed record to hash against when the email is unknown.
 *
 * Without it, an unknown address answers in the time of one D1 read and a known
 * one in the time of a D1 read plus ~6ms of PBKDF2, which is a clean oracle for
 * "does this person use 一息" — and the answer to that is nobody's business
 * given what /review contains. The derived value is discarded; only the work
 * matters.
 */
const DECOY_PASSWORD_RECORD = {
  // A real PBKDF2 output over a random string that was discarded, so this
  // constant is not a password anybody can ever present.
  hash: '/2c662Q8dhtVM84pYF0hzn69deOwTx8hQtjVWrDHCas=',
  salt: 'eWl4aS1kZWNveS1zYWx0IQ==',
  iterations: PBKDF2_ITERATIONS,
}

export async function login(env: Env, input: LoginInput): Promise<LoginResult> {
  const email = normalizeEmail(input.email)
  const account = validEmail(email) ? await findAccountByEmail(env.DB, email) : null
  const stored = credentialsOf(account)

  const ok = await verifyPassword(input.password, stored ?? DECOY_PASSWORD_RECORD)

  // One answer for "no such address", "malformed address" and "wrong password".
  // Which of the three it was is exactly the thing not to disclose.
  if (!ok || !account || !stored) return fail('invalid_credentials')

  // A stored `password_iters` below the current cost is NOT upgraded here. The
  // re-hash would double this request's CPU, and on the free plan's 10ms budget
  // that turns into a login that fails every time it is attempted — locking out
  // precisely the accounts the upgrade was meant to protect. Raising the cost
  // needs a background re-hash (ctx.waitUntil), not this path.

  const user = plainUser(account)
  return { ok: true, user, setCookie: await issueCookie(env, user) }
}

/** Sessions die server-side; the cookie is only cleared so the browser stops sending it. */
export async function logout(env: Env, sessionId: string | null): Promise<string> {
  return await revokeCookie(env, sessionId)
}

// --- claim -----------------------------------------------------------------

export interface ClaimInput {
  token: string
  email: string
  password: string
  name?: string
}

/**
 * Binds an email and password to a token that predates accounts.
 *
 * Without this, every token handed out by the old ticket window — the owner's
 * own included — is stranded: registering afresh mints a *different* token, so
 * the person would lose their history, their app config and, if they are the
 * owner, their `is_owner` flag. Sealing the token also has exactly one window
 * of opportunity, and this is it: the server knows the plaintext only while the
 * holder is presenting it.
 */
export async function claimAccount(env: Env, input: ClaimInput): Promise<ClaimResult> {
  const owner = await userFromToken(env, input.token)
  if (!owner) return fail('invalid_token')

  const email = normalizeEmail(input.email)
  if (!validEmail(email)) return fail('invalid_email')
  if (!validPassword(input.password)) return fail('weak_password')

  const existing = await findAccountById(env.DB, owner.id)
  if (existing?.email) return fail('token_has_account')

  const name = (input.name ?? owner.name).trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return fail('invalid_name')

  const [password, sealedToken] = await Promise.all([
    hashPassword(input.password),
    sealToken(env.TOKEN_KEY, input.token),
  ])

  let attached: boolean
  try {
    attached = await attachAccount(env.DB, owner.id, { email, password, sealedToken })
  } catch (err) {
    if (isEmailTakenError(err)) return fail('email_taken')
    throw err
  }
  // Lost the race against another claim of the same token — see attachAccount.
  if (!attached) return fail('token_has_account')

  return { ok: true, user: owner, setCookie: await issueCookie(env, owner) }
}

// --- password reset with the token ----------------------------------------

export interface ResetInput {
  token: string
  password: string
}

/**
 * The other half of the closed loop: prove you hold the gate token, and you may
 * set a new password without any mail being sent.
 *
 * This is as strong as the token, which is 128 random bits and unguessable —
 * strictly stronger than the emailed link it stands in for, since there is no
 * inbox in the middle to be compromised.
 *
 * Revoking every session is not housekeeping, it is the point: the reason to
 * reset is usually that somebody else may be holding the password, and leaving
 * their browser signed in would make the reset theatre. Revocation happens
 * before the new session is minted, so the one this call hands back survives.
 */
export async function resetPasswordWithToken(env: Env, input: ResetInput): Promise<ResetResult> {
  const user = await userFromToken(env, input.token)
  if (!user) return fail('invalid_token')

  const account = await findAccountById(env.DB, user.id)
  // Nothing to reset: this token has no email to log in with afterwards, so
  // setting a password would leave the holder with a credential they cannot
  // use. They want claimAccount instead.
  if (!account?.email) return fail('no_account')
  if (!validPassword(input.password)) return fail('weak_password')

  // Revocation happens inside updateUserPassword, in the same transaction.
  await updateUserPassword(env.DB, user.id, await hashPassword(input.password))

  return { ok: true, user, setCookie: await issueCookie(env, user) }
}

// --- password change (signed in) ------------------------------------------

export interface ChangePasswordInput {
  user: User
  currentPassword: string
  newPassword: string
}

/**
 * Changing a password from inside the account. The current password is required
 * even though the session already proves identity: an unattended phone is the
 * realistic threat here, and a session alone should not be enough to lock the
 * real owner out.
 *
 * Every session is dropped, including the one making this request, and a fresh
 * cookie is handed back so the tab that asked stays signed in. That ordering is
 * the whole security property — the other browsers are out, this one is not.
 */
export async function changePassword(env: Env, input: ChangePasswordInput): Promise<ChangePasswordResult> {
  const account = await findAccountById(env.DB, input.user.id)
  const stored = credentialsOf(account)
  if (!account?.email || !stored) return fail('no_account')

  if (!(await verifyPassword(input.currentPassword, stored))) return fail('invalid_credentials')
  if (!validPassword(input.newPassword)) return fail('weak_password')

  await updateUserPassword(env.DB, input.user.id, await hashPassword(input.newPassword))

  return { ok: true, setCookie: await issueCookie(env, input.user) }
}

// --- reading the token back ------------------------------------------------

/**
 * The point of the whole feature: show a signed-in holder their own gate token.
 *
 * Null means "there is no readable copy" — an old row that was never claimed,
 * or a row sealed under a TOKEN_KEY that has since been rotated. Callers should
 * say so rather than treating it as an error; the token itself still works, it
 * just cannot be displayed.
 */
export async function revealToken(env: Env, user: User): Promise<string | null> {
  const sealed = await getSealedToken(env.DB, user.id)
  if (!sealed) return null
  return await openToken(env.TOKEN_KEY, sealed)
}

/** What the settings page needs to know about the account behind a session. */
export async function accountSummary(env: Env, user: User): Promise<AccountSummary> {
  const account = await findAccountById(env.DB, user.id)
  return { email: account?.email ?? null, hasPassword: credentialsOf(account) !== null }
}

/**
 * Issues a fresh gate token and returns the plaintext once.
 *
 * This is the only remedy for a leaked token. `?k=` is a bearer credential that
 * rides in a Shortcut's URL and in Safari history, so it spreads further than a
 * password ever does — and changing the password does not touch it. Without
 * rotation the answer to "my token got out" would be "abandon the account and
 * lose the history", which is no answer at all.
 *
 * The current password is required. A session alone should not be enough: the
 * realistic threat is an unattended phone, and rotating from one silently breaks
 * every automation the real owner has set up.
 */
export async function rotateToken(
  env: Env,
  input: { user: User; currentPassword: string },
): Promise<{ ok: true; token: string } | { ok: false; error: AccountError }> {
  const account = await findAccountById(env.DB, input.user.id)
  const stored = credentialsOf(account)
  if (!account?.email || !stored) return fail('no_account')
  if (!(await verifyPassword(input.currentPassword, stored))) return fail('invalid_credentials')

  const token = randomHex(16)
  await rotateUserToken(env.DB, input.user.id, {
    tokenHash: await sha256Hex(token),
    sealed: await sealToken(env.TOKEN_KEY, token),
  })
  return { ok: true, token }
}

// --- helpers ---------------------------------------------------------------

/** The three password columns, or null unless all of them are present. */
function credentialsOf(
  account: AccountRecord | null,
): { hash: string; salt: string; iterations: number } | null {
  if (!account?.password_hash || !account.password_salt || !account.password_iters) return null
  return { hash: account.password_hash, salt: account.password_salt, iterations: account.password_iters }
}

/** Drops the credential columns; nothing outside this file should see them. */
function plainUser(account: AccountRecord): User {
  return {
    id: account.id,
    name: account.name,
    is_owner: account.is_owner,
    created_at: account.created_at,
    locale: account.locale,
  }
}
