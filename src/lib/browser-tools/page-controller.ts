/**
 * Per-document tool controller, running in the content script.
 *
 * Owns discovery for one top-level document, registers Janus-generated tools
 * through WebMCP where available, and executes invocations routed from the
 * background.
 */

import type { GeneratedDefinition, Json, ToolDescriptor, ToolOutcome } from './contract'
import type { BrowserLiveInstance } from './contract'
import * as native from './native-adapter'
import * as auto from './auto-tools'
import * as activity from './activity-log'
import { run } from './recipe-runtime'
import { setInvocationActor } from './provenance'

export interface ControllerState {
  documentId: string
  enabled: boolean
  definitions: GeneratedDefinition[]
}

const running = new Map<string, AbortController>()
let liveInstances: BrowserLiveInstance[] = []
let definitions: GeneratedDefinition[] = []
let documentId = crypto.randomUUID()
let onToolsChanged: (() => void) | null = null
/** Last published snapshot, so an invocation can name the tool it is running. */
let lastTools: ToolDescriptor[] = []
/**
 * Whether the user has enabled this page. `publish()` computes the tool set a
 * page *would* expose and is called on pages nobody enabled, so this is the
 * only thing that distinguishes "these tools are reachable" from "these tools
 * would exist if you turned this page on".
 */
let pageEnabled = false
/** Signature of the last announced set; `null` so the first publish announces. */
let lastSignature: string | null = null
const toolListeners = new Set<(tools: ToolDescriptor[], enabled: boolean) => void>()
/** Auto-generated form tools publish only when the user opts this page in. */
let allowAutoWrites = false
let autoPageId = ''
let autoForms: GeneratedDefinition[] = []

export function setAutoOptions(options: { pageId: string; allowWrites: boolean }): void {
  autoPageId = options.pageId
  allowAutoWrites = options.allowWrites
  // Only an enabled page is sent these, so this doubles as the enable signal.
  setPageEnabled(true)
}

/** Enablement is the background's to decide; the page only reflects it. */
export function setPageEnabled(next: boolean): void {
  if (pageEnabled === next) return
  pageEnabled = next
  for (const listener of toolListeners) listener([...lastTools], pageEnabled)
}

export function isPageEnabled(): boolean {
  return pageEnabled
}

export function currentDocumentId(): string {
  return documentId
}

/** A new document always gets a new handle; nothing carries across (§7). */
export function resetDocument(): void {
  documentId = crypto.randomUUID()
  withdrawAll()
  activity.reset()
  // A new document must announce its set even if it happens to match the old
  // one, because the daemon dropped the previous handle's tools entirely.
  lastSignature = null
  // A new document is not an enabled one until the background says so (§7).
  setPageEnabled(false)
}

/**
 * Watch the published tool set. Separate from `observeToolChanges`, which is
 * the single background-facing republish hook — the on-page panel is another
 * reader and must not displace it.
 */
export function subscribeTools(
  listener: (tools: ToolDescriptor[], enabled: boolean) => void,
): () => void {
  toolListeners.add(listener)
  listener([...lastTools], pageEnabled)
  return () => { toolListeners.delete(listener) }
}

export function setDefinitions(next: GeneratedDefinition[]): void {
  definitions = next
  void publish()
}

export function observeToolChanges(listener: () => void): () => void {
  onToolsChanged = listener
  const stop = native.onToolsChanged(() => { void publish() })
  return () => { onToolsChanged = null; stop() }
}

function applicable(definition: GeneratedDefinition): boolean {
  const { origin, pathnamePrefix } = definition.applicability
  if (window.location.origin !== origin) return false
  const path = window.location.pathname
  return path === pathnamePrefix
    || path.startsWith(pathnamePrefix.endsWith('/') ? pathnamePrefix : `${pathnamePrefix}/`)
}

function generatedDescriptor(definition: GeneratedDefinition): ToolDescriptor {
  return {
    toolId: `g_${definition.definitionId}`,
    toolRevision: definition.definitionRevision,
    source: {
      kind: 'generated',
      definitionId: definition.definitionId,
      definitionRevision: definition.definitionRevision,
    },
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema as unknown as ToolDescriptor['inputSchema'],
    readOnlyHint: definition.annotations.readOnly,
    consequentialHint: definition.annotations.consequential,
  }
}

/** Current complete tool snapshot for this document. */
export async function publish(): Promise<ToolDescriptor[]> {
  const nativeTools = await native.discover()
  const generated = definitions.filter(applicable).map(generatedDescriptor)

  // Automatic tools fill the gap on pages that expose nothing themselves. A
  // site's own tools are better than anything we can infer, so they are not
  // added where native WebMCP already answers.
  const hasNative = nativeTools.length > 0
  const automatic: ToolDescriptor[] = []
  autoForms = []

  if (!hasNative) {
    automatic.push(...auto.readToolDescriptors())
    if (allowAutoWrites) {
      // Clicking is a write: it can do anything the page's own buttons do.
      automatic.push(auto.clickToolDescriptor())
      autoForms = auto.autoFormDefinitions(autoPageId || documentId, documentId)
      automatic.push(...autoForms.map(auto.formToolDescriptor))
    }
  }

  // One scoped set, one policy: what this page publishes to the daemon is
  // exactly what it registers through WebMCP. Native tools are excluded — the
  // site already owns those registrations.
  const janusTools = [...generated, ...automatic]
  registerJanusTools(janusTools)
  const tools = [...nativeTools, ...janusTools]
  lastTools = tools

  /*
   * Announce only a real change.
   *
   * The background republishes by asking the page for its tools, and this
   * function is what answers. Announcing unconditionally therefore closes a
   * cycle: LIST_TOOLS -> publish -> TOOLS_CHANGED -> refreshTools ->
   * LIST_TOOLS, running as fast as message passing allows and amplified
   * across every enabled page, because refreshTools() without a tab id hits
   * all of them.
   *
   * Chrome's service worker is torn down between wakeups often enough to hide
   * it. Firefox's persistent background page is not, so it pins a core.
   *
   * Comparing the published set breaks the cycle at the first steady state and
   * costs one small string per publish.
   */
  const signature = toolSignature(tools)
  const changed = signature !== lastSignature
  lastSignature = signature
  if (!changed) return tools

  for (const listener of toolListeners) listener([...tools], pageEnabled)
  onToolsChanged?.()
  return tools
}

/** Identity, revision and name: everything a consumer keys off. */
function toolSignature(tools: ToolDescriptor[]): string {
  return tools.map((t) => `${t.toolId}@${t.toolRevision}:${t.name}`).join('|')
}

/**
 * Publish the tools this page scopes to Janus through WebMCP where the browser
 * supports it, so the site's own agent can use them too. Purely additive:
 * Janus MCP exposes the same set regardless, which is why this path is not a
 * dependency of publishing.
 *
 * The argument is the same list sent to the daemon, minus the site's own
 * tools. Registration scope is the only control here — WebMCP has no per-call
 * authorization, so a tool the user has not scoped to this page must not reach
 * this function at all.
 */
function registerJanusTools(descriptors: ToolDescriptor[]): void {
  const context = (document as unknown as {
    modelContext?: { registerTool?: (tool: unknown) => void }
  }).modelContext
  if (typeof context?.registerTool !== 'function') return

  withdrawAll()

  for (const descriptor of descriptors) {
    const controller = new AbortController()
    try {
      context.registerTool({
        name: descriptor.name,
        description: descriptor.description,
        inputSchema: descriptor.inputSchema,
        /*
         * Without these a consumer cannot tell a read from an act, so every
         * Janus tool looks equally safe to call unattended — the one thing the
         * hints exist to prevent. Both spellings are emitted: the WebMCP draft
         * says `consequential`, Chrome's own tools carry `consequentialHint`,
         * and a consumer reading only the other one would see neither.
         */
        annotations: {
          readOnlyHint: descriptor.readOnlyHint,
          consequential: descriptor.consequentialHint,
          consequentialHint: descriptor.consequentialHint,
        },
        signal: controller.signal,
        execute: async (input: Record<string, Json>) => {
          const outcome = await invoke(
            descriptor.toolId, input, crypto.randomUUID(), 30_000, 'webmcp',
          )
          if (outcome.status === 'completed') return outcome.result
          return { success: false, reason: outcome.error.code }
        },
      })
      liveInstances.push({
        pageId: '' as never,
        documentId,
        descriptor,
        // Only our own registrations carry a controller. `ModelContext` has no
        // unregisterTool(), so aborting a signal we did not create would
        // silently break the site's own integration.
        registrationController: controller,
      })
    } catch {
      // registerTool throws on a duplicate name, which means the site already
      // owns this tool. Defer to it rather than competing.
    }
  }

  // Exactly what is registered right now, so discover() can tell our tools
  // from the site's. A name we failed to register is deliberately absent: the
  // site owns it, and it must keep coming back as native.
  native.markOwnRegistrations(
    liveInstances
      .filter((i) => i.registrationController)
      .map((i) => i.descriptor.name),
  )
}

function withdrawAll(): void {
  for (const instance of liveInstances) instance.registrationController?.abort()
  liveInstances = []
}

/**
 * The one path every served call takes, whichever consumer asked — so it is
 * also the only place activity has to be recorded for the panel to be
 * complete with respect to what Janus runs.
 */
export async function invoke(
  toolId: string,
  input: Record<string, Json>,
  requestId: string = crypto.randomUUID(),
  timeoutMs = 30_000,
  caller: activity.Caller = 'daemon',
): Promise<ToolOutcome> {
  activity.began(requestId, toolId, displayName(toolId), caller, input)
  const outcome = await execute(toolId, input, requestId, timeoutMs)
  activity.ended(requestId, outcome)
  return outcome
}

/** Falls back to the raw id: a tool can be invoked before any publish lands. */
function displayName(toolId: string): string {
  return lastTools.find((t) => t.toolId === toolId)?.name ?? toolId
}

async function execute(
  toolId: string,
  input: Record<string, Json>,
  requestId: string,
  timeoutMs: number,
): Promise<ToolOutcome> {
  const controller = new AbortController()
  running.set(requestId, controller)

  // Anything the page emits from here until we finish is attributable to this
  // invocation, so journeys can separate agent effects from human ones.
  const release = setInvocationActor(requestId)

  try {
    if (toolId.startsWith('n_')) {
      return await native.invoke(toolId, input)
    }

    if (auto.isAutoToolId(toolId)) {
      const formDefinition = autoForms.find(
        (d) => d.definitionId === auto.autoFormDefinitionId(toolId),
      )
      if (formDefinition) {
        if (!allowAutoWrites) {
          return {
            status: 'error',
            error: {
              code: 'UNAUTHORIZED',
              message: 'Form tools are not enabled for this page. Turn them on in the Janus popup.',
              execution: 'not_started',
            },
          }
        }
        const outcome = await run({
          definition: formDefinition, input, signal: controller.signal, timeoutMs,
        })
        return outcome.outcome
      }
      return auto.invokeReadTool(toolId, input)
    }

    const definitionId = toolId.replace(/^g_/, '')
    const definition = definitions.find((d) => d.definitionId === definitionId)
    if (!definition) {
      return {
        status: 'error',
        error: { code: 'TOOL_UNAVAILABLE', message: `No enabled definition "${definitionId}"`, execution: 'not_started' },
      }
    }

    const result = await run({ definition, input, signal: controller.signal, timeoutMs })
    return result.outcome
  } finally {
    release()
    running.delete(requestId)
  }
}

/** Requesting cancellation is not the same as observing termination (§10). */
export function cancel(requestId: string): void {
  running.get(requestId)?.abort()
}

export function isRunning(requestId: string): boolean {
  return running.has(requestId)
}

export function nativeCapability() {
  return native.capability()
}

/** How many tools the *site* registers, which is not the same as API support. */
export async function nativeToolCount(): Promise<number> {
  return (await native.discover()).length
}
