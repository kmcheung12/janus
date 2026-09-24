import { describe, expect, it } from 'vitest'
import { RECIPE_OPS, M1_MESSAGE_TYPES, M2_MESSAGE_TYPES } from '../src/contracts/types.js'
import { contractSchema, validateAs, validateControlMessage } from '../src/contracts/validate.js'

function helloAck(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    connectionId: 'connection_1',
    type: 'hello_ack',
    role: 'executor',
    heartbeatIntervalMs: 15000,
    inactivityTimeoutMs: 45000,
    authoringPrincipals: [],
    ...overrides,
  }
}

describe('schema document', () => {
  it('validates ControlMessage at its root', () => {
    const schema = contractSchema()
    expect(schema.$id).toBe('urn:janus:webmcp-contracts:v1')
    expect(schema.$ref).toBe('#/definitions/ControlMessage')
  })

  it('declares exactly the seven recipe operations in the TypeScript union', () => {
    const schema = contractSchema() as { definitions: Record<string, { oneOf?: unknown[] }> }
    const variants = schema.definitions.RecipeStep.oneOf ?? []
    expect(variants).toHaveLength(RECIPE_OPS.length)
    expect(RECIPE_OPS).toHaveLength(7)
  })

  it('covers every message type in one of the milestone gates', () => {
    const all = [...M1_MESSAGE_TYPES, ...M2_MESSAGE_TYPES]
    expect(new Set(all).size).toBe(all.length)
    expect(M1_MESSAGE_TYPES).toHaveLength(9)
    expect(M2_MESSAGE_TYPES).toHaveLength(4)
  })
})

describe('control message validation', () => {
  it('accepts a well-formed message', () => {
    const result = validateControlMessage(helloAck())
    expect(result.valid).toBe(true)
  })

  it('rejects an unknown message type', () => {
    expect(validateControlMessage(helloAck({ type: 'execute_script' })).valid).toBe(false)
  })

  it('rejects an unknown property rather than stripping it', () => {
    const message = helloAck({ extra: 'payload' })
    expect(validateControlMessage(message).valid).toBe(false)
    // §17: reject, never silently repair. The caller's object is untouched.
    expect(message).toHaveProperty('extra')
  })

  it('does not coerce a string into a number', () => {
    const message = helloAck({ heartbeatIntervalMs: '15000' })
    expect(validateControlMessage(message).valid).toBe(false)
    expect(message.heartbeatIntervalMs).toBe('15000')
  })

  it('does not insert defaults for a missing required field', () => {
    const message = helloAck()
    delete (message as Record<string, unknown>).connectionId
    expect(validateControlMessage(message).valid).toBe(false)
    expect(message).not.toHaveProperty('connectionId')
  })

  it('rejects a mismatched protocol version', () => {
    expect(validateControlMessage(helloAck({ protocolVersion: 2 })).valid).toBe(false)
  })

  it('reports an error path on failure', () => {
    const result = validateControlMessage(helloAck({ role: 'admin' }))
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('recipe step vocabulary is closed', () => {
  it.each(RECIPE_OPS)('accepts the %s operation', (op) => {
    const byOp: Record<string, unknown> = {
      set_field: { op, id: 's1', targetId: 'b1', value: { kind: 'literal', value: 'x' } },
      select_option: { op, id: 's1', targetId: 'b1', value: { kind: 'slot', slotId: 'p1' } },
      click: { op, id: 's1', targetId: 'b1' },
      submit_form: { op, id: 's1', targetId: 'b1' },
      observe_response: { op, id: 's1', responseBindingId: 'b2' },
      await_condition: {
        op, id: 's1', timeoutMs: 1000,
        condition: { kind: 'dom', targetId: 'b1', state: 'visible' },
      },
      extract_result: { op, id: 's1', fields: [{ name: 'total', bindingId: 'b3' }] },
    }
    expect(validateAs('RecipeStep', byOp[op]).valid).toBe(true)
  })

  it('rejects an invented operation', () => {
    expect(validateAs('RecipeStep', { op: 'eval', id: 's1', source: '1+1' }).valid).toBe(false)
  })

  it('rejects a script payload smuggled onto a valid operation', () => {
    const step = { op: 'click', id: 's1', targetId: 'b1', script: 'fetch("/drain")' }
    expect(validateAs('RecipeStep', step).valid).toBe(false)
  })

  it('rejects a caller-supplied selector in place of a binding reference', () => {
    const step = { op: 'click', id: 's1', selector: 'button.buy' }
    expect(validateAs('RecipeStep', step).valid).toBe(false)
  })
})

describe('authoring submission', () => {
  const proposal = {
    draftId: 'draft_1',
    draftRevision: 1,
    definition: {
      name: 'search_products',
      description: 'Search the catalogue',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', maxLength: 100 } },
        required: ['query'],
        additionalProperties: false,
      },
      parameters: [{ slotId: 'p1', name: 'query' }],
      stepIds: ['s1', 's2'],
    },
  }

  it('accepts a proposal that only selects existing steps', () => {
    expect(validateAs('SubmitToolDefinitionInput', proposal).valid).toBe(true)
  })

  it('rejects a proposal carrying its own recipe steps', () => {
    const withSteps = {
      ...proposal,
      definition: {
        ...proposal.definition,
        steps: [{ op: 'click', id: 's9', targetId: 'b1' }],
      },
    }
    expect(validateAs('SubmitToolDefinitionInput', withSteps).valid).toBe(false)
  })

  it('rejects a proposal carrying bindings or selectors', () => {
    const withBindings = {
      ...proposal,
      definition: {
        ...proposal.definition,
        bindings: [{ kind: 'control', id: 'b9', selector: '#evil', control: 'button' }],
      },
    }
    expect(validateAs('SubmitToolDefinitionInput', withBindings).valid).toBe(false)
  })

  it('rejects an open input schema', () => {
    const open = {
      ...proposal,
      definition: {
        ...proposal.definition,
        inputSchema: { ...proposal.definition.inputSchema, additionalProperties: true },
      },
    }
    expect(validateAs('SubmitToolDefinitionInput', open).valid).toBe(false)
  })
})
