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

// Vite's `?raw` suffix, used by test/wrangler-config.test.ts to read
// wrangler.toml as plain text — the workers pool has no `node:fs`.
declare module '*?raw' {
  const content: string
  export default content
}
