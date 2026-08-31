// /probe — merged into /lookup, kept as a redirect.
//
// Testing a scheme on the actual phone was never a separate job from finding one
// to test: the reader had to copy a string from 「候选」 to 「实测」 and tab back
// when it failed, and the split cost the nav a sixth tab that a 375px phone
// could not show. Everything this page did — one big button per configured app,
// a box for a string that is not saved anywhere yet, and the jump written the one
// way Safari honours — now lives in the lower half of /lookup.
//
// The route stays because three kinds of caller still point at it: the repo's
// README and shortcut/README, `/review`'s own three-tab header, and whatever
// bookmarks exist on the phone this was built for. A 404 for any of those would
// read as "the tool broke".
//
// 302 rather than 301 on purpose. A 301 is cached by Safari more or less
// forever, so it would outlive any future decision to split these pages again;
// the redirect costs one round trip on a path nobody navigates deliberately.
//
// The Location carries no fragment of its own, which is what makes an old
// `/probe#app-xhs` bookmark still work: per RFC 7231 the browser re-applies the
// original fragment, and /lookup gives every configured app that same id.

import type { Env, User } from '../types'

export async function renderProbe(_env: Env, _user: User): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: { location: '/lookup', 'cache-control': 'no-store' },
  })
}
