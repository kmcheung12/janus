import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  allDefinitions, cleanup, deleteDefinition, enabledDefinitions, exportDefinition,
  getApproval, putDraft, setApproval, storeDefinition, _resetForTests,
} from '../../src/lib/browser-tools/definition-store'
import type { GeneratedDefinition, ToolDraft } from '../../src/lib/browser-tools/contract'

const steps = [
  { op: 'set_field', id: 's1', targetId: 'b_q', value: { kind: 'slot', slotId: 'p1' } },
  { op: 'extract_result', id: 's2', fields: [{ name: 'r', bindingId: 'b_out' }] },
] as ToolDraft['candidateSteps']

const bindings = [
  { kind: 'control', id: 'b_q', selector: '#q', control: 'text' },
  { kind: 'control', id: 'b_res', selector: '#results', control: 'text' },
  { kind: 'dom_result', id: 'b_out', targetId: 'b_res', read: 'text' },
] as ToolDraft['bindings']

function draft(overrides: Partial<ToolDraft> = {}): ToolDraft {
  return {
    id: 'draft_1', revision: 1, principalId: 'client_1',
    browserSessionId: 'b1', pageId: '0'.repeat(32), documentId: 'doc_1',
    applicability: { origin: 'https://shop.example', pathnamePrefix: '/' },
    status: 'pending', createdAt: 0, expiresAt: Date.now() + 60_000,
    bindings, slots: [{ id: 'p1', constraint: { type: 'string' }, sensitive: false }],
    candidateSteps: steps, requiredStepIds: ['s1', 's2'], evidence: [],
    ...overrides,
  }
}

function definition(overrides: Partial<GeneratedDefinition> = {}): GeneratedDefinition {
  return {
    formatVersion: 1, definitionId: 'def_1', definitionRevision: 1,
    principalId: 'client_1', sourceDraft: { id: 'draft_1', revision: 1 },
    applicability: { origin: 'https://shop.example', pathnamePrefix: '/' },
    name: 'search', description: 'Search',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false },
    parameters: [{ slotId: 'p1', name: 'query' }],
    slots: [{ id: 'p1', constraint: { type: 'string' }, sensitive: false }],
    bindings, steps, evidenceIds: [],
    annotations: { readOnly: false, consequential: true },
    createdAt: 0, updatedAt: 0,
    ...overrides,
  }
}

beforeEach(async () => {
  _resetForTests()
  indexedDB = new IDBFactory()
})

describe('storing a compiled definition', () => {
  it('stores it against a known draft', async () => {
    await putDraft(draft())
    expect(await storeDefinition('draft_1', 1, definition())).toEqual({ ok: true })
    expect(await allDefinitions()).toHaveLength(1)
  })

  it('refuses a definition for a draft we do not have', async () => {
    expect(await storeDefinition('draft_ghost', 1, definition())).toMatchObject({ reason: 'unknown_draft' })
  })

  it('refuses a stale draft revision', async () => {
    await putDraft(draft({ revision: 2 }))
    expect(await storeDefinition('draft_1', 1, definition())).toMatchObject({ reason: 'draft_stale' })
  })

  it('refuses a binding that is not in our copy of the draft', async () => {
    // The draft is the authority for what was captured; a locator arriving
    // over the wire that we never recorded is rejected outright.
    await putDraft(draft())
    const tampered = definition({
      bindings: [...bindings, { kind: 'control', id: 'b_evil', selector: '#admin', control: 'button' }] as ToolDraft['bindings'],
    })
    expect(await storeDefinition('draft_1', 1, tampered)).toMatchObject({ reason: 'draft_stale' })
  })

  it('refuses a step that is not a draft candidate', async () => {
    await putDraft(draft())
    const tampered = definition({
      steps: [{ op: 'click', id: 's9', targetId: 'b_q' }] as GeneratedDefinition['steps'],
    })
    expect(await storeDefinition('draft_1', 1, tampered)).toMatchObject({ reason: 'draft_stale' })
  })
})

describe('approval', () => {
  it('stores a definition as pending, not enabled', async () => {
    await putDraft(draft())
    await storeDefinition('draft_1', 1, definition())
    expect((await getApproval('def_1'))?.state).toBe('pending')
    expect(await enabledDefinitions()).toHaveLength(0)
  })

  it('executes only after a human enables it', async () => {
    await putDraft(draft())
    await storeDefinition('draft_1', 1, definition())
    await setApproval('def_1', 'enabled')
    expect(await enabledDefinitions()).toHaveLength(1)
  })

  it('invalidates approval when the definition is revised', async () => {
    await putDraft(draft())
    await storeDefinition('draft_1', 1, definition())
    await setApproval('def_1', 'enabled')

    // A new revision must be reviewed again rather than inheriting approval.
    await putDraft(draft({ revision: 2 }))
    await storeDefinition('draft_1', 2, definition({ definitionRevision: 2 }))
    expect(await enabledDefinitions()).toHaveLength(0)
  })

  it('disabling removes it from execution', async () => {
    await putDraft(draft())
    await storeDefinition('draft_1', 1, definition())
    await setApproval('def_1', 'enabled')
    await setApproval('def_1', 'disabled')
    expect(await enabledDefinitions()).toHaveLength(0)
  })

  it('deleting removes the definition and its approval', async () => {
    await putDraft(draft())
    await storeDefinition('draft_1', 1, definition())
    await setApproval('def_1', 'enabled')
    await deleteDefinition('def_1')
    expect(await allDefinitions()).toHaveLength(0)
    expect(await getApproval('def_1')).toBeUndefined()
  })
})

describe('retention', () => {
  it('purges expired drafts', async () => {
    await putDraft(draft({ id: 'draft_old', expiresAt: Date.now() - 1 }))
    await putDraft(draft({ id: 'draft_new' }))
    expect(await cleanup()).toEqual({ removed: 1 })
  })
})

describe('export', () => {
  it('omits credentials, evidence and ownership', () => {
    const exported = exportDefinition(definition())
    expect(exported).not.toContain('client_1')
    expect(exported).not.toContain('draft_1')
    expect(JSON.parse(exported).format).toBe('janus.webtool.v1')
  })

  it('keeps the executable parts', () => {
    const parsed = JSON.parse(exportDefinition(definition()))
    expect(parsed.definition.steps).toHaveLength(2)
    expect(parsed.definition.bindings).toHaveLength(3)
  })
})
