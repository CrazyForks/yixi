import { describe, expect, it } from 'vitest'
import { SCHEME_FIELD_CSS, SCHEME_FIELD_JS, schemeField } from '../src/ui/schemefield'

describe('schemeField()', () => {
  const html = schemeField({ name: 'target', value: 'a<b://', ns: 'g7', label: '跳去哪', labelFor: 'target_label' })

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
    const opt = schemeField({ name: 'target', value: '', ns: 'g1', label: 'x', labelFor: 'target_label', required: false })
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

describe('SCHEME_FIELD_CSS', () => {
  it('carries the probe and picker styles the pages no longer define themselves', () => {
    for (const sel of ['.withtry', 'button.try', 'details.pickwrap', '.cdacts', '.hint.ex']) {
      expect(SCHEME_FIELD_CSS).toContain(sel)
    }
  })
})
