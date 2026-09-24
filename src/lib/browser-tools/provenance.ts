/**
 * Invocation provenance (§10).
 *
 * Agent-driven clicks are indistinguishable from human ones in the capture
 * pipeline, so an invocation during recording would otherwise corrupt the
 * journey — and, for generated tools, corrupt the very data used to author the
 * next one.
 *
 * The rule that matters: temporal association is not confirmed cause. Only
 * events we synthesise are labelled `janus`. Everything else that happens
 * during an invocation, including the page's own async work and any human
 * input, stays `unknown` rather than being attributed to the agent.
 */

export type Actor = 'human' | 'janus' | 'page' | 'unknown'

export interface Provenance {
  actor: Actor
  invocationId?: string
  /** Why this attribution was made, for later inspection. */
  evidence?: 'synthesized' | 'agent_invoked_flag' | 'during_invocation'
}

let currentInvocationId: string | null = null
/** Depth counter: nested invocations must not clear the label early. */
let depth = 0

/**
 * Mark the start of an invocation. Returns a release function; call it in a
 * `finally` so a thrown step cannot leave the page permanently labelled.
 */
export function setInvocationActor(invocationId: string): () => void {
  currentInvocationId = invocationId
  depth++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--depth <= 0) { depth = 0; currentInvocationId = null }
  }
}

export function activeInvocationId(): string | null {
  return currentInvocationId
}

/**
 * Attribution for an event observed right now.
 *
 * `synthesized` is passed by the code that generated the event itself — the
 * only case where we can claim causation. Everything else during an invocation
 * is merely concurrent, so it is recorded as unknown with the invocation ID
 * kept for inspection.
 */
export function attribute(synthesized: boolean, agentInvokedFlag = false): Provenance {
  if (synthesized && currentInvocationId) {
    return { actor: 'janus', invocationId: currentInvocationId, evidence: 'synthesized' }
  }
  // Chrome sets SubmitEvent.agentInvoked for WebMCP form submission. It
  // describes that submission only, and is not a general marker for every
  // downstream effect.
  if (agentInvokedFlag) {
    return {
      actor: 'janus',
      invocationId: currentInvocationId ?? undefined,
      evidence: 'agent_invoked_flag',
    }
  }
  if (currentInvocationId) {
    return { actor: 'unknown', invocationId: currentInvocationId, evidence: 'during_invocation' }
  }
  return { actor: 'human' }
}

/**
 * Normalize a stored event that predates provenance. Absence of the field is
 * not evidence of a human action, so it becomes `unknown`, not `human`.
 */
export function normalize(event: { actor?: Actor }): Actor {
  return event.actor ?? 'unknown'
}

/** Two events may only collapse together if they share an actor boundary. */
export function sameBoundary(a: { actor?: Actor; invocationId?: string }, b: { actor?: Actor; invocationId?: string }): boolean {
  return normalize(a) === normalize(b) && a.invocationId === b.invocationId
}
