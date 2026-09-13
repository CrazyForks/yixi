import { describe, expect, it } from 'vitest'
import { SCHEME_FIELD_CSS, schemeFieldJs, schemeField } from '../src/ui/schemefield'
import { translator } from '../src/i18n'
import { EN } from '../src/i18n/en'

// The field and its script are built per request now, so that every string
// they render comes from the caller's translator. Chinese is what this file
// asserts on, so it builds the Chinese one.
const t = translator('zh')
const SCHEME_FIELD_JS = schemeFieldJs(t)

describe('schemeField()', () => {
  const html = schemeField({ name: 'target', value: 'a<b://', ns: 'g7', label: '跳去哪', labelFor: 'target_label', t })

  it('names the input as asked and escapes the value', () => {
    expect(html).toContain('name="target"')
    expect(html).toContain('value="a&lt;b://"')
    expect(html).not.toContain('a<b://')
  })

  it('namespaces the id and points the label at it', () => {
    expect(html).toContain('id="f-g7-target"')
    expect(html).toContain('for="f-g7-target"')
  })

  it('tells the script which sibling input takes the app name', () => {
    expect(html).toContain('data-label-for="target_label"')
  })

  it('can be optional, for a goal that has nothing to jump to', () => {
    const opt = schemeField({ name: 'target', value: '', ns: 'g1', label: 'x', labelFor: 'target_label', required: false, t })
    expect(opt).not.toMatch(/<input[^>]*name="target"[^>]*\brequired\b/)
    expect(html).toMatch(/<input[^>]*name="target"[^>]*\brequired\b/)
  })

  it('keeps the probe button and the folded picker', () => {
    expect(html).toContain('data-try')
    expect(html).toContain('class="pq"')
    expect(html).toContain('class="pgo"')
  })
})

describe('SCHEME_FIELD_JS', () => {
  it('jumps in one place, synchronously', () => {
    expect(SCHEME_FIELD_JS.match(/location\.href\s*=/g)).toHaveLength(1)
    expect(SCHEME_FIELD_JS).toContain('function jump(scheme)')
  })

  it('finds the box by the field it sits in, not by a hard-coded name', () => {
    // settings 的 input 叫 scheme，goals 的叫 target；脚本对两者都要工作。
    expect(SCHEME_FIELD_JS).not.toContain('[name=scheme]')
    expect(SCHEME_FIELD_JS).toContain("querySelector('input.sc')")
  })

  it('saves every named input in the draft rather than a fixed list', () => {
    expect(SCHEME_FIELD_JS).toContain('function saveDraft(form)')
    expect(SCHEME_FIELD_JS).not.toContain('wait_seconds')
  })
})

describe('the injected TXT payload', () => {
  it('cannot close the script element it is written into, whatever a translation says', () => {
    // The strings come from src/i18n/en.ts rather than from a user — but they
    // are written by whoever adds a language next, they land in a classic
    // <script> block, and `</script>` inside a JavaScript string still ends
    // that element. So the payload is escaped rather than trusted.
    const key = '先填一个 scheme。'
    const before = EN[key]
    EN[key] = '</script><script>alert(1)</script>'
    try {
      const js = schemeFieldJs(translator('en'))
      expect(js).not.toContain('</script>')
      expect(js).toContain('\\u003c/script>')
    } finally {
      if (before === undefined) delete EN[key]
      else EN[key] = before
    }
  })
})

describe('SCHEME_FIELD_CSS', () => {
  it('carries the probe and picker styles the pages no longer define themselves', () => {
    for (const sel of ['.withtry', 'button.try', 'details.pickwrap', '.cdacts', '.hint.ex']) {
      expect(SCHEME_FIELD_CSS).toContain(sel)
    }
  })
})

/**
 * Strips comments so assertions about the code are about the code, not about a
 * comment that happens to contain the same words. Mirrors codeOnly() in
 * test/settings.test.ts rather than inventing a second technique.
 */
function codeOnly(js: string): string {
  return js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The body of a named function or of the first listener for an event. Mirrors bodyOf() in test/settings.test.ts. */
function bodyOf(code: string, opener: string): string {
  const start = code.indexOf(opener)
  expect(start, `not found: ${opener}`).toBeGreaterThan(-1)
  const i = code.indexOf('{', start)
  expect(i, `no brace after ${opener}`).toBeGreaterThan(-1)
  let depth = 0
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++
    else if (code[j] === '}') {
      depth--
      if (depth === 0) return code.slice(i + 1, j)
    }
  }
  throw new Error(`unbalanced braces after ${opener}`)
}

describe('the click-to-jump path stays synchronous, wherever the field is rendered', () => {
  it('keeps jump() and every click-handler branch that calls it free of await, fetch, setTimeout and .then', () => {
    // The old version of this guard lived only in test/settings.test.ts and
    // ran against the /settings page's rendered script — which happens to be
    // SCHEME_FIELD_JS verbatim, but nothing pinned that. /goals renders the
    // very same constant and had no guard of its own. Asserting on the
    // constant directly covers both pages by construction.
    const code = codeOnly(SCHEME_FIELD_JS)
    const jump = bodyOf(code, 'function jump(scheme)')
    const click = bodyOf(code, "document.addEventListener('click'")
    for (const [where, body] of [
      ['jump()', jump],
      ['click handler', click],
    ] as const) {
      expect(body, `${where}: await`).not.toContain('await')
      expect(body, `${where}: fetch`).not.toContain('fetch(')
      expect(body, `${where}: setTimeout`).not.toContain('setTimeout')
      expect(body, `${where}: promise chain`).not.toContain('.then(')
    }
    // And the click handler does call jump( at least twice — 「试跳」 and
    // 「用这个」's sibling ctry path — so the body above is not vacuously clean.
    expect(click.match(/\bjump\(/g)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })
})
