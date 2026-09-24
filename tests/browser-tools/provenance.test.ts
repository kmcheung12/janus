import { describe, expect, it } from 'vitest'
import { attribute, normalize, sameBoundary, setInvocationActor } from '../../src/lib/browser-tools/provenance'
import { collapse } from '../../src/lib/event-capture/collapse'
import type { CapturedEvent } from '../../src/lib/event-capture/types'

function click(overrides: Partial<CapturedEvent> = {}): CapturedEvent {
  return {
    id: crypto.randomUUID(), type: 'click', timestamp: 1,
    selector: '#buy', label: 'Buy', count: 1, x: 10, y: 20,
    ...overrides,
  } as CapturedEvent
}

describe('attribution', () => {
  it('marks events outside an invocation as human', () => {
    expect(attribute(false)).toEqual({ actor: 'human' })
  })

  it('marks only synthesized events as janus', () => {
    const release = setInvocationActor('inv_1')
    expect(attribute(true)).toMatchObject({ actor: 'janus', invocationId: 'inv_1', evidence: 'synthesized' })
    release()
  })

  it('does not attribute concurrent activity to the agent', () => {
    // Temporal association is not confirmed cause: a human can click while an
    // invocation runs, and the page does its own async work.
    const release = setInvocationActor('inv_1')
    const observed = attribute(false)
    expect(observed.actor).toBe('unknown')
    expect(observed.invocationId).toBe('inv_1')
    expect(observed.evidence).toBe('during_invocation')
    release()
  })

  it('treats the agentInvoked flag as evidence for that event only', () => {
    expect(attribute(false, true)).toMatchObject({ actor: 'janus', evidence: 'agent_invoked_flag' })
  })

  it('clears attribution after the invocation ends', () => {
    const release = setInvocationActor('inv_1')
    release()
    expect(attribute(false)).toEqual({ actor: 'human' })
  })

  it('survives nested invocations without clearing early', () => {
    const outer = setInvocationActor('inv_1')
    const inner = setInvocationActor('inv_2')
    inner()
    expect(attribute(false).invocationId).toBe('inv_2')
    outer()
    expect(attribute(false)).toEqual({ actor: 'human' })
  })

  it('is idempotent if a release runs twice', () => {
    const release = setInvocationActor('inv_1')
    release()
    release()
    expect(attribute(false)).toEqual({ actor: 'human' })
  })
})

describe('legacy events', () => {
  it('normalizes a missing actor to unknown, not human', () => {
    // Absence of the field is not evidence of a human action.
    expect(normalize({})).toBe('unknown')
    expect(normalize({ actor: 'human' })).toBe('human')
  })

  it('treats a missing actor as a distinct boundary from human', () => {
    expect(sameBoundary({}, { actor: 'human' })).toBe(false)
  })
})

describe('collapse preserves boundaries', () => {
  it('does not merge a human click with an agent click', () => {
    const events = [
      click({ actor: 'human' }),
      click({ actor: 'janus', invocationId: 'inv_1' }),
    ]
    expect(collapse(events)).toHaveLength(2)
  })

  it('does not merge clicks from different invocations', () => {
    const events = [
      click({ actor: 'janus', invocationId: 'inv_1' }),
      click({ actor: 'janus', invocationId: 'inv_2' }),
    ]
    expect(collapse(events)).toHaveLength(2)
  })

  it('still merges identical clicks within one boundary', () => {
    const events = [
      click({ actor: 'janus', invocationId: 'inv_1' }),
      click({ actor: 'janus', invocationId: 'inv_1' }),
    ]
    const collapsed = collapse(events)
    expect(collapsed).toHaveLength(1)
    expect((collapsed[0] as { count: number }).count).toBe(2)
  })
})
