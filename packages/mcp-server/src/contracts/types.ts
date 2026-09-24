/**
 * Janus WebMCP v1 wire and authoring contracts.
 *
 * Canonical source for both the daemon and the extension. The extension
 * re-exports these through `src/lib/browser-tools/contract.ts` with a
 * type-only import, so there is exactly one definition of every shape.
 *
 * Design reference: docs/superpowers/specs/2026-09-24-webmcp-tools-and-browser-bridge-design.md
 * Runtime counterpart:  ./contracts.schema.json (validated, not merely asserted)
 *
 * Adding a `RecipeStep` operation requires revising both this file and the
 * schema, plus validation and execution tests. See §17.
 */

export type Id = string // ASCII [A-Za-z0-9_-], 1..96 characters
export type PageId = string // 32 lowercase hexadecimal characters, random 128-bit ID
export type Revision = number // positive safe integer
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type JsonSchema = { [key: string]: Json }
export type Scalar = string | number | boolean

export type ScalarSchema =
  | { type: 'string'; description?: string; minLength?: number; maxLength?: number; enum?: string[] }
  | { type: 'number' | 'integer'; description?: string; minimum?: number; maximum?: number }
  | { type: 'boolean'; description?: string }

export interface GeneratedInputSchema {
  type: 'object'
  properties: Record<string, ScalarSchema>
  required: string[]
  additionalProperties: false
}

export type ValueRef =
  | { kind: 'literal'; value: Scalar }
  | { kind: 'slot'; slotId: Id }

export type RequestValueMatch =
  | { location: 'query'; key: string; expected: ValueRef }
  | { location: 'json_body'; pointer: string; expected: ValueRef }

export type AuthoringBinding =
  | {
      kind: 'control'; id: Id; selector: string
      control: 'text' | 'number' | 'checkbox' | 'select_one' | 'button' | 'form'
      allowedValues?: string[]
    }
  | {
      kind: 'response'; id: Id; origin: string; pathname: string
      method: 'GET' | 'POST'; statuses: number[]; match: RequestValueMatch[]
    }
  | { kind: 'dom_result'; id: Id; targetId: Id; read: 'text' | 'value' | 'checked' }
  | { kind: 'json_result'; id: Id; observerStepId: Id; pointer: string }

/** Closed vocabulary: no custom step, expression, function or catch-all member. */
export type RecipeStep =
  | { op: 'set_field'; id: Id; targetId: Id; value: ValueRef }
  | { op: 'select_option'; id: Id; targetId: Id; value: ValueRef }
  | { op: 'click'; id: Id; targetId: Id }
  | { op: 'submit_form'; id: Id; targetId: Id }
  | { op: 'observe_response'; id: Id; responseBindingId: Id }
  | {
      op: 'await_condition'; id: Id; timeoutMs: number
      condition:
        | { kind: 'dom'; targetId: Id; state: 'visible' | 'hidden' | 'enabled' }
        | { kind: 'response'; observerStepId: Id }
    }
  | { op: 'extract_result'; id: Id; fields: Array<{ name: string; bindingId: Id }> }

/** Every `RecipeStep['op']`, for exhaustiveness tests and schema cross-checks. */
export const RECIPE_OPS = [
  'set_field', 'select_option', 'click', 'submit_form',
  'observe_response', 'await_condition', 'extract_result',
] as const satisfies ReadonlyArray<RecipeStep['op']>

export interface ParameterSlot { id: Id; constraint: ScalarSchema; sensitive: boolean }
export interface ParameterBinding { slotId: Id; name: string }
export interface Applicability { origin: string; pathnamePrefix: string }

export interface Evidence {
  id: Id
  kind: 'form' | 'journey' | 'test_response'
  summary: string
  sample?: Json
  completeness: 'complete' | 'truncated' | 'unavailable'
  attribution: 'confirmed' | 'temporal' | 'unknown'
}

export interface ToolDraft {
  id: Id; revision: Revision; principalId: Id
  browserSessionId: Id; pageId: PageId; documentId: Id
  applicability: Applicability
  status: 'pending' | 'submitted' | 'expired'
  createdAt: number; expiresAt: number
  bindings: AuthoringBinding[]
  slots: ParameterSlot[]
  candidateSteps: RecipeStep[]
  requiredStepIds: Id[]
  evidence: Evidence[]
}

/** Client can propose semantics and select existing candidates, not write recipes. */
export interface DefinitionProposal {
  name: string
  description: string
  inputSchema: GeneratedInputSchema
  parameters: ParameterBinding[]
  stepIds: Id[]
}

export interface ListToolDraftsInput { /* no arguments */ }
export interface GetToolDraftInput { draftId: Id }
export interface SubmitToolDefinitionInput {
  draftId: Id
  draftRevision: Revision
  definition: DefinitionProposal
}

/** Compiled by Janus from the authorized immutable draft and validated proposal. */
export interface GeneratedDefinition {
  formatVersion: 1
  definitionId: Id
  definitionRevision: Revision
  principalId: Id
  sourceDraft: { id: Id; revision: Revision }
  applicability: Applicability
  name: string
  description: string
  inputSchema: GeneratedInputSchema
  parameters: ParameterBinding[]
  slots: ParameterSlot[]
  bindings: AuthoringBinding[]
  steps: RecipeStep[]
  evidenceIds: Id[]
  annotations: { readOnly: boolean; consequential: boolean }
  createdAt: number
  updatedAt: number
}

export interface DefinitionApproval {
  definitionId: Id
  definitionRevision: Revision
  state: 'pending' | 'enabled' | 'disabled'
  /** Set only by extension UI; changing a definition invalidates this record. */
  reviewedAt?: number
}

export type ExecutionState =
  | { state: 'idle' }
  | { state: 'running'; requestId: Id }
  | { state: 'unknown'; requestId: Id }

export interface PageDescriptor {
  pageId: PageId
  browserSessionId: Id
  tabId: number
  frameId: 0
  documentId: Id
  label: string
  title: string
  url: string
  origin: string
  nativeCapability: 'available' | 'unavailable' | 'untested'
  execution: ExecutionState
}

export type ToolSource =
  | { kind: 'native'; nativeName: string }
  | { kind: 'generated'; definitionId: Id; definitionRevision: Revision }

export interface ToolDescriptor {
  toolId: Id // stable logical identity in this enabled document
  toolRevision: Revision // changes without changing toolId or published name
  source: ToolSource
  name: string
  description: string
  inputSchema: JsonSchema // business input schema; no Janus control fields
  readOnlyHint: boolean
  consequentialHint: boolean
}

export interface LiveInstance {
  page: PageDescriptor
  descriptor: ToolDescriptor
  mcpName: string
  frozenSlug: string
  identityDigest: string // full SHA-256, used for collision checking
  connectionId: Id
  status: 'ready' | 'busy' | 'unavailable'
}

/** Concrete business schema is nested under `input` in each published MCP schema. */
export interface PageToolCall { revision: Revision; input: Record<string, Json> }

export type ErrorCode =
  | 'INVALID_INPUT' | 'UNAUTHORIZED' | 'STALE_DOCUMENT' | 'STALE_REVISION'
  | 'TOOL_UNAVAILABLE' | 'QUEUE_FULL' | 'PAGE_BUSY' | 'DEADLINE_EXCEEDED'
  | 'CANCELLED' | 'DISCONNECTED' | 'TARGET_MISSING' | 'TARGET_AMBIGUOUS'
  | 'RESPONSE_MISSING' | 'RESPONSE_AMBIGUOUS' | 'CAPTURE_LIMIT'
  | 'RESULT_LIMIT' | 'DRAFT_STALE' | 'DRAFT_EXPIRED' | 'INVALID_DEFINITION'
  | 'STORAGE_LIMIT' | 'NAME_COLLISION' | 'INTERNAL_ERROR'

export interface ToolError {
  code: ErrorCode
  message: string
  execution: 'not_started' | 'failed' | 'outcome_unknown'
}

export type ToolOutcome =
  | { status: 'completed'; result: Json }
  | { status: 'error'; error: ToolError }

interface Wire { protocolVersion: 1 }
interface Connected extends Wire { connectionId: Id }

export interface Hello extends Wire {
  type: 'hello'; role: 'executor'; pairingId: Id
  token: string // exactly 64 lowercase hexadecimal characters
  browserSessionId: Id
}

export interface HelloAck extends Connected {
  type: 'hello_ack'; role: 'executor'
  heartbeatIntervalMs: 15000
  inactivityTimeoutMs: 45000
  authoringPrincipals: Array<{ id: Id; label: string }>
}

export interface PagesSync extends Connected {
  type: 'pages_sync'; sequence: number; pages: PageDescriptor[]
}

export interface ToolsChanged extends Connected {
  type: 'tools_changed'; sequence: number
  pageId: PageId; documentId: Id; tools: ToolDescriptor[]
}

export interface ExecuteTool extends Connected {
  type: 'execute_tool'; requestId: Id
  pageId: PageId; documentId: Id; toolId: Id; toolRevision: Revision
  arguments: Record<string, Json> // business values only; revision already checked
  timeoutMs: number // remaining execution budget after server queue time
}

export interface ToolResult extends Connected {
  type: 'tool_result'; requestId: Id
  pageId: PageId; documentId: Id; toolId: Id; toolRevision: Revision
  outcome: ToolOutcome
  executionStopped: boolean
}

export interface CancelTool extends Connected {
  type: 'cancel_tool'; requestId: Id
  pageId: PageId; documentId: Id
  reason: 'caller_cancelled' | 'deadline' | 'revoked'
}

export interface PageRemoved extends Connected {
  type: 'page_removed'; sequence: number
  pageId: PageId; documentId: Id
  reason: 'navigation' | 'closed' | 'disabled'
}

export interface Heartbeat extends Connected {
  type: 'heartbeat'; kind: 'ping' | 'pong'; nonce: Id
}

/** M2 authoring transfer; the nine bridge messages above ship in M1. */
export interface DraftUpsert extends Connected {
  type: 'draft_upsert'; sequence: number; draft: ToolDraft
}

export interface DraftRemoved extends Connected {
  type: 'draft_removed'; sequence: number; draftId: Id; draftRevision: Revision
}

export interface DefinitionProposed extends Connected {
  type: 'definition_proposed'; requestId: Id
  draftId: Id; draftRevision: Revision; definition: GeneratedDefinition
}

export interface DefinitionResult extends Connected {
  type: 'definition_result'; requestId: Id
  outcome:
    | { status: 'saved'; definitionId: Id; definitionRevision: Revision; state: 'pending' }
    | { status: 'error'; error: ToolError }
}

export type ExtensionToDaemon =
  | Hello | PagesSync | ToolsChanged | ToolResult | PageRemoved | Heartbeat
  | DraftUpsert | DraftRemoved | DefinitionResult

export type DaemonToExtension =
  | HelloAck | ExecuteTool | CancelTool | Heartbeat | DefinitionProposed

export type ControlMessage = ExtensionToDaemon | DaemonToExtension

/** Message kinds accepted in M1; the authoring kinds are enabled in M2 (§17). */
export const M1_MESSAGE_TYPES = [
  'hello', 'hello_ack', 'pages_sync', 'tools_changed',
  'execute_tool', 'tool_result', 'cancel_tool', 'page_removed', 'heartbeat',
] as const satisfies ReadonlyArray<ControlMessage['type']>

export const M2_MESSAGE_TYPES = [
  'draft_upsert', 'draft_removed', 'definition_proposed', 'definition_result',
] as const satisfies ReadonlyArray<ControlMessage['type']>
