/**
 * Live pages, tools and execution state (§7, §10).
 *
 * Everything here is keyed by opaque identity, never by domain or "active
 * tab". A new document always gets a new page handle, and a tool handle is
 * bound to one document — so a stale call fails explicitly instead of landing
 * on whatever the user happens to be looking at now.
 */

import type { Id, PageDescriptor, PageId, ToolDescriptor } from '../contracts/types.js'
import { LIMITS } from '../contracts/limits.js'

export interface LivePage {
  descriptor: PageDescriptor
  connectionId: Id
  pairingId: string
  /** Logical tool ID -> current descriptor for this document. */
  tools: Map<Id, ToolDescriptor>
  /**
   * Tool IDs withdrawn or superseded on this page handle. Retained until the
   * handle expires so a stale name is rejected rather than rebound (§8).
   */
  tombstones: Set<Id>
}

export type RegistryEvent =
  | { kind: 'pages_changed' }
  | { kind: 'tools_changed'; pageId: PageId }
  | { kind: 'page_removed'; pageId: PageId }

type Listener = (event: RegistryEvent) => void

const pages = new Map<PageId, LivePage>()
const listeners = new Set<Listener>()

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(event: RegistryEvent): void {
  for (const fn of listeners) fn(event)
}

export function syncPages(
  connectionId: Id,
  pairingId: string,
  descriptors: PageDescriptor[],
): void {
  // A snapshot is complete by definition: anything this connection previously
  // owned and no longer lists is gone.
  const incoming = new Set(descriptors.map((d) => d.pageId))
  for (const [pageId, page] of pages) {
    if (page.connectionId === connectionId && !incoming.has(pageId)) {
      pages.delete(pageId)
      emit({ kind: 'page_removed', pageId })
    }
  }

  for (const descriptor of descriptors) {
    const existing = pages.get(descriptor.pageId)
    if (existing && existing.connectionId !== connectionId) {
      // Another connection already owns this handle; refuse to take it over.
      continue
    }
    pages.set(descriptor.pageId, {
      descriptor,
      connectionId,
      pairingId,
      tools: existing?.tools ?? new Map(),
      tombstones: existing?.tombstones ?? new Set(),
    })
  }
  emit({ kind: 'pages_changed' })
}

export interface ToolSyncResult {
  ok: boolean
  reason?: 'unknown_page' | 'wrong_connection' | 'stale_document' | 'too_many_tools' | 'reused_tool_id'
}

export function syncTools(
  connectionId: Id,
  pageId: PageId,
  documentId: Id,
  tools: ToolDescriptor[],
): ToolSyncResult {
  const page = pages.get(pageId)
  if (!page) return { ok: false, reason: 'unknown_page' }
  if (page.connectionId !== connectionId) return { ok: false, reason: 'wrong_connection' }
  if (page.descriptor.documentId !== documentId) return { ok: false, reason: 'stale_document' }
  if (tools.length > LIMITS.toolSnapshotMax) return { ok: false, reason: 'too_many_tools' }

  for (const tool of tools) {
    const previous = page.tools.get(tool.toolId)
    // A tool ID identifies one logical source for the life of the page handle.
    // Reusing it for a different source would let a name silently change meaning.
    if (previous && previous.source.kind !== tool.source.kind) {
      return { ok: false, reason: 'reused_tool_id' }
    }
  }

  const incoming = new Set(tools.map((t) => t.toolId))
  for (const toolId of page.tools.keys()) {
    if (!incoming.has(toolId)) page.tombstones.add(toolId)
  }

  page.tools = new Map(tools.map((t) => [t.toolId, t]))
  emit({ kind: 'tools_changed', pageId })
  return { ok: true }
}

export function removePage(pageId: PageId, connectionId?: Id): void {
  const page = pages.get(pageId)
  if (!page) return
  if (connectionId && page.connectionId !== connectionId) return
  pages.delete(pageId)
  emit({ kind: 'page_removed', pageId })
}

export function removeConnection(connectionId: Id): void {
  for (const [pageId, page] of pages) {
    if (page.connectionId === connectionId) {
      pages.delete(pageId)
      emit({ kind: 'page_removed', pageId })
    }
  }
  emit({ kind: 'pages_changed' })
}

export function getPage(pageId: PageId): LivePage | undefined {
  return pages.get(pageId)
}

export function getTool(pageId: PageId, toolId: Id): ToolDescriptor | undefined {
  return pages.get(pageId)?.tools.get(toolId)
}

export function isTombstoned(pageId: PageId, toolId: Id): boolean {
  return pages.get(pageId)?.tombstones.has(toolId) ?? false
}

/** Pages visible to one MCP client, scoped by its pairing (§12). */
export function pagesForPairing(pairingId: string): LivePage[] {
  return [...pages.values()].filter((p) => p.pairingId === pairingId)
}

/** Every page a client may reach, across all the pairings it is scoped to. */
export function pagesForPairings(pairingIds: string[]): LivePage[] {
  const scope = new Set(pairingIds)
  return [...pages.values()].filter((p) => scope.has(p.pairingId))
}

export function setExecutionState(pageId: PageId, execution: PageDescriptor['execution']): void {
  const page = pages.get(pageId)
  if (!page) return
  page.descriptor = { ...page.descriptor, execution }
  emit({ kind: 'pages_changed' })
}

export function clear(): void {
  pages.clear()
  listeners.clear()
}
