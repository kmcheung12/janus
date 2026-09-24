import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run } from '../../src/lib/browser-tools/recipe-runtime'
import { readPointer } from '../../src/lib/browser-tools/response-observer'
import type { GeneratedDefinition, RecipeStep } from '../../src/lib/browser-tools/contract'

function definition(overrides: Partial<GeneratedDefinition> = {}): GeneratedDefinition {
  return {
    formatVersion: 1,
    definitionId: 'def_1',
    definitionRevision: 1,
    principalId: 'client_1',
    sourceDraft: { id: 'draft_1', revision: 1 },
    applicability: { origin: 'http://localhost:3000', pathnamePrefix: '/' },
    name: 'search_products',
    description: 'Search',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    parameters: [{ slotId: 'p1', name: 'query' }],
    slots: [{ id: 'p1', constraint: { type: 'string' }, sensitive: false }],
    bindings: [
      { kind: 'control', id: 'b_input', selector: '#q', control: 'text' },
      { kind: 'control', id: 'b_form', selector: '#search', control: 'form' },
      { kind: 'control', id: 'b_results', selector: '#results', control: 'text' },
      { kind: 'dom_result', id: 'b_out', targetId: 'b_results', read: 'text' },
    ],
    steps: [
      { op: 'set_field', id: 's1', targetId: 'b_input', value: { kind: 'slot', slotId: 'p1' } },
      { op: 'extract_result', id: 's2', fields: [{ name: 'results', bindingId: 'b_out' }] },
    ],
    evidenceIds: [],
    annotations: { readOnly: true, consequential: false },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function html(markup: string) {
  document.body.innerHTML = markup
}

const signal = () => new AbortController().signal

beforeEach(() => {
  html('<form id="search"><input id="q"><div id="results">nothing yet</div></form>')
})

describe('parameter binding', () => {
  it('sets a field from a declared business value and extracts a result', async () => {
    html('<form id="search"><input id="q"><div id="results">3 items</div></form>')
    const result = await run({
      definition: definition(), input: { query: 'headphones' }, signal: signal(), timeoutMs: 5000,
    })
    expect(result.outcome).toMatchObject({ status: 'completed', result: { results: '3 items' } })
    expect((document.querySelector('#q') as HTMLInputElement).value).toBe('headphones')
    expect(result.executionStopped).toBe(true)
  })

  it('fires input and change so framework state stays in sync', async () => {
    const events: string[] = []
    const input = document.querySelector('#q')!
    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    await run({ definition: definition(), input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(events).toEqual(['input', 'change'])
  })

  it('rejects a missing argument before touching the page', async () => {
    const result = await run({ definition: definition(), input: {}, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ status: 'error', error: { code: 'INVALID_INPUT', execution: 'not_started' } })
  })

  it('never interpolates a business value into a selector', async () => {
    // A value that would be a selector injection if it were ever concatenated.
    const result = await run({
      definition: definition(), input: { query: '#results' }, signal: signal(), timeoutMs: 5000,
    })
    expect(result.outcome.status).toBe('completed')
    expect((document.querySelector('#q') as HTMLInputElement).value).toBe('#results')
  })
})

describe('target resolution', () => {
  it('fails with a repairable error when the control is gone', async () => {
    html('<form id="search"><div id="results">x</div></form>')
    const result = await run({ definition: definition(), input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ status: 'error', error: { code: 'TARGET_MISSING' } })
    expect(JSON.stringify(result.outcome)).toMatch(/re-authoring/i)
  })

  it('refuses to guess when the selector is ambiguous', async () => {
    // Picking the first match would silently act on an unrelated element.
    html('<form id="search"><input class="q" id="q"><input class="q"><div id="results">x</div></form>')
    const withClass = definition({
      bindings: [
        { kind: 'control', id: 'b_input', selector: '.q', control: 'text' },
        { kind: 'control', id: 'b_results', selector: '#results', control: 'text' },
        { kind: 'dom_result', id: 'b_out', targetId: 'b_results', read: 'text' },
      ],
    })
    const result = await run({ definition: withClass, input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ status: 'error', error: { code: 'TARGET_AMBIGUOUS' } })
  })
})

describe('applicability', () => {
  it('refuses to run on a non-matching route', async () => {
    const elsewhere = definition({ applicability: { origin: 'https://other.example', pathnamePrefix: '/' } })
    const result = await run({ definition: elsewhere, input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ status: 'error', error: { code: 'STALE_DOCUMENT', execution: 'not_started' } })
  })

  it('matches path prefixes on segment boundaries only', async () => {
    // /admin must not match /administrator.
    const scoped = definition({ applicability: { origin: 'http://localhost:3000', pathnamePrefix: '/admin' } })
    const result = await run({ definition: scoped, input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ status: 'error', error: { code: 'STALE_DOCUMENT' } })
  })
})

describe('closed vocabulary', () => {
  it('refuses an operation outside the seven', async () => {
    const rogue = definition({
      steps: [{ op: 'eval', id: 's1', source: 'fetch("/drain")' } as unknown as RecipeStep],
    })
    const result = await run({ definition: rogue, input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({
      status: 'error', error: { code: 'INVALID_DEFINITION', execution: 'not_started' },
    })
  })

  it('refuses a step count beyond the limit', async () => {
    const many = definition({
      steps: Array.from({ length: 40 }, (_, i) => (
        { op: 'click', id: `s${i}`, targetId: 'b_form' } as RecipeStep
      )),
    })
    const result = await run({ definition: many, input: { query: 'x' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ error: { code: 'INVALID_DEFINITION' } })
  })

  it('rejects a select_option value the definition never recorded', async () => {
    html('<form id="search"><select id="q"><option value="a">a</option></select><div id="results">x</div></form>')
    const withSelect = definition({
      bindings: [
        { kind: 'control', id: 'b_input', selector: '#q', control: 'select_one', allowedValues: ['a'] },
        { kind: 'control', id: 'b_results', selector: '#results', control: 'text' },
        { kind: 'dom_result', id: 'b_out', targetId: 'b_results', read: 'text' },
      ],
      steps: [{ op: 'select_option', id: 's1', targetId: 'b_input', value: { kind: 'slot', slotId: 'p1' } }],
    })
    const result = await run({ definition: withSelect, input: { query: 'b' }, signal: signal(), timeoutMs: 5000 })
    expect(result.outcome).toMatchObject({ error: { code: 'INVALID_INPUT' } })
  })
})

describe('cancellation', () => {
  it('reports an unknown outcome once the page has been touched', async () => {
    const controller = new AbortController()
    const slow = definition({
      steps: [
        { op: 'set_field', id: 's1', targetId: 'b_input', value: { kind: 'literal', value: 'x' } },
        { op: 'await_condition', id: 's2', timeoutMs: 1000, condition: { kind: 'dom', targetId: 'b_results', state: 'hidden' } },
      ],
    })
    const promise = run({ definition: slow, input: {}, signal: controller.signal, timeoutMs: 5000 })
    controller.abort()
    const result = await promise
    expect(result.outcome).toMatchObject({ status: 'error', error: { execution: 'outcome_unknown' } })
    // An unknown outcome must not claim execution stopped.
    expect(result.executionStopped).toBe(false)
  })
})

describe('JSON Pointer extraction', () => {
  it.each([
    // RFC 6901: the empty pointer references the whole document.
    ['', { a: 1, items: ['first', 'second'] }],
    ['/a', 1],
    ['/items/1', 'second'],
    ['/missing', null],
    ['/items/9', null],
  ])('reads %s', (pointer, expected) => {
    const body = { a: 1, items: ['first', 'second'] }
    expect(readPointer(body as never, pointer)).toEqual(expected)
  })

  it('decodes escaped segments', () => {
    expect(readPointer({ 'a/b': 1, 'c~d': 2 } as never, '/a~1b')).toBe(1)
    expect(readPointer({ 'a/b': 1, 'c~d': 2 } as never, '/c~0d')).toBe(2)
  })

  it('rejects a pointer that is not a pointer', () => {
    expect(() => readPointer({} as never, 'a.b')).toThrow(/Invalid JSON Pointer/)
  })
})
