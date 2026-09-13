/**
 * English translations, keyed by the Chinese source text that `t()`/`msg()`
 * calls pass as their first argument — see src/i18n/index.ts for how a key is
 * looked up and how a miss falls back to the Chinese source itself.
 *
 * Empty for now: nothing in the app has been wrapped in `t()`/`msg()` yet.
 * Each i18n task that follows adds the keys its own batch of pages
 * introduces; test/i18n.test.ts's guard ② fails as soon as a `t()`/`msg()`
 * source anywhere in src/ has no entry here.
 */
export const EN: Record<string, string> = {}
