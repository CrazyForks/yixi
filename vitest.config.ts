import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          singleWorker: true,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              COOKIE_SECRET: 'test-cookie-secret',
              TOKEN_KEY: 'test-token-key',
              // Bound but empty on purpose: empty means "no widget configured",
              // which is the fail-open path, so the whole existing suite keeps
              // registering without a challenge. test/turnstile.test.ts sets and
              // restores them per test. Declaring them here rather than only in
              // the tests keeps them visible as real bindings.
              TURNSTILE_SITE_KEY: '',
              TURNSTILE_SECRET: '',
            },
          },
        },
      },
    },
  }
})
