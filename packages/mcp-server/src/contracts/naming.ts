/**
 * §8 published MCP tool names.
 *
 * The published name is stable across revision changes: the expected revision
 * travels as a required call argument instead, so a stale retry fails with
 * STALE_REVISION rather than "unknown tool".
 *
 * The slug is frozen at a logical tool's first publication. Titles and page
 * labels change freely afterwards without changing identity.
 */

import { createHash } from 'node:crypto'
import type { Id, PageId } from './types.js'

export const NAMESPACE_LENGTH = 12
export const SLUG_MAX_LENGTH = 20
export const SUFFIX_LENGTH = 20
export const MCP_NAME_MAX_LENGTH = 61

const COMBINING_MARKS = /[̀-ͯ]/g
const NON_SLUG_RUN = /[^a-z0-9]+/g
const EDGE_UNDERSCORES = /^_+|_+$/g
const TRAILING_UNDERSCORES = /_+$/

export type SourceKind = 'native' | 'generated'

export interface ToolIdentity {
  browserSessionId: Id
  pageId: PageId
  sourceKind: SourceKind
  toolId: Id
}

/**
 * Normalize a human tool title into a frozen slug.
 *
 * NFKD, drop combining marks, lowercase ASCII, collapse every run outside
 * [a-z0-9] to `_`, trim, truncate to 20, then trim again — truncation can
 * expose a new trailing underscore. Empty results become `tool`.
 */
export function toSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(NON_SLUG_RUN, '_')
    .replace(EDGE_UNDERSCORES, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(TRAILING_UNDERSCORES, '')
  return slug || 'tool'
}

/**
 * Full SHA-256 over the identity tuple. Retained alongside each live instance
 * so a name collision can be distinguished from a republication of the same
 * logical identity. Revision, labels and descriptions are deliberately absent.
 */
export function identityDigest(identity: ToolIdentity): string {
  const tuple = [
    'janus.webtool.v1',
    identity.browserSessionId,
    identity.pageId,
    identity.sourceKind,
    identity.toolId,
  ]
  return createHash('sha256').update(Buffer.from(JSON.stringify(tuple), 'utf8')).digest('hex')
}

export function namespaceFor(pageId: PageId): string {
  return pageId.slice(0, NAMESPACE_LENGTH)
}

/**
 * Build the published name. Call once, at a logical tool's first publication,
 * and store the result — later revisions reuse the stored name rather than
 * recomputing it, so a retitled tool keeps its identity.
 */
export function publishedToolName(identity: ToolIdentity, title: string): string {
  return buildToolName(namespaceFor(identity.pageId), toSlug(title), identityDigest(identity))
}

/** Assemble a name from already-computed parts (frozen slug, stored digest). */
export function buildToolName(namespace: string, frozenSlug: string, digest: string): string {
  return `web__${namespace}__${frozenSlug}__${digest.slice(0, SUFFIX_LENGTH)}`
}
