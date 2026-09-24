/**
 * Extension-side view of the Janus WebMCP v1 contracts.
 *
 * These are type-only re-exports of the canonical definitions in
 * `packages/mcp-server/src/contracts/types.ts`, so the extension and the
 * daemon cannot drift the way `packages/mcp-server/src/types.ts` drifts from
 * `src/lib/event-capture/types.ts` today. Type-only imports are erased at
 * build time, so nothing from the daemon package is bundled into the
 * extension.
 *
 * Design reference: docs/superpowers/specs/2026-09-24-webmcp-tools-and-browser-bridge-design.md
 */

export type {
  Applicability,
  AuthoringBinding,
  CancelTool,
  ControlMessage,
  DaemonToExtension,
  DefinitionApproval,
  DefinitionProposal,
  DefinitionProposed,
  DefinitionResult,
  DraftRemoved,
  DraftUpsert,
  ErrorCode,
  Evidence,
  ExecuteTool,
  ExecutionState,
  ExtensionToDaemon,
  GeneratedDefinition,
  GeneratedInputSchema,
  Heartbeat,
  Hello,
  HelloAck,
  Id,
  Json,
  JsonSchema,
  LiveInstance,
  PageDescriptor,
  PageId,
  PageRemoved,
  PagesSync,
  PageToolCall,
  ParameterBinding,
  ParameterSlot,
  RecipeStep,
  RequestValueMatch,
  Revision,
  Scalar,
  ScalarSchema,
  ToolDescriptor,
  ToolDraft,
  ToolError,
  ToolOutcome,
  ToolResult,
  ToolsChanged,
  ToolSource,
  ValueRef,
} from '@@/packages/mcp-server/src/contracts/types'

export {
  M1_MESSAGE_TYPES,
  M2_MESSAGE_TYPES,
  RECIPE_OPS,
} from '@@/packages/mcp-server/src/contracts/types'

import type { Id, PageId, ToolDescriptor } from '@@/packages/mcp-server/src/contracts/types'

/**
 * Browser-only ownership. Never serialized to MCP or the WebSocket, and
 * deliberately absent from the daemon contract: it holds live DOM handles
 * (`AbortController`, `Window`) that have no meaning in Node.
 */
export interface BrowserLiveInstance {
  pageId: PageId
  documentId: Id
  descriptor: ToolDescriptor
  /**
   * Only Janus-owned registrations have a controller. A site's own tools are
   * registered by the site and must never be aborted by us — `ModelContext`
   * has no `unregisterTool()`, so aborting a foreign signal would silently
   * break the host page's own agent integration.
   */
  registrationController?: AbortController
  nativeHandle?: { name: string; origin: string; window: Window }
}
