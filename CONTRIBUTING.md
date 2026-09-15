# Contributing

Patches welcome. This document is short, and it skips the generic advice — everything here is a rule that exists because ignoring it already broke something.

Read [docs/architecture.md](docs/architecture.md) first if you are touching more than one file.

## Commands

```bash
npm test               # vitest run — the full suite
npm run typecheck      # tsc --noEmit (src) + tsc -p test --noEmit
npm run dev            # wrangler dev — local server
npm run migrate:local  # apply migrations to the local D1
npm run deploy         # remote migrations, then deploy the Worker
```

Both `npm test` and `npm run typecheck` must be green. `typecheck` runs twice on purpose — `src` and `test` have separate tsconfigs — and only the second one catches a broken test file.

## 1. Never hard-code a URL scheme from memory

Not in a table, not in a placeholder, not in an example in a comment. **Do not write `someapp://` into a diagram either**; it has already been copied out of one as if it were an answer.

Getting a scheme wrong does not produce an error anywhere. The user breathes for ten seconds, taps 「继续」, and stops dead in Safari. There is no log line, no exception, no red anything — just a tool that quietly does not work, discovered at the worst possible moment.

`src/schemes.ts` already has the structure for this. Three confidence tiers:

- **`verified`** — made a real iPhone jump. **Nothing in the file is ever this tier.** Only the phone in the reader's hand can promote a candidate, by jumping on `/probe`. The tier exists in the type so the UI has a name for what these candidates are *not*.
- **`listed`** — transcribed out of a named public collection, with a link. Traceable, and stale the moment an app ships a change nobody logged.
- **`derived`** — pattern-matched off a bundle id. A guess, labelled as one, with no `sources` — and that emptiness is the signal.

Any new entry needs a traceable source and the right tier. `test/lookup.test.ts` mechanically enforces this: it asserts the shipped table contains **zero** `verified` and **zero** `derived` rows, that every candidate has at least one `https://github.com/…` source, and that every scheme survives `safeScheme`. Where two collections disagree, ship **both** candidates with a caveat explaining the conflict. Do not pick one and present it as settled.

Adding a scheme to the denylist? It goes in `src/scheme.ts` and nowhere else. Three hand-maintained copies of that list had already drifted apart — `about:` was in two of them and missing from the one closest to `location.href`.

## 2. The proceed jump must stay inside the synchronous click stack

In `src/ui/breathe.ts`:

```js
go.addEventListener('click', function(){
  report('proceed');                  // sendBeacon — hands off and returns
  if(SCHEME)location.href=SCHEME;     // synchronous, same gesture stack
  finish('went', ...);
});
```

Safari only follows a custom URL scheme from inside the synchronous call stack of a genuine user gesture. Any `await`, any `.then()`, any `setTimeout` between the tap and the assignment moves the navigation off that stack and Safari silently swallows it. The user taps 「继续」 and sits on a dead page. **This one mistake breaks the core product on the only platform it targets, and it breaks it invisibly** — everything still looks fine in a desktop browser and in tests that do not know to look.

`navigator.sendBeacon` is what makes this possible: it hands the request to the browser and returns immediately, so the jump on the next line is still inside the gesture. The fallback is `fetch(..., { keepalive: true })` **not awaited**. Never `await fetch`.

Guarded by tests, and they are stricter than they look:

- `test/breathe.test.ts` strips comments from the page script first (the script *carries* a comment containing the word `await`, so a naive grep would go green on the bug), then asserts the word appears nowhere in it, and that nothing awaiting sits between the `sendBeacon` call and `location.href=SCHEME`.
- `test/lookup.test.ts` asserts that `/lookup` — which absorbed `/probe`, so it is the only page that jumps to a candidate — contains **exactly one** `jump()` and **exactly one** assignment to `location.href`, and that the statement matches the breathing page's own, modulo the variable name. This used to be a byte comparison between two pages' copies of the function; with one page the copies are gone and what is left to protect is that the candidates, the configured apps and the hand-typed box did not each grow their own navigation. It is deliberately stronger than "no await": an `<a href>` and a synchronous handler are different mechanisms in Safari, and a scheme certified by the wrong one would still fail where it counts.

`/today`'s own `go()` and the `schemefield` script that `/settings` and `/today/goals` share are bound by this same rule; `test/today.test.ts` and `test/schemefield.test.ts` each carry their own assertion of it.

## 3. `/gate` is the hot path

It is hit every single time a phone opens a watched app, and a Worker on the free plan gets 10ms of CPU per request. Its current cost is one SHA-256, three indexed D1 reads, and one or two writes.

**No PBKDF2, no AES, no extra round trip may be added there.** In particular: the encrypted copy of the token is never read on this path. The hash is the credential; the ciphertext is only ever shown back to somebody who has already proved who they are.

`/gate` also owns the fail-open contract. Whatever you change, `pass`, an empty body, an error page and a dead network must all continue to produce a response that does not contain the string `https` — that is what keeps the Shortcut from locking someone out of their own phone. See [SECURITY.md](SECURITY.md#fail-open-is-deliberate-and-it-is-a-security-decision-too).

## 4. `grace_pass` never enters a denominator

`grace_pass` is the iOS automation re-firing as control is handed back to the target app. It is machine noise, not a human impulse. `attempt` is the sole denominator of every ratio in `src/stats.ts`, and mixing the two makes the abandon rate silently meaningless — worse than absent, because it still looks like a number.

Two mechanical details you will trip over:

- **`events.sid = ''` is the sentinel** for a `grace_pass` row. `events.sid` is `NOT NULL` and there is no interception session behind these rows, so they all share that one value. Anything joining `events` to `sessions` must filter them out rather than assume the join lands — otherwise one day's attempts get multiplied by the size of the noise pile. The queries in `src/stats.ts` carry an explicit `sid <> ''` *in addition to* their kind filter, guarded twice on purpose.
- **A session's outcome is attributed to the day of its `attempt`, not the day the button was tapped.** Someone intercepted at 23:59:50 who taps 「算了」 at 00:00:05 belongs to the night the impulse happened. Count per-kind per-day instead and `attempt − proceeded − abandoned` goes negative across midnight.

`grace_pass` is not hidden, either: `/review` shows the count once as a footnote, so the exclusion is visible rather than invisible.

## 5. No behaviour change without a test — and verify the test

Especially for anything security- or accounting-related.

The convention in this repo is **mutation verification**: after writing a test, deliberately break the implementation it covers and confirm the assertion actually goes red. It has already caught several assertions that passed for the wrong reason and would never have failed.

Concrete examples from this repo's history: dropping the same-site check on the login redirect must turn the open-redirect test red; removing the `sid <> ''` guard must turn a stats test red; deleting the projection narrowing in `/admin` must turn the privacy test red. A test that stays green when you sabotage its subject is not a guarantee, it is decoration.

## Things that will get a patch turned down

- **Adding an external request to a page.** No CDN, no web font, no analytics, no favicon file. The CSP (`default-src 'none'`) will block it anyway, so it will simply not work — but the reason matters more than the mechanism: these pages open in the moment somebody is reaching for a distraction, often on a bad connection, and one blocking round trip ends the product. There is exactly one exception in the codebase, the Turnstile widget on `/register`, and it is not a precedent: `/register` is not on the interception path, the widget is optional, and the CSP is widened by one origin on that one page (see `TURNSTILE_ORIGIN` in `src/ui/layout.ts`). A second exception needs the same standard of argument.
- **"Balancing" the breathing page's buttons.** 「算了」 appears first, alone, and is visually loud; 「继续」 arrives 800ms later as a small underlined link. The asymmetry *is* the feature. So is the absence of a numeric countdown — a number invites you to stare at it and tick it down, which is the opposite of the point.
- **Widening what `/admin` can show.** `AdminRow` is the ceiling by construction. See [SECURITY.md](SECURITY.md#what-the-owner-cannot-see).
- **Making a page depend on JavaScript that does not need to.** `/review`, `/settings` and the account pages are plain HTML forms with POST/redirect/GET, no fetch, no framework. Only the breathing page and the two probe pages have any script at all, and each has a reason.
- **Softening honest copy.** The pages tell people that a candidate scheme is unverified, that losing both credentials means losing the account, and that the token can be decrypted with the key. Those sentences are load-bearing.
- **Anything that could lock a user out of their own phone.** The whole system fails open. Keep it that way.

## Style

- TypeScript, `strict`, `noUncheckedIndexedAccess`. No runtime dependencies — additions to `dependencies` need a real argument.
- Comments explain *why*, and specifically why an obvious-looking alternative is wrong. Several modules would be rewritten into a bug within a month without theirs; that is the bar for adding one.
- UI copy is bilingual. Chinese stays the source text you write inline, wrapped in `t('中文原文')` (or `msg(...)` for a string built outside a page); `src/i18n/en.ts` is the English dictionary, keyed by that same Chinese string. `test/i18n.test.ts`'s guards fail the build if a `t()`/`msg()` source has no English entry, if Chinese leaks into a converted file outside `t()`/`msg()`, or if a translation drops a `{placeholder}` or picks up Chinese characters of its own. Every page under `src/ui/` is converted, `/setup` included; `src/api/admin.ts` is the one exclusion, and it is an owner-only tool with no reader to translate for. Comments and documentation are English.
- Commit messages: `type(scope): description`.
