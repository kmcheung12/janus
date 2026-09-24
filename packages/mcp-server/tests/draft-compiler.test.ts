import { describe, expect, it } from 'vitest'
import { compileDefinition } from '../src/control/draft-compiler.js'
import type { DefinitionProposal, RecipeStep, ToolDraft } from '../src/contracts/types.js'

const PRINCIPAL = 'client_1'

function draft(overrides: Partial<ToolDraft> = {}): ToolDraft {
  return {
    id: 'draft_1', revision: 1, principalId: PRINCIPAL,
    browserSessionId: 'browser_1', pageId: '00112233445566778899aabbccddeeff', documentId: 'doc_1',
    applicability: { origin: 'https://shop.example', pathnamePrefix: '/search' },
    status: 'pending',
    createdAt: 0, expiresAt: Date.now() + 60_000,
    bindings: [
      { kind: 'control', id: 'b_q', selector: '#q', control: 'text' },
      { kind: 'control', id: 'b_form', selector: '#search', control: 'form' },
      { kind: 'control', id: 'b_res', selector: '#results', control: 'text' },
      { kind: 'dom_result', id: 'b_out', targetId: 'b_res', read: 'text' },
    ],
    slots: [{ id: 'p1', constraint: { type: 'string', maxLength: 100 }, sensitive: false }],
    candidateSteps: [
      { op: 'set_field', id: 's1', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
      { op: 'submit_form', id: 's2', targetId: 'b_form' },
      { op: 'extract_result', id: 's3', fields: [{ name: 'results', bindingId: 'b_out' }] },
    ],
    requiredStepIds: ['s1', 's2', 's3'],
    evidence: [],
    ...overrides,
  }
}

function proposal(overrides: Partial<DefinitionProposal> = {}): DefinitionProposal {
  return {
    name: 'search_products',
    description: 'Search the catalogue',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', maxLength: 50 } },
      required: ['query'],
      additionalProperties: false,
    },
    parameters: [{ slotId: 'p1', name: 'query' }],
    stepIds: ['s1', 's2', 's3'],
    ...overrides,
  }
}

function compile(d = draft(), p = proposal(), principalId = PRINCIPAL, draftRevision = 1) {
  return compileDefinition({ draft: d, draftRevision, proposal: p, principalId })
}

describe('happy path', () => {
  it('compiles a valid proposal', () => {
    const result = compile()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.name).toBe('search_products')
    expect(result.definition.definitionRevision).toBe(1)
  })

  it('copies bindings and steps from the draft, not the proposal', () => {
    const result = compile()
    if (!result.ok) throw new Error('expected success')
    // The selector in the compiled definition came from the draft.
    expect(result.definition.bindings).toEqual(draft().bindings)
    expect(result.definition.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('preserves authored step order regardless of submitted order', () => {
    const result = compile(draft(), proposal({ stepIds: ['s3', 's1', 's2'] }))
    if (!result.ok) throw new Error('expected success')
    expect(result.definition.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('classifies a writing recipe as consequential', () => {
    const result = compile()
    if (!result.ok) throw new Error('expected success')
    // Anything that submits defaults to consequential, not read-only.
    expect(result.definition.annotations).toEqual({ readOnly: false, consequential: true })
  })

  it('assigns identity and ownership in trusted code', () => {
    const result = compile()
    if (!result.ok) throw new Error('expected success')
    expect(result.definition.definitionId).toMatch(/^def_[0-9a-f]{32}$/)
    expect(result.definition.principalId).toBe(PRINCIPAL)
    expect(result.definition.sourceDraft).toEqual({ id: 'draft_1', revision: 1 })
  })
})

describe('draft resolution', () => {
  it('rejects another principal\'s draft as stale, not forbidden', () => {
    // Confirming the draft exists would itself leak information.
    const result = compile(draft(), proposal(), 'client_other')
    expect(result).toMatchObject({ ok: false, failure: { code: 'DRAFT_STALE' } })
  })

  it('rejects a stale draft revision', () => {
    const result = compile(draft({ revision: 4 }), proposal(), PRINCIPAL, 1)
    expect(result).toMatchObject({ ok: false, failure: { code: 'DRAFT_STALE' } })
  })

  it('rejects an expired draft', () => {
    const result = compile(draft({ expiresAt: Date.now() - 1 }))
    expect(result).toMatchObject({ ok: false, failure: { code: 'DRAFT_EXPIRED' } })
  })
})

describe('step selection', () => {
  it('rejects a step ID from no draft', () => {
    const result = compile(draft(), proposal({ stepIds: ['s1', 's2', 's3', 's_injected'] }))
    expect(result).toMatchObject({ ok: false, failure: { code: 'INVALID_DEFINITION' } })
  })

  it('rejects dropping a required step', () => {
    const result = compile(draft(), proposal({ stepIds: ['s1', 's3'] }))
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a duplicated step selection', () => {
    const result = compile(draft(), proposal({ stepIds: ['s1', 's1', 's2', 's3'] }))
    expect(result).toMatchObject({ ok: false })
  })
})

describe('parameter mapping', () => {
  it('rejects a schema property with no parameter', () => {
    const result = compile(draft(), proposal({
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, secret: { type: 'string' } },
        required: ['query', 'secret'],
        additionalProperties: false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects an unknown slot', () => {
    const result = compile(draft(), proposal({ parameters: [{ slotId: 'p_ghost', name: 'query' }] }))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses to expose a sensitive slot', () => {
    // A password field must never become a tool parameter.
    const withSecret = draft({
      slots: [
        { id: 'p1', constraint: { type: 'string' }, sensitive: false },
        { id: 'p_pw', constraint: { type: 'string' }, sensitive: true },
      ],
    })
    const result = compile(withSecret, proposal({
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' }, password: { type: 'string' } },
        required: ['query', 'password'],
        additionalProperties: false,
      },
      parameters: [{ slotId: 'p1', name: 'query' }, { slotId: 'p_pw', name: 'password' }],
    }))
    expect(result).toMatchObject({ ok: false, failure: { message: expect.stringMatching(/sensitive/) } })
  })

  it('rejects an unmapped slot that a step consumes', () => {
    const result = compile(draft(), proposal({
      inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      parameters: [],
    }))
    expect(result).toMatchObject({ ok: false, failure: { message: expect.stringMatching(/unmapped/) } })
  })

  it('rejects an open input schema', () => {
    const result = compile(draft(), proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'string' } },
        required: ['query'], additionalProperties: true as unknown as false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects an optional property in v1', () => {
    const result = compile(draft(), proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'string' } },
        required: [], additionalProperties: false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })
})

describe('constraint narrowing', () => {
  it('allows narrowing the captured constraint', () => {
    expect(compile(draft(), proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'string', maxLength: 10 } },
        required: ['query'], additionalProperties: false,
      },
    })).ok).toBe(true)
  })

  it('rejects widening maxLength beyond what was captured', () => {
    const result = compile(draft(), proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'string', maxLength: 99999 } },
        required: ['query'], additionalProperties: false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })

  it('rejects a type change', () => {
    const result = compile(draft(), proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'number' } },
        required: ['query'], additionalProperties: false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })

  it('allows integer to narrow number', () => {
    const numeric = draft({ slots: [{ id: 'p1', constraint: { type: 'number' }, sensitive: false }] })
    expect(compile(numeric, proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'integer' } },
        required: ['query'], additionalProperties: false,
      },
    })).ok).toBe(true)
  })

  it('rejects an enum value outside the captured options', () => {
    const withEnum = draft({
      slots: [{ id: 'p1', constraint: { type: 'string', enum: ['a', 'b'] }, sensitive: false }],
    })
    const result = compile(withEnum, proposal({
      inputSchema: {
        type: 'object', properties: { query: { type: 'string', enum: ['a', 'c'] } },
        required: ['query'], additionalProperties: false,
      },
    }))
    expect(result).toMatchObject({ ok: false })
  })
})

describe('step reference kinds', () => {
  const withStep = (steps: RecipeStep[], required = steps.map((s) => s.id)) =>
    compile(draft({ candidateSteps: steps, requiredStepIds: required }), proposal({ stepIds: steps.map((s) => s.id) }))

  it('rejects set_field aimed at a form', () => {
    expect(withStep([
      { op: 'set_field', id: 's1', targetId: 'b_form', value: { kind: 'slot', slotId: 'p1' } },
      { op: 'extract_result', id: 's2', fields: [{ name: 'r', bindingId: 'b_out' }] },
    ])).toMatchObject({ ok: false })
  })

  it('rejects submit_form aimed at a text control', () => {
    expect(withStep([
      { op: 'set_field', id: 's1', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
      { op: 'submit_form', id: 's2', targetId: 'b_q' },
      { op: 'extract_result', id: 's3', fields: [{ name: 'r', bindingId: 'b_out' }] },
    ])).toMatchObject({ ok: false })
  })

  it('requires exactly one extract_result, as the final step', () => {
    expect(withStep([
      { op: 'extract_result', id: 's1', fields: [{ name: 'r', bindingId: 'b_out' }] },
      { op: 'submit_form', id: 's2', targetId: 'b_form' },
    ])).toMatchObject({ ok: false })

    expect(withStep([
      { op: 'set_field', id: 's1', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
      { op: 'submit_form', id: 's2', targetId: 'b_form' },
    ])).toMatchObject({ ok: false })
  })

  it('rejects duplicate output field names', () => {
    expect(withStep([
      { op: 'set_field', id: 's1', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
      {
        op: 'extract_result', id: 's2',
        fields: [{ name: 'r', bindingId: 'b_out' }, { name: 'r', bindingId: 'b_out' }],
      },
    ])).toMatchObject({ ok: false })
  })

  it('rejects a wait on an observer that never started', () => {
    expect(withStep([
      { op: 'await_condition', id: 's1', timeoutMs: 1000, condition: { kind: 'response', observerStepId: 's_ghost' } },
      { op: 'extract_result', id: 's2', fields: [{ name: 'r', bindingId: 'b_out' }] },
    ])).toMatchObject({ ok: false })
  })

  it('rejects reading a response that was never awaited', () => {
    // Reading before the wait would race the response.
    const d = draft({
      bindings: [
        ...draft().bindings,
        { kind: 'response', id: 'b_resp', origin: 'https://shop.example', pathname: '/api', method: 'GET', statuses: [200], match: [] },
        { kind: 'json_result', id: 'b_json', observerStepId: 's1', pointer: '/items' },
      ],
      candidateSteps: [
        { op: 'observe_response', id: 's1', responseBindingId: 'b_resp' },
        { op: 'submit_form', id: 's2', targetId: 'b_form' },
        { op: 'extract_result', id: 's3', fields: [{ name: 'items', bindingId: 'b_json' }] },
      ],
      requiredStepIds: ['s1', 's2', 's3'],
    })
    expect(compile(d, proposal({ stepIds: ['s1', 's2', 's3'] }))).toMatchObject({ ok: false })
  })

  it('accepts observe, wait, then read', () => {
    const d = draft({
      bindings: [
        ...draft().bindings,
        { kind: 'response', id: 'b_resp', origin: 'https://shop.example', pathname: '/api', method: 'GET', statuses: [200], match: [] },
        { kind: 'json_result', id: 'b_json', observerStepId: 's1', pointer: '/items' },
      ],
      candidateSteps: [
        { op: 'observe_response', id: 's1', responseBindingId: 'b_resp' },
        { op: 'set_field', id: 's2', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
        { op: 'submit_form', id: 's3', targetId: 'b_form' },
        { op: 'await_condition', id: 's4', timeoutMs: 3000, condition: { kind: 'response', observerStepId: 's1' } },
        { op: 'extract_result', id: 's5', fields: [{ name: 'items', bindingId: 'b_json' }] },
      ],
      requiredStepIds: ['s1', 's2', 's3', 's4', 's5'],
    })
    expect(compile(d, proposal({ stepIds: ['s1', 's2', 's3', 's4', 's5'] })).ok).toBe(true)
  })

  it('rejects a wait outside the permitted range', () => {
    expect(withStep([
      { op: 'await_condition', id: 's1', timeoutMs: 999_999, condition: { kind: 'dom', targetId: 'b_res', state: 'visible' } },
      { op: 'extract_result', id: 's2', fields: [{ name: 'r', bindingId: 'b_out' }] },
    ])).toMatchObject({ ok: false })
  })
})

describe('applicability', () => {
  it.each([
    ['https://user:pw@shop.example', 'credentials'],
    ['ftp://shop.example', 'protocol'],
    ['https://shop.example/path', 'not a bare origin'],
  ])('rejects origin %s', (origin) => {
    expect(compile(draft({ applicability: { origin, pathnamePrefix: '/' } }))).toMatchObject({ ok: false })
  })

  it('rejects a path prefix that is not absolute', () => {
    expect(compile(draft({
      applicability: { origin: 'https://shop.example', pathnamePrefix: 'search' },
    }))).toMatchObject({ ok: false })
  })
})
