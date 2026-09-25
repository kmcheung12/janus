/**
 * In-page record of tool invocations, for the on-page panel (§19).
 *
 * Observation only: nothing here gates, delays or alters a call. The log is
 * per-document and never persisted — it exists so a human watching the page
 * can see what an agent did, which is exactly the window in which that
 * information is useful. It is not an audit trail, and journeys remain the
 * durable record.
 *
 * Only calls Janus serves can appear here. A site's own WebMCP tools invoked
 * by the site's own agent never reach our runtime, so the panel must not imply
 * it is showing everything that happened on the page.
 */

import type { Json, ToolOutcome } from './contract'

/** Which consumer asked for the call. */
export type Caller = 'daemon' | 'webmcp'

export interface ActivityEntry {
  id: string
  toolId: string
  /** Display name at call time; a later revision may rename the tool. */
  name: string
  caller: Caller
  input: Record<string, Json>
  startedAt: number
  /** Absent while the call is still running. */
  endedAt?: number
  status: 'running' | 'completed' | 'error'
  /** One-line result or error, already truncated for display. */
  summary?: string
}

/**
 * Enough to show the shape of a session without letting a chatty agent pin
 * unbounded result text in memory for the life of the document.
 */
const MAX_ENTRIES = 50
const SUMMARY_MAX = 300

let entries: ActivityEntry[] = []
const listeners = new Set<(entries: ActivityEntry[]) => void>()

function notify(): void {
  // A fresh array each time so Svelte's reactivity sees a new reference.
  const snapshot = [...entries]
  for (const listener of listeners) listener(snapshot)
}

export function subscribe(listener: (entries: ActivityEntry[]) => void): () => void {
  listeners.add(listener)
  listener([...entries])
  return () => { listeners.delete(listener) }
}

export function current(): ActivityEntry[] {
  return [...entries]
}

/** Newest first, so the panel does not have to reverse on every render. */
export function began(
  id: string, toolId: string, name: string, caller: Caller, input: Record<string, Json>,
): void {
  const entry: ActivityEntry = {
    id, toolId, name, caller, input, startedAt: Date.now(), status: 'running',
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  notify()
}

export function ended(id: string, outcome: ToolOutcome): void {
  const entry = entries.find((e) => e.id === id)
  // The call may have aged out of the buffer mid-flight, which is not an error.
  if (!entry) return

  entry.endedAt = Date.now()
  entry.status = outcome.status === 'completed' ? 'completed' : 'error'
  entry.summary = truncate(
    outcome.status === 'completed' ? summarize(outcome.result) : outcome.error.message,
  )
  notify()
}

/** A new document starts with an empty log; nothing carries across (§7). */
export function reset(): void {
  entries = []
  notify()
}

function truncate(text: string): string {
  return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text
}

function summarize(result: Json): string {
  if (result === null || result === undefined) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    // Circular or otherwise unserializable results are the runtime's problem,
    // not the panel's — say so rather than throwing inside a notification.
    return '[unserializable result]'
  }
}
