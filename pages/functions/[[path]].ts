import worker from '../../src/index'
import type { Env } from '../../src/types'

/**
 * Pages entry point. The whole app is one Worker `fetch` handler; this hands
 * requests to it and does nothing else.
 *
 * Pages exists for exactly one reason: `workers.dev` is DNS-poisoned in mainland
 * China — three domestic resolvers each answer with a different wrong address —
 * while `pages.dev` resolves identically at home and abroad. Same Cloudflare
 * edge, same code, same database; only the hostname changes.
 *
 * It lives in its own directory because `wrangler pages deploy` refuses a custom
 * config path, so the Pages project needs a wrangler.toml of its own and cannot
 * share the Worker's.
 *
 * The cron stays on the Worker deployment: Pages has no scheduled trigger, and a
 * nightly cleanup fired by Cloudflare itself does not care that its own hostname
 * is unreachable from China.
 */
export const onRequest: PagesFunction<Env> = (ctx) => worker.fetch(ctx.request, ctx.env)
