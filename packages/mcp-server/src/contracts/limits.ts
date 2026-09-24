/**
 * §18 fixed v1 defaults and limits.
 *
 * These are implementation decisions, not tunables: no tool caller can raise
 * them, and changing one requires updated contracts and tests. Limits are
 * enforced at both receiving boundaries where applicable.
 *
 * Byte counts are UTF-8 encoded JSON bytes unless stated otherwise. Use
 * monotonic clocks for deadlines and wall-clock timestamps for persistence.
 */

export const LIMITS = {
  /** Enabled pages per executor/browser session; replacing requires an explicit action. */
  enabledPagesPerSession: 1,
  /** Concurrent executions per browser document, across every MCP session. */
  activeExecutionsPerDocument: 1,

  waitingCallsPerPage: 4,
  waitingCallsGlobal: 32,

  /** From server receipt, including queue and UI confirmation time. */
  invocationDeadlineMs: 30_000,
  stepWaitDefaultMs: 5_000,
  stepWaitMinMs: 100,
  stepWaitMaxMs: 10_000,

  pairingHandshakeMs: 5_000,
  pairingHandshakeMaxBytes: 4 * 1024,

  heartbeatIntervalMs: 15_000,
  inactivityTimeoutMs: 45_000,
  /** Backoff schedule in seconds; the final value repeats. Jitter is added on top. */
  reconnectBackoffSeconds: [1, 2, 4, 8, 16, 30],
  reconnectJitterRatio: 0.2,

  /** Local invalidation is immediate; only the notification coalesces. */
  toolListNotifyCoalesceMs: 100,

  controlFrameMaxBytes: 1024 * 1024,

  toolInputMaxBytes: 32 * 1024,
  toolInputMaxDepth: 16,
  nativeBusinessSchemaMaxBytes: 16 * 1024,
  toolResultMaxBytes: 64 * 1024,
  toolResultMaxDepth: 16,

  /** Overflow marks the catalog unsupported rather than publishing a subset. */
  nativeToolsPerPage: 32,

  recipeMaxSteps: 32,
  recipeMaxBindings: 64,
  recipeMaxParameters: 16,
  recipeMaxOutputFields: 16,

  stringValueMaxLength: 4_096,
  enumMaxEntries: 100,
  collectionMaxMembers: 1_024,

  responseObserversPerInvocation: 4,
  responseBodyMaxBytes: 256 * 1024,
  responseTotalMaxBytesPerInvocation: 1024 * 1024,

  draftMaxBytes: 256 * 1024,
  definitionMaxBytes: 256 * 1024,
  evidenceMaxItems: 16,
  evidenceSampleMaxBytes: 8 * 1024,
  evidenceTotalMaxBytes: 64 * 1024,

  demonstrationMaxMs: 15 * 60_000,
  demonstrationMaxEvents: 2_000,
  demonstrationMaxBytes: 5 * 1024 * 1024,

  draftRetentionMs: 24 * 60 * 60_000,
  invocationMetadataRetentionMs: 7 * 24 * 60 * 60_000,
  invocationMetadataMaxRecords: 10_000,
  savedDefinitionsMax: 100,
  authoringStorageMaxBytes: 25 * 1024 * 1024,
  pendingDefinitionsAndDraftsMax: 50,
  cleanupIntervalMs: 15 * 60_000,

  pageLabelMinLength: 1,
  pageLabelMaxLength: 48,

  authoringStoreDeadlineMs: 10_000,
  /** Idempotency window for a definition store retry. */
  definitionStoreIdempotencyMs: 10 * 60_000,

  authoringPrincipalsMax: 8,
  /** Complete tool snapshot size per page/document. */
  toolSnapshotMax: 32,
} as const

/** Reconnect delay for an attempt index, with the §18 jitter applied. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const schedule = LIMITS.reconnectBackoffSeconds
  const base = schedule[Math.min(attempt, schedule.length - 1)] * 1000
  return Math.round(base * (1 + random() * LIMITS.reconnectJitterRatio))
}

/** Depth of a JSON value, used to enforce the input/result nesting bounds. */
export function jsonDepth(value: unknown, depth = 1): number {
  if (value === null || typeof value !== 'object') return depth
  const values = Array.isArray(value) ? value : Object.values(value as object)
  let max = depth
  for (const v of values) {
    const d = jsonDepth(v, depth + 1)
    if (d > max) max = d
  }
  return max
}

/**
 * UTF-8 byte length of a value's JSON encoding. Uses TextEncoder rather than
 * Buffer so the extension can enforce the same limit as the daemon.
 */
const encoder = new TextEncoder()

export function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value) ?? '').byteLength
}
