/**
 * Background-side routing for the command bridge (§6).
 *
 * The background owns the daemon connection and the pairing credential, and is
 * the only place that decides which document an invocation reaches. Content
 * scripts can execute what they are given but cannot enable a page, claim
 * executor authority or read the credential.
 */

import type { Id, PageDescriptor, PageId, ToolDescriptor, ToolOutcome } from './contract'
import type { GeneratedDefinition, ToolDraft } from './contract'
import * as control from './control-client'
import * as store from './definition-store'
import { LIMITS } from './limits'

export interface EnabledPage {
  pageId: PageId
  tabId: number
  documentId: Id
  label: string
  title: string
  url: string
  origin: string
  nativeCapability: PageDescriptor['nativeCapability']
  /** Tools the site itself registers. API support without tools is not readiness. */
  nativeToolCount: number
  /** Whether auto-derived form tools (which submit) may publish for this page. */
  allowAutoWrites: boolean
}

export interface PairingConfig {
  url: string
  pairingId: string
  token: string
  browserSessionId: Id
}

const STORAGE_KEY = 'janus_browser_tools'

/**
 * Enabled pages, keyed by tab.
 *
 * Several tabs can be enabled at once; each is its own page handle with its own
 * tool set. The daemon already serializes execution per page, so calls to
 * different pages run concurrently while calls to one page still queue.
 */
const enabledPages = new Map<number, EnabledPage>()
let pairing: PairingConfig | null = null

function pageById(pageId: PageId): EnabledPage | undefined {
  for (const page of enabledPages.values()) if (page.pageId === pageId) return page
  return undefined
}

function randomPageId(): PageId {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getEnabledPages(): EnabledPage[] {
  return [...enabledPages.values()]
}

/** The enabled page for one tab, if any. */
export function getEnabledPage(tabId?: number): EnabledPage | null {
  if (tabId === undefined) return enabledPages.values().next().value ?? null
  return enabledPages.get(tabId) ?? null
}

export async function loadPairing(): Promise<PairingConfig | null> {
  // Credentials live in background-only storage and are never exposed through
  // content-script messages, page globals or exported definitions (§12).
  const stored = await browser.storage.local.get(STORAGE_KEY)
  pairing = (stored[STORAGE_KEY] as PairingConfig | undefined) ?? null
  return pairing
}

export async function savePairing(config: PairingConfig | null): Promise<void> {
  pairing = config
  if (config) await browser.storage.local.set({ [STORAGE_KEY]: config })
  else await browser.storage.local.remove(STORAGE_KEY)
  await reconnect()
}

/**
 * Re-show the pairing payload so the daemon can still be provisioned.
 *
 * The secret is displayed once, but "once" cannot mean "lost if you reload
 * the settings page" — that strands the extension holding a credential the
 * daemon has never been told about, with no way to hand it over except
 * re-pairing. Only returned before the credential has ever been accepted, and
 * only to an extension page; the background already holds it either way.
 */
export function provisioningPayload(): { pairingId: string; token: string } | null {
  if (!pairing) return null
  if (control.hasEverConnected()) return null
  return { pairingId: pairing.pairingId, token: pairing.token }
}

export async function reconnect(): Promise<void> {
  control.stop()
  if (!pairing) return
  control.start({
    ...pairing,
    execute: executeInTab,
    cancel: cancelInTab,
    storeDefinition: onDefinitionProposed,
    onStatus: (status) => {
      void browser.runtime.sendMessage({ type: 'JANUS_BT_STATUS', status }).catch(() => {})
    },
  })
}

/** Resolve the tab's real top-level document before claiming success (§19). */
export async function enablePage(
  tabId: number, label?: string, allowAutoWrites = false,
): Promise<EnabledPage> {
  const tab = await browser.tabs.get(tabId)
  const url = tab.url ?? ''
  const origin = (() => { try { return new URL(url).origin } catch { return '' } })()
  if (!origin.startsWith('http')) throw new Error('Only http(s) pages can be enabled')

  const info = await browser.tabs.sendMessage(tabId, { type: 'JANUS_BT_DESCRIBE' }) as {
    documentId: string
    nativeCapability: PageDescriptor['nativeCapability']
    nativeToolCount?: number
  }

  if (!enabledPages.has(tabId) && enabledPages.size >= LIMITS.enabledPagesPerSession) {
    throw new Error(
      `At most ${LIMITS.enabledPagesPerSession} pages can be enabled at once. Disable one first.`,
    )
  }

  // Re-enabling a tab replaces its handle rather than accumulating handles for
  // documents that no longer exist.
  const previous = enabledPages.get(tabId)
  if (previous) control.removePage(previous.pageId, previous.documentId, 'disabled')

  const trimmed = (label ?? tab.title ?? origin).trim().slice(0, LIMITS.pageLabelMaxLength)
  const enabled: EnabledPage = {
    pageId: randomPageId(),
    tabId,
    documentId: info.documentId,
    label: trimmed || origin,
    title: tab.title ?? '',
    url,
    origin,
    nativeCapability: info.nativeCapability,
    nativeToolCount: info.nativeToolCount ?? 0,
    allowAutoWrites: previous?.allowAutoWrites ?? allowAutoWrites,
  }
  enabledPages.set(tabId, enabled)

  await pushAutoOptions(enabled)
  publishPages()
  await refreshTools(tabId)
  await syncDefinitions(tabId)
  return enabled
}

export function disablePage(
  tabId: number,
  reason: 'navigation' | 'closed' | 'disabled' = 'disabled',
): void {
  const page = enabledPages.get(tabId)
  if (!page) return
  control.removePage(page.pageId, page.documentId, reason)
  enabledPages.delete(tabId)
  publishPages()
}

export function disableAll(reason: 'navigation' | 'closed' | 'disabled' = 'disabled'): void {
  for (const tabId of [...enabledPages.keys()]) disablePage(tabId, reason)
}

export function setLabel(tabId: number, label: string): EnabledPage | null {
  const page = enabledPages.get(tabId)
  if (!page) return null
  const trimmed = label.trim().slice(0, LIMITS.pageLabelMaxLength)
  if (trimmed.length < LIMITS.pageLabelMinLength) throw new Error('Label cannot be empty')
  // A label is display metadata; it never affects identity or revision (§7).
  const updated = { ...page, label: trimmed }
  enabledPages.set(tabId, updated)
  publishPages()
  return updated
}

/** Tell the page which auto tools it may publish. */
async function pushAutoOptions(page: EnabledPage): Promise<void> {
  try {
    await browser.tabs.sendMessage(page.tabId, {
      type: 'JANUS_BT_SET_AUTO_OPTIONS',
      pageId: page.pageId,
      allowWrites: page.allowAutoWrites,
    })
  } catch {
    disablePage(page.tabId, 'closed')
  }
}

/** Opt a page in or out of auto-derived form tools, which submit. */
export async function setAutoWrites(tabId: number, allow: boolean): Promise<EnabledPage | null> {
  const page = enabledPages.get(tabId)
  if (!page) return null
  const updated = { ...page, allowAutoWrites: allow }
  enabledPages.set(tabId, updated)
  await pushAutoOptions(updated)
  await refreshTools(tabId)
  return updated
}

/** A complete snapshot: anything absent here is withdrawn by definition. */
function publishPages(): void {
  control.publishPages([...enabledPages.values()].map((page) => ({
    pageId: page.pageId,
    browserSessionId: pairing?.browserSessionId ?? 'browser',
    tabId: page.tabId,
    frameId: 0 as const,
    documentId: page.documentId,
    label: page.label,
    title: page.title,
    url: page.url,
    origin: page.origin,
    nativeCapability: page.nativeCapability,
    execution: { state: 'idle' as const },
  })))
}

// ── Authoring (M2) ─────────────────────────────────────────────────────────

/** Capture a draft from the enabled page and offer it to the agent. */
export async function captureDraft(
  tabId: number, principalId: string,
): Promise<{ draft?: ToolDraft; unsupported?: unknown; error?: string }> {
  const enabled = enabledPages.get(tabId)
  if (!enabled) return { error: 'This tab is not enabled' }
  try {
    const result = await browser.tabs.sendMessage(enabled.tabId, {
      type: 'JANUS_BT_SCAN_FORM',
      principalId,
      browserSessionId: pairing?.browserSessionId ?? 'browser',
      pageId: enabled.pageId,
      documentId: enabled.documentId,
    }) as { draft: ToolDraft; unsupported: unknown }
    if (!result?.draft) return { error: 'No supported form found on this page' }

    await store.putDraft(result.draft)
    control.publishDraft(result.draft)
    return result
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) }
  }
}

/**
 * The daemon compiled a definition and asks us to persist it. We re-check it
 * against our own copy of the draft: the draft is the authority for what was
 * actually captured, so a locator we never recorded is refused.
 */
async function onDefinitionProposed(
  draftId: string, draftRevision: number, definition: GeneratedDefinition,
): Promise<boolean> {
  const result = await store.storeDefinition(draftId, draftRevision, definition)
  if (result.ok) await syncDefinitions()
  return result.ok
}

/** Definitions are matched by route, so every enabled page re-evaluates them. */
async function forEachEnabled(fn: (page: EnabledPage) => Promise<void>): Promise<void> {
  await Promise.all([...enabledPages.values()].map(async (page) => {
    try {
      await fn(page)
    } catch {
      // The tab is gone; its document is effectively destroyed.
      disablePage(page.tabId, 'closed')
    }
  }))
}

/** Push currently enabled definitions to the page and republish its tools. */
export async function syncDefinitions(tabId?: number): Promise<void> {
  const definitions = await store.enabledDefinitions()
  const targets = tabId !== undefined
    ? [enabledPages.get(tabId)].filter(Boolean) as EnabledPage[]
    : [...enabledPages.values()]

  await Promise.all(targets.map(async (page) => {
    try {
      await browser.tabs.sendMessage(page.tabId, { type: 'JANUS_BT_SET_DEFINITIONS', definitions })
      await refreshTools(page.tabId)
    } catch {
      disablePage(page.tabId, 'closed')
    }
  }))
}

export async function authoringState() {
  const [drafts, definitions, approvals] = await Promise.all([
    store.allDrafts(), store.allDefinitions(), store.allApprovals(),
  ])
  return { drafts, definitions, approvals }
}

export async function setApproval(definitionId: string, state: 'enabled' | 'disabled') {
  const approval = await store.setApproval(definitionId, state)
  await syncDefinitions()
  return approval
}

export async function deleteDefinition(definitionId: string) {
  await store.deleteDefinition(definitionId)
  await syncDefinitions()
}

export async function exportDefinition(definitionId: string): Promise<string | undefined> {
  const definitions = await store.allDefinitions()
  const definition = definitions.find((d) => d.definitionId === definitionId)
  return definition ? store.exportDefinition(definition) : undefined
}

/** A test is an explicit human action and runs outside the daemon queue. */
export async function testDefinition(
  tabId: number, definitionId: string, input: Record<string, never>,
) {
  const enabled = enabledPages.get(tabId)
  if (!enabled) return { error: 'This tab is not enabled' }
  const definitions = await store.allDefinitions()
  const definition = definitions.find((d) => d.definitionId === definitionId)
  if (!definition) return { error: 'No such definition' }

  return browser.tabs.sendMessage(enabled.tabId, {
    type: 'JANUS_BT_TEST_RUN', definition, input, timeoutMs: LIMITS.invocationDeadlineMs,
  })
}

/** Demonstration authoring (M3). Ordered capture lives in the page. */
export async function demo(tabId: number, action: 'start' | 'stop' | 'state'): Promise<unknown> {
  const enabled = enabledPages.get(tabId)
  if (!enabled) return { error: 'This tab is not enabled' }
  const type = action === 'start' ? 'JANUS_BT_DEMO_START'
    : action === 'stop' ? 'JANUS_BT_DEMO_STOP' : 'JANUS_BT_DEMO_STATE'
  return browser.tabs.sendMessage(enabled.tabId, { type })
}

export async function buildDemoDraft(
  tabId: number, recording: unknown, parameterIndices: number[], resultIndex?: number,
): Promise<{ draft?: ToolDraft; excluded?: unknown; error?: string }> {
  const enabled = enabledPages.get(tabId)
  if (!enabled) return { error: 'This tab is not enabled' }
  const result = await browser.tabs.sendMessage(enabled.tabId, {
    type: 'JANUS_BT_DEMO_BUILD',
    recording,
    principalId: 'local',
    browserSessionId: pairing?.browserSessionId ?? 'browser',
    pageId: enabled.pageId,
    documentId: enabled.documentId,
    parameterIndices,
    resultIndex,
  }) as { draft: ToolDraft; excluded: unknown }

  if (result?.draft) {
    await store.putDraft(result.draft)
    control.publishDraft(result.draft)
  }
  return result
}

export async function refreshTools(tabId?: number): Promise<void> {
  const targets = tabId !== undefined
    ? [enabledPages.get(tabId)].filter(Boolean) as EnabledPage[]
    : [...enabledPages.values()]

  await Promise.all(targets.map(async (page) => {
    try {
      const tools = await browser.tabs.sendMessage(page.tabId, { type: 'JANUS_BT_LIST_TOOLS' }) as ToolDescriptor[]
      control.publishTools(page.pageId, page.documentId, tools ?? [])
    } catch {
      // The content script is gone, so the document is effectively destroyed.
      disablePage(page.tabId, 'closed')
    }
  }))
}

/** Navigation replaces the document, which invalidates that page handle (§7). */
export async function onNavigated(tabId: number): Promise<void> {
  disablePage(tabId, 'navigation')
}

async function executeInTab(request: control.ExecuteRequest): Promise<control.ExecuteResponse> {
  // Routed by page handle, never by "the active tab": several pages can be
  // enabled, and the caller named exactly one.
  const page = pageById(request.pageId)
  if (!page) return unknownPage('The page is no longer enabled')
  if (page.documentId !== request.documentId) {
    return unknownPage('The document changed before dispatch')
  }

  try {
    const outcome = await browser.tabs.sendMessage(page.tabId, {
      type: 'JANUS_BT_INVOKE',
      requestId: request.requestId,
      toolId: request.toolId,
      input: request.arguments,
      timeoutMs: request.timeoutMs,
    }) as control.ExecuteResponse
    return outcome
  } catch (e) {
    // The tab vanished mid-call. It may already have acted, so the outcome is
    // genuinely unknown and the daemon must keep the page locked.
    return {
      outcome: {
        status: 'error',
        error: {
          code: 'DISCONNECTED',
          message: `Lost the page during execution: ${String((e as Error)?.message ?? e)}`,
          execution: 'outcome_unknown',
        },
      },
      executionStopped: false,
    }
  }
}

function unknownPage(message: string): control.ExecuteResponse {
  return {
    outcome: { status: 'error', error: { code: 'STALE_DOCUMENT', message, execution: 'not_started' } },
    executionStopped: true,
  }
}

function cancelInTab(requestId: Id): void {
  // The request ID is not page-scoped here, so ask every enabled page; only the
  // one actually running it has anything to cancel.
  for (const page of enabledPages.values()) {
    void browser.tabs.sendMessage(page.tabId, { type: 'JANUS_BT_CANCEL', requestId }).catch(() => {})
  }
}

export function outcomeText(outcome: ToolOutcome): string {
  return outcome.status === 'completed' ? 'completed' : outcome.error.code
}
