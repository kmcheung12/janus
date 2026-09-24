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

export function currentDocumentId(): string {
  return documentId
}

/** A new document always gets a new handle; nothing carries across (§7). */
export function resetDocument(): void {
  documentId = crypto.randomUUID()
  withdrawAll()
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
    toolId: `generated:${definition.definitionId}`,
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

  registerGenerated(generated)
  const tools = [...nativeTools, ...generated]
  onToolsChanged?.()
  return tools
}

/**
 * Publish generated handlers through WebMCP where the browser supports it, so
 * the site's own agent can use them too. Purely additive: Janus MCP exposes
 * them regardless, which is why the generated path has no WebMCP dependency.
 */
function registerGenerated(descriptors: ToolDescriptor[]): void {
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
        signal: controller.signal,
        execute: async (input: Record<string, Json>) => {
          const outcome = await invoke(descriptor.toolId, input)
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
}

function withdrawAll(): void {
  for (const instance of liveInstances) instance.registrationController?.abort()
  liveInstances = []
}

export async function invoke(
  toolId: string,
  input: Record<string, Json>,
  requestId: string = crypto.randomUUID(),
  timeoutMs = 30_000,
): Promise<ToolOutcome> {
  const controller = new AbortController()
  running.set(requestId, controller)

  // Anything the page emits from here until we finish is attributable to this
  // invocation, so journeys can separate agent effects from human ones.
  const release = setInvocationActor(requestId)

  try {
    if (toolId.startsWith('native:')) {
      return await native.invoke(toolId, input)
    }

    const definitionId = toolId.replace(/^generated:/, '')
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
