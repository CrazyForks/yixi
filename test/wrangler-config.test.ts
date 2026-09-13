// SNAPSHOT_CRON in src/snapshot.ts and the `crons` array in wrangler.toml are
// two copies of the same fact — the deployed trigger and the constant the
// code reasons about. Nothing enforces they match; this test reads the real
// file so a hand-edit to one side alone goes red instead of silently
// deploying a cron that never fires the code that expects it.
//
// vitest-pool-workers runs this file inside workerd, where `node:fs` is not
// implemented (readFileSync throws "not yet implemented in Workers"), so the
// file is pulled in as a raw Vite asset import instead — a plain regex over
// its text, not a TOML parser, since nothing else here needs one.

import { describe, expect, it } from 'vitest'
import raw from '../wrangler.toml?raw'
import { SNAPSHOT_CRON } from '../src/snapshot'

describe('wrangler.toml crons', () => {
  it('declares both the noon trim and SNAPSHOT_CRON', () => {
    const m = raw.match(/crons\s*=\s*\[([^\]]*)\]/)
    expect(m, 'no crons = [...] array found').toBeTruthy()
    const crons = m![1]!.split(',').map((s: string) => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
    expect(crons).toContain('0 4 * * *')
    expect(crons).toContain(SNAPSHOT_CRON)
    expect(SNAPSHOT_CRON).toBe('0 16 * * *')
  })
})
