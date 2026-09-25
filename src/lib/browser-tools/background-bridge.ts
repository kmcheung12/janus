/**
 * Background-side routing for the command bridge (§6).
 *
 * The background owns the daemon connection and the pairing credential, and is
 * the only place that decides which document an invocation reaches. Content
 * scripts can execute what they are given but cannot enable a page, claim
 * executor authority or read the credential.
 */

import type { Id, PageDescriptor, PageId, ToolDescriptor, ToolOutcome } from './contract'
import { sanitizeUrl, hasCredentialParams } from './url-safety'
import * as grants from './grants'
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
/** Read-only tool IDs per page, from the last published snapshot. */
const readOnlyTools = new Map<PageId, Set<Id>>()
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

  /*
   * Re-seed the snapshot the handshake will republish.
   *
   * `stop()` drops the published pages along with the credential they were
   * published under, which is right — but this map, not the control client's
   * copy, is what is actually enabled. Without this, re-pairing hands the
   * daemon an empty pages_sync, and a snapshot is complete by definition: it
   * withdraws every page. The popup still lists them, the daemon has none, and
   * nothing republishes until someone enables or disables a page by hand.
   */
  publishPages()
  await refreshTools()
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
  // Enabling a page authorizes its origin, so a navigation within that origin
  // re-mints a handle instead of waiting for another click.
  await grants.grant(origin, enabled.allowAutoWrites)

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
  readOnlyTools.delete(page.pageId)

  // Only an explicit disable revokes the grant. Otherwise "Disable tools on
  // this page" would mean nothing: the next navigation would re-mint a handle
  // for the origin the user had just withdrawn. Navigation and tab closure
  // withdraw the document, which is not the same as withdrawing authority.
  if (reason === 'disabled') void grants.revoke(page.origin)
  // Tell the document it is no longer enabled. Withdrawal from the daemon is
  // already done above; this is so anything rendering in the page stops
  // claiming the tools are reachable. A closed or navigated tab cannot
  // receive it, which is harmless — that document is gone either way.
  browser.tabs.sendMessage(tabId, { type: 'JANUS_BT_SET_ENABLED', enabled: false })
    .catch(() => {})
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
  // The grant carries the write opt-in, so it survives navigation with the
  // rest of the authorization rather than silently resetting on the next page.
  await grants.setWrites(page.origin, allow)
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

export /**
 * `navigate` is served here, not by the content script.
 *
 * A page-served version would have to reply through the handle its own
 * navigation destroys, which is the outcome_unknown case again. The background
 * outlives the document and answers once the new handle exists.
 */
const NAVIGATE_TOOL_ID = 'bg_navigate'

function navigateDescriptor(origin: string): ToolDescriptor {
  return {
    toolId: NAVIGATE_TOOL_ID,
    toolRevision: 1,
    source: { kind: 'generated', definitionId: 'builtin_navigate', definitionRevision: 1 },
    name: 'navigate',
    description:
      `Go to another page on ${origin}. Same origin only — another site needs its own `
      + 'grant. Returns the new page handle, which replaces the one you called this with.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: `Absolute or root-relative URL on ${origin}.` },
      },
      required: ['url'],
      additionalProperties: false,
    } as unknown as ToolDescriptor['inputSchema'],
    readOnlyHint: false,
    consequentialHint: true,
  }
}

async function runNavigate(
  page: EnabledPage, input: Record<string, unknown>,
): Promise<control.ExecuteResponse> {
  const requested = String(input.url ?? '')
  let target: URL
  try {
    target = new URL(requested, `${page.origin}/`)
  } catch {
    return toolError('INVALID_INPUT', `"${requested}" is not a URL`)
  }

  if (target.origin !== page.origin) {
    return toolError(
      'UNAUTHORIZED',
      `${target.origin} is outside this grant. Enable that site to reach it.`,
    )
  }

  /*
   * Rejected, not stripped. A caller asking for logout?auth=... is either
   * working from stale output or has been injected, and quietly visiting
   * /logout instead would be worse than refusing. Read tools redact these on
   * the way out, so a URL that still carries one did not come from us.
   */
  if (hasCredentialParams(target.href)) {
    return toolError('INVALID_INPUT', 'That URL carries a session token and was refused.')
  }

  /*
   * Answer first, then navigate.
   *
   * Committing the navigation withdraws this page handle, and the daemon
   * fails anything still in flight for a withdrawn page as DISCONNECTED —
   * correctly, since it cannot know whether a lost call took effect. Awaiting
   * our own navigation would therefore guarantee an unknown outcome for the
   * one case that is entirely expected.
   *
   * So the new handle cannot ride along in this result; the agent calls
   * list_pages once the grant has re-minted it.
   */
  setTimeout(() => {
    void browser.tabs.update(page.tabId, { url: target.href }).catch(() => {})
  }, 0)

  return {
    outcome: {
      status: 'completed',
      result: {
        navigating: true,
        url: sanitizeUrl(target.href),
        note: 'This page handle is now gone. Call list_pages for the new one.',
      },
    },
    executionStopped: true,
  }
}

function toolError(code: string, message: string): control.ExecuteResponse {
  return {
    outcome: {
      status: 'error',
      error: { code, message, execution: 'not_started' } as ToolOutcome extends { error: infer E } ? E : never,
    } as ToolOutcome,
    executionStopped: true,
  }
}

export async function refreshTools(tabId?: number): Promise<void> {
  const targets = tabId !== undefined
    ? [enabledPages.get(tabId)].filter(Boolean) as EnabledPage[]
    : [...enabledPages.values()]

  await Promise.all(targets.map(async (page) => {
    try {
      const tools = await browser.tabs.sendMessage(page.tabId, { type: 'JANUS_BT_LIST_TOOLS' }) as ToolDescriptor[]
      const published = [...(tools ?? []), navigateDescriptor(page.origin)]
      // Kept so dispatch can tell a read from an act without asking the page
      // again — see the navigation settle in executeInTab.
      readOnlyTools.set(page.pageId, new Set(
        published.filter((t) => t.readOnlyHint).map((t) => t.toolId),
      ))
      control.publishTools(page.pageId, page.documentId, published)
    } catch {
      // The content script is gone, so the document is effectively destroyed.
      disablePage(page.tabId, 'closed')
    }
  }))
}

interface Navigation { url: string }

/**
 * Invocations waiting to learn that their tab navigated.
 *
 * A navigation destroys the content script, and the pending
 * `tabs.sendMessage` promise then neither resolves nor rejects — it simply
 * hangs until the daemon's deadline. Waiting for the rejection is therefore
 * not enough; the navigation has to be raced against the call.
 */
const navigationWaiters = new Map<number, Set<(nav: Navigation) => void>>()

function whenNavigated(tabId: number): { promise: Promise<Navigation>; cancel: () => void } {
  let settle: (nav: Navigation) => void = () => {}
  const promise = new Promise<Navigation>((resolve) => { settle = resolve })
  const waiters = navigationWaiters.get(tabId) ?? new Set()
  waiters.add(settle)
  navigationWaiters.set(tabId, waiters)
  return {
    promise,
    cancel: () => {
      waiters.delete(settle)
      if (!waiters.size) navigationWaiters.delete(tabId)
    },
  }
}

/** Navigation replaces the document, which invalidates that page handle (§7). */
export async function onNavigated(tabId: number): Promise<void> {
  let url = ''
  try {
    const tab = await browser.tabs.get(tabId)
    url = sanitizeUrl(tab.url ?? '')
  } catch {
    // The tab is gone, which is the unknown-outcome case, not this one.
  }

  const waiters = navigationWaiters.get(tabId)
  if (waiters) {
    navigationWaiters.delete(tabId)
    for (const settle of waiters) settle({ url })
  }

  /*
   * Let a waiting invocation answer before the handle is withdrawn.
   *
   * Settling above only queues a microtask; disabling synchronously would
   * withdraw the page first, and the daemon fails anything still in flight for
   * a withdrawn page as DISCONNECTED. The call would then report an unknown
   * outcome for an ordinary form submit — the one case we can describe
   * precisely. One turn of the event loop is enough for the response to be
   * on its way, and the document is already gone regardless.
   */
  if (waiters?.size) await new Promise((r) => setTimeout(r, 0))

  disablePage(tabId, 'navigation')
  scheduleRemint(tabId)
}

/**
 * Re-minting is deferred; withdrawal above is not.
 *
 * A redirect chain (/ -> /login -> /home) commits three times and would
 * otherwise mint three handles and three pages_sync rounds for documents no
 * agent will ever address. Dropping the old handle late, on the other hand,
 * would leave a window in which a call could be dispatched into a document
 * that has already gone — the outcome_unknown case. Fail fast down, settle up.
 */
const REMINT_SETTLE_MS = 250

/**
 * How long a tool that can act waits to see whether it navigated.
 *
 * Long enough for the browser to commit a same-document click, short enough
 * that it is not felt on a click that goes nowhere — which is most of them.
 */
const NAVIGATION_SETTLE_MS = 400
const remintTimers = new Map<number, ReturnType<typeof setTimeout>>()

function scheduleRemint(tabId: number): void {
  const existing = remintTimers.get(tabId)
  if (existing !== undefined) clearTimeout(existing)
  remintTimers.set(tabId, setTimeout(() => {
    remintTimers.delete(tabId)
    void remintIfGranted(tabId)
  }, REMINT_SETTLE_MS))
}

async function remintIfGranted(tabId: number): Promise<void> {
  if (enabledPages.has(tabId)) return
  try {
    const tab = await browser.tabs.get(tabId)
    const granted = await grants.grantFor(tab.url ?? '')
    if (!granted) return
    await enablePage(tabId, tab.title, granted.allowWrites)
  } catch {
    // The tab closed, or the document is not ready. Nothing to re-mint.
  }
}

async function executeInTab(request: control.ExecuteRequest): Promise<control.ExecuteResponse> {
  // Routed by page handle, never by "the active tab": several pages can be
  // enabled, and the caller named exactly one.
  const page = pageById(request.pageId)
  if (!page) return unknownPage('The page is no longer enabled')
  if (page.documentId !== request.documentId) {
    return unknownPage('The document changed before dispatch')
  }

  if (request.toolId === NAVIGATE_TOOL_ID) {
    return runNavigate(page, request.arguments as Record<string, unknown>)
  }

  const origin = page.origin
  const navigation = whenNavigated(page.tabId)

  try {
    const raced = await Promise.race([
      browser.tabs.sendMessage(page.tabId, {
        type: 'JANUS_BT_INVOKE',
        requestId: request.requestId,
        toolId: request.toolId,
        input: request.arguments,
        timeoutMs: request.timeoutMs,
      }).then((outcome) => ({ kind: 'outcome' as const, outcome: outcome as control.ExecuteResponse })),
      navigation.promise.then((nav) => ({ kind: 'navigated' as const, nav })),
    ])

    if (raced.kind !== 'outcome') return navigatedResult(raced.nav, origin)

    /*
     * A click answers before the navigation it started.
     *
     * The page resolves the moment the click dispatches, so it wins this race
     * and the agent is told `{clicked: "..."}` and nothing else — while the
     * document it was holding is being replaced underneath. A submit loses the
     * same race and is told exactly what happened, which is the behaviour that
     * made link-following debuggable. The difference was timing, not intent.
     *
     * So give the navigation a moment to commit before answering, and only for
     * tools that can act: a read cannot navigate, and must not pay for this.
     */
    if (readOnlyTools.get(request.pageId)?.has(request.toolId)) return raced.outcome
    const nav = await Promise.race([
      navigation.promise,
      new Promise<null>((r) => setTimeout(() => r(null), NAVIGATION_SETTLE_MS)),
    ])
    return nav ? withNavigation(raced.outcome, nav, origin) : raced.outcome
  } catch (e) {
    /*
     * A submit that navigates is not a lost page.
     *
     * The document is replaced, so the content script — and any result
     * binding it was about to read — is gone. Nothing can extract a result
     * from a page that no longer exists, in Janus or in WebMCP, whose
     * handlers are in-page functions with the same fate. Reporting the
     * destination is the honest ceiling; reporting success with whatever
     * fragment survived is how search(q) came back as "Search:".
     */
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
  } finally {
    navigation.cancel()
  }
}

/**
 * A submit that navigates is not a lost page.
 *
 * The document is replaced, so the content script — and any result binding it
 * was about to read — is gone. Nothing can extract a result from a page that
 * no longer exists, in Janus or in WebMCP, whose handlers are in-page
 * functions with the same fate. Reporting the destination is the honest
 * ceiling; reporting success with whatever fragment survived is how
 * search(q="jev") came back as "Search:".
 */
function isSameOrigin(nav: Navigation, origin: string): boolean {
  return nav.url === origin || nav.url.startsWith(`${origin}/`)
}

/**
 * Same-origin no longer means "re-enable by hand": the grant re-mints a handle
 * on its own, so telling the agent to go and click something was both wrong
 * and the reason a navigation looked like a dead end.
 */
function navigationNote(sameOrigin: boolean): string {
  return sameOrigin
    ? 'This document and its tools were withdrawn. The grant re-mints a handle for the new page; call list_pages for it.'
    : 'That went to another origin. Janus has no tools there until that site is enabled.'
}

/** Keep what the tool returned and say where the page went. */
function withNavigation(
  response: control.ExecuteResponse, nav: Navigation, origin: string,
): control.ExecuteResponse {
  // An error already describes its own failure; navigation is not the story.
  if (response.outcome.status !== 'completed') return response
  const sameOrigin = isSameOrigin(nav, origin)
  const result = response.outcome.result
  return {
    outcome: {
      status: 'completed',
      result: {
        ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { result }),
        navigated: true,
        url: nav.url,
        sameOrigin,
        note: navigationNote(sameOrigin),
      },
    },
    executionStopped: true,
  }
}

function navigatedResult(nav: Navigation, origin: string): control.ExecuteResponse {
  const sameOrigin = isSameOrigin(nav, origin)
  return {
    outcome: {
      status: 'completed',
      result: {
        navigated: true,
        url: nav.url,
        sameOrigin,
        note: navigationNote(sameOrigin),
      },
    },
    executionStopped: true,
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
