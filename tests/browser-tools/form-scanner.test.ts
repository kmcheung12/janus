import { beforeEach, describe, expect, it } from 'vitest'
import { scanForm } from '../../src/lib/browser-tools/form-scanner'

function scan(markup: string) {
  document.body.innerHTML = markup
  const form = document.querySelector('form') as HTMLFormElement
  return scanForm({
    form,
    principalId: 'client_1',
    browserSessionId: 'browser_1',
    pageId: '0'.repeat(32),
    documentId: 'doc_1',
  })
}

beforeEach(() => { document.body.innerHTML = '' })

describe('control extraction', () => {
  it('creates a binding, slot and step per supported control', () => {
    const { draft } = scan(`
      <form id="search"><input id="q" type="text" name="query"></form>
      <div id="results">x</div>
    `)
    expect(draft.slots.filter((s) => !s.sensitive)).toHaveLength(1)
    expect(draft.candidateSteps[0]).toMatchObject({ op: 'set_field' })
    expect(draft.bindings.some((b) => b.kind === 'control' && b.selector === '#q')).toBe(true)
  })

  it('records a select with its allowed values', () => {
    const { draft } = scan(`
      <form id="f"><select id="cat"><option value="a">A</option><option value="b">B</option></select></form>
    `)
    const binding = draft.bindings.find((b) => b.kind === 'control' && b.control === 'select_one')
    expect(binding).toMatchObject({ allowedValues: ['a', 'b'] })
    expect(draft.candidateSteps[0]).toMatchObject({ op: 'select_option' })
  })

  it('derives constraints from the markup', () => {
    const { draft } = scan(`
      <form id="f"><input id="n" type="number" min="1" max="10"></form>
    `)
    expect(draft.slots[0].constraint).toMatchObject({ type: 'number', minimum: 1, maximum: 10 })
  })

  it('caps a string constraint at the hard limit', () => {
    const { draft } = scan('<form id="f"><input id="t" type="text"></form>')
    expect((draft.slots[0].constraint as { maxLength: number }).maxLength).toBeLessThanOrEqual(4096)
  })
})

describe('sensitive fields', () => {
  it('marks a password as sensitive and captures no value', () => {
    const { draft, unsupported } = scan(`
      <form id="login">
        <input id="u" type="text">
        <input id="p" type="password" value="hunter2">
      </form>
    `)
    // Present as a sensitive slot so the compiler can refuse it by name, with
    // no binding and no value.
    expect(draft.slots.some((s) => s.sensitive)).toBe(true)
    expect(draft.bindings.some((b) => b.kind === 'control' && b.selector === '#p')).toBe(false)
    expect(JSON.stringify(draft)).not.toContain('hunter2')
    expect(unsupported.some((u) => u.reason.includes('never exposed'))).toBe(true)
  })

  it('excludes file and hidden inputs', () => {
    const { draft } = scan(`
      <form id="f">
        <input id="a" type="file">
        <input id="b" type="hidden" value="csrf-token">
      </form>
    `)
    expect(draft.bindings.filter((b) => b.kind === 'control' && b.control !== 'form')).toHaveLength(0)
    expect(JSON.stringify(draft)).not.toContain('csrf-token')
  })
})

describe('unsupported controls', () => {
  it('surfaces a textarea rather than silently dropping it', () => {
    const { unsupported } = scan('<form id="f"><textarea id="t"></textarea></form>')
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0].reason).toMatch(/rich text/)
  })

  it('disambiguates two otherwise identical controls', () => {
    // resolveSelector falls back to nth-child, so both are still addressable.
    // What matters is that each selector resolves to exactly one element —
    // an ambiguous one would fail at execution time instead.
    const { draft } = scan('<form id="f"><input type="text"><input type="text"></form>')
    const selectors = draft.bindings
      .filter((b) => b.kind === 'control' && b.control === 'text')
      .map((b) => (b as { selector: string }).selector)

    expect(selectors).toHaveLength(2)
    expect(new Set(selectors).size).toBe(2)
    for (const selector of selectors) {
      expect(document.querySelectorAll(selector)).toHaveLength(1)
    }
  })
})

describe('recipe shape', () => {
  it('ends with exactly one extract_result', () => {
    const { draft } = scan(`
      <form id="f"><input id="q" type="text"></form><div id="results">x</div>
    `)
    const extracts = draft.candidateSteps.filter((s) => s.op === 'extract_result')
    expect(extracts).toHaveLength(1)
    expect(draft.candidateSteps.at(-1)?.op).toBe('extract_result')
  })

  it('submits before extracting', () => {
    const { draft } = scan(`
      <form id="f"><input id="q" type="text"></form><div id="results">x</div>
    `)
    const ops = draft.candidateSteps.map((s) => s.op)
    expect(ops.indexOf('submit_form')).toBeLessThan(ops.indexOf('extract_result'))
  })

  it('marks every candidate step required in M2', () => {
    const { draft } = scan('<form id="f"><input id="q" type="text"></form>')
    expect(draft.requiredStepIds).toEqual(draft.candidateSteps.map((s) => s.id))
  })

  it('still produces a valid recipe with no result region', () => {
    const { draft } = scan('<form id="f"><input id="q" type="text"></form>')
    expect(draft.candidateSteps.at(-1)?.op).toBe('extract_result')
  })
})

describe('draft metadata', () => {
  it('scopes applicability to this origin and path', () => {
    const { draft } = scan('<form id="f"><input id="q" type="text"></form>')
    expect(draft.applicability.origin).toBe(window.location.origin)
    expect(draft.applicability.pathnamePrefix).toBe(window.location.pathname)
  })

  it('sets an expiry so a stale draft cannot be authored later', () => {
    const { draft } = scan('<form id="f"><input id="q" type="text"></form>')
    expect(draft.expiresAt).toBeGreaterThan(draft.createdAt)
    expect(draft.status).toBe('pending')
  })

  it('produces an ID matching the contract pattern', () => {
    const { draft } = scan('<form id="f"><input id="q" type="text"></form>')
    expect(draft.id).toMatch(/^[A-Za-z0-9_-]{1,96}$/)
  })
})
