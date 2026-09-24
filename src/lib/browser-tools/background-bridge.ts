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
}

export interface PairingConfig {
  url: string
  pairingId: string
  token: string
  browserSessionId: Id
}

const STORAGE_KEY = 'janus_browser_tools'

/** At most one enabled page in v1 (§18); replacement is explicit. */
let enabled: EnabledPage | null = null
let pairing: PairingConfig | null = null

function randomPageId(): PageId {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function getEnabledPage(): EnabledPage | null {
  return enabled
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
export async function enablePage(tabId: number, label?: string): Promise<EnabledPage> {
  const tab = await browser.tabs.get(tabId)
  const url = tab.url ?? ''
  const origin = (() => { try { return new URL(url).origin } catch { return '' } })()
  if (!origin.startsWith('http')) throw new Error('Only http(s) pages can be enabled')

  const info = await browser.tabs.sendMessage(tabId, { type: 'JANUS_BT_DESCRIBE' }) as {
    documentId: string
    nativeCapability: PageDescriptor['nativeCapability']
  }

  if (enabled && enabled.tabId !== tabId) {
    // Never move execution implicitly because the user switched tabs.
    control.removePage(enabled.pageId, enabled.documentId, 'disabled')
  }

  const trimmed = (label ?? tab.title ?? origin).trim().slice(0, LIMITS.pageLabelMaxLength)
  enabled = {
    pageId: randomPageId(),
    tabId,
    documentId: info.documentId,
    label: trimmed || origin,
    title: tab.title ?? '',
    url,
    origin,
    nativeCapability: info.nativeCapability,
  }

  publishPages()
  await refreshTools()
  return enabled
}

export function disablePage(reason: 'navigation' | 'closed' | 'disabled' = 'disabled'): void {
  if (!enabled) return
  control.removePage(enabled.pageId, enabled.documentId, reason)
  enabled = null
  publishPages()
}

export function setLabel(label: string): EnabledPage | null {
  if (!enabled) return null
  const trimmed = label.trim().slice(0, LIMITS.pageLabelMaxLength)
  if (trimmed.length < LIMITS.pageLabelMinLength) throw new Error('Label cannot be empty')
  // A label is display metadata; it never affects identity or revision (§7).
  enabled = { ...enabled, label: trimmed }
  publishPages()
  return enabled
}

function publishPages(): void {
  control.publishPages(enabled ? [{
    pageId: enabled.pageId,
    browserSessionId: pairing?.browserSessionId ?? 'browser',
    tabId: enabled.tabId,
    frameId: 0,
    documentId: enabled.documentId,
    label: enabled.label,
    title: enabled.title,
    url: enabled.url,
    origin: enabled.origin,
    nativeCapability: enabled.nativeCapability,
    execution: { state: 'idle' },
  }] : [])
}

// ── Authoring (M2) ─────────────────────────────────────────────────────────

/** Capture a draft from the enabled page and offer it to the agent. */
export async function captureDraft(principalId: string): Promise<{ draft?: ToolDraft; unsupported?: unknown; error?: string }> {
  if (!enabled) return { error: 'No page is enabled' }
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

/** Push currently enabled definitions to the page and republish its tools. */
export async function syncDefinitions(): Promise<void> {
  if (!enabled) return
  const definitions = await store.enabledDefinitions()
  try {
    await browser.tabs.sendMessage(enabled.tabId, { type: 'JANUS_BT_SET_DEFINITIONS', definitions })
    await refreshTools()
  } catch {
    disablePage('closed')
  }
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
export async function testDefinition(definitionId: string, input: Record<string, never>) {
  if (!enabled) return { error: 'No page is enabled' }
  const definitions = await store.allDefinitions()
  const definition = definitions.find((d) => d.definitionId === definitionId)
  if (!definition) return { error: 'No such definition' }

  return browser.tabs.sendMessage(enabled.tabId, {
    type: 'JANUS_BT_TEST_RUN', definition, input, timeoutMs: LIMITS.invocationDeadlineMs,
  })
}

export async function refreshTools(): Promise<void> {
  if (!enabled) return
  try {
    const tools = await browser.tabs.sendMessage(enabled.tabId, { type: 'JANUS_BT_LIST_TOOLS' }) as ToolDescriptor[]
    control.publishTools(enabled.pageId, enabled.documentId, tools ?? [])
  } catch {
    // The content script is gone, so the document is effectively destroyed.
    disablePage('closed')
  }
}

/** Navigation replaces the document, which invalidates the page handle (§7). */
export async function onNavigated(tabId: number): Promise<void> {
  if (!enabled || enabled.tabId !== tabId) return
  disablePage('navigation')
}

async function executeInTab(request: control.ExecuteRequest): Promise<control.ExecuteResponse> {
  const page = enabled
  if (!page || page.pageId !== request.pageId) {
    return unknownPage('The page is no longer enabled')
  }
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
  if (!enabled) return
  void browser.tabs.sendMessage(enabled.tabId, { type: 'JANUS_BT_CANCEL', requestId }).catch(() => {})
}

export function outcomeText(outcome: ToolOutcome): string {
  return outcome.status === 'completed' ? 'completed' : outcome.error.code
}
