declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
    COOKIE_SECRET: string
    TOKEN_KEY: string
    TURNSTILE_SITE_KEY: string
    TURNSTILE_SECRET: string
  }
}
