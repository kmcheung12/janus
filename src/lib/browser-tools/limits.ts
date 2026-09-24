/**
 * §18 limits, re-exported from the canonical definition so both sides of the
 * bridge enforce identical numbers. Limits are checked at both receiving
 * boundaries, which only works if they cannot drift.
 */

export {
  LIMITS,
  reconnectDelayMs,
  jsonBytes,
  jsonDepth,
} from '@@/packages/mcp-server/src/contracts/limits'
