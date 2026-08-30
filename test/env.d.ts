declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: D1Migration[]
    COOKIE_SECRET: string
    TOKEN_KEY: string
  }
}
