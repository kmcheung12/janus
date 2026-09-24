import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildDraft, current, isRecording, start, stop,
  type RecordingState,
} from '../../src/lib/browser-tools/demonstration-recorder'
import { setInvocationActor } from '../../src/lib/browser-tools/provenance'
import { LIMITS } from '../../src/lib/browser-tools/limits'

function markup(html: string) {
  document.body.innerHTML = html
}

function type(selector: string, value: string) {
  const element = document.querySelector(selector) as HTMLInputElement
  element.value = value
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

function click(selector: string) {
  (document.querySelector(selector) as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

beforeEach(() => { markup('') })
afterEach(() => { stop('user') })

describe('capture semantics', () => {
  it('records ordered steps without collapsing repeats', () => {
    // The journey recorder collapses identical adjacent clicks. A recipe that
    // dropped one would do the wrong thing.
    markup('<button id="add">Add</button>')
    start()
    click('#add')
    click('#add')
    click('#add')
    const finished = stop('user')!
    expect(finished.steps).toHaveLength(3)
    expect(finished.steps.map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('keeps the final value while a field is still being edited', () => {
    markup('<input id="q" type="text">')
    start()
    type('#q', 'head')
    type('#q', 'headphones')
    const finished = stop('user')!
    expect(finished.steps).toHaveLength(1)
    expect(finished.steps[0].value).toBe('headphones')
  })

  it('records far more than the journey buffer\'s 50 events', () => {
    markup('<button id="b">b</button>')
    start()
    for (let i = 0; i < 120; i++) click('#b')
    expect(stop('user')!.steps).toHaveLength(120)
  })

  it('reports an explicit stop reason', () => {
    markup('<button id="b">b</button>')
    start()
    expect(isRecording()).toBe(true)
    expect(stop('navigation')!.stopped).toBe('navigation')
    expect(isRecording()).toBe(false)
  })

  it('stops visibly at the event limit rather than truncating silently', () => {
    markup('<button id="b">b</button>')
    const states: RecordingState[] = []
    start((s) => states.push(s))
    for (let i = 0; i < LIMITS.demonstrationMaxEvents + 5; i++) click('#b')

    const last = states.at(-1)!
    expect(last.stopped).toBe('event_limit')
    expect(last.overflowed).toBe(true)
    expect(last.steps.length).toBeLessThanOrEqual(LIMITS.demonstrationMaxEvents)
  })
})

describe('sensitive fields', () => {
  it('never records a password value', () => {
    markup('<input id="u" type="text"><input id="p" type="password">')
    start()
    type('#u', 'alice')
    type('#p', 'hunter2')
    const finished = stop('user')!
    expect(finished.steps).toHaveLength(1)
    expect(JSON.stringify(finished)).not.toContain('hunter2')
  })

  it('honours autocomplete hints for credentials', () => {
    markup('<input id="c" type="text" autocomplete="cc-number">')
    start()
    type('#c', '4111111111111111')
    expect(JSON.stringify(stop('user')!)).not.toContain('4111')
  })

  it('never records file or hidden inputs', () => {
    markup('<input id="h" type="hidden" value="csrf"><input id="f" type="file">')
    start()
    type('#h', 'csrf-token')
    expect(stop('user')!.steps).toHaveLength(0)
  })
})

describe('provenance', () => {
  it('marks steps during an invocation as uncertain, not agent-caused', () => {
    markup('<button id="b">b</button>')
    start()
    const release = setInvocationActor('inv_1')
    click('#b')
    release()
    click('#b')

    const finished = stop('user')!
    expect(finished.steps[0].actor).toBe('unknown')
    expect(finished.steps[0].invocationId).toBe('inv_1')
    expect(finished.steps[1].actor).toBe('human')
  })

  it('excludes uncertain steps from the built draft', () => {
    markup('<input id="q" type="text"><button id="go">Go</button>')
    start()
    type('#q', 'x')
    const release = setInvocationActor('inv_1')
    click('#go')
    release()

    const recording = stop('user')!
    const { draft, excluded } = buildDraft({
      recording, principalId: 'c1', browserSessionId: 'b1',
      pageId: '0'.repeat(32), documentId: 'd1', parameterIndices: [0],
    })

    // Uncertain steps need explicit resolution rather than silently becoming
    // part of a recipe.
    expect(excluded).toHaveLength(1)
    expect(draft.candidateSteps.some((s) => s.op === 'click')).toBe(false)
  })
})

describe('building a draft', () => {
  function record() {
    markup('<form id="f"><input id="q" type="text"><select id="c"><option value="a">A</option></select></form>')
    start()
    type('#q', 'headphones')
    type('#c', 'a')
    return stop('user')!
  }

  it('turns chosen steps into parameters and bakes the rest in as literals', () => {
    const { draft } = buildDraft({
      recording: record(), principalId: 'c1', browserSessionId: 'b1',
      pageId: '0'.repeat(32), documentId: 'd1',
      parameterIndices: [0], // only the text field is a parameter
    })

    const setField = draft.candidateSteps.find((s) => s.op === 'set_field')
    const selectOption = draft.candidateSteps.find((s) => s.op === 'select_option')
    expect(setField).toMatchObject({ value: { kind: 'slot' } })
    expect(selectOption).toMatchObject({ value: { kind: 'literal', value: 'a' } })
    expect(draft.slots).toHaveLength(1)
  })

  it('ends with exactly one extract_result', () => {
    const { draft } = buildDraft({
      recording: record(), principalId: 'c1', browserSessionId: 'b1',
      pageId: '0'.repeat(32), documentId: 'd1', parameterIndices: [],
    })
    expect(draft.candidateSteps.at(-1)?.op).toBe('extract_result')
    expect(draft.candidateSteps.filter((s) => s.op === 'extract_result')).toHaveLength(1)
  })

  it('produces a draft the compiler accepts', async () => {
    const { compileDefinition } = await import('../../packages/mcp-server/src/control/draft-compiler.js')
    const { draft } = buildDraft({
      recording: record(), principalId: 'c1', browserSessionId: 'b1',
      pageId: '0'.repeat(32), documentId: 'd1', parameterIndices: [0],
    })

    const result = compileDefinition({
      draft,
      draftRevision: 1,
      principalId: 'c1',
      proposal: {
        name: 'search', description: 'Search',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', maxLength: 100 } },
          required: ['query'],
          additionalProperties: false,
        },
        parameters: [{ slotId: draft.slots[0].id, name: 'query' }],
        stepIds: draft.candidateSteps.map((s) => s.id),
      },
    })

    expect(result.ok).toBe(true)
  })

  it('carries an expiry and pending status', () => {
    const { draft } = buildDraft({
      recording: record(), principalId: 'c1', browserSessionId: 'b1',
      pageId: '0'.repeat(32), documentId: 'd1', parameterIndices: [],
    })
    expect(draft.status).toBe('pending')
    expect(draft.expiresAt).toBeGreaterThan(draft.createdAt)
  })
})
