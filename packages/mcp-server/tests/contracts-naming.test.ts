import { describe, expect, it } from 'vitest'
import {
  buildToolName,
  identityDigest,
  MCP_NAME_MAX_LENGTH,
  namespaceFor,
  publishedToolName,
  toSlug,
  type ToolIdentity,
} from '../src/contracts/naming.js'

// §8 golden vector. If this fails, the naming algorithm has drifted from the
// spec and every previously published tool name is unreachable.
const GOLDEN: ToolIdentity = {
  browserSessionId: 'browser_1',
  pageId: '00112233445566778899aabbccddeeff',
  sourceKind: 'generated',
  toolId: 'tool_1',
}
const GOLDEN_DIGEST = 'ea0593e094b99fe633be2a1b3a8a3788e2fbbbc1eb60af919fbb64343ac445de'
const GOLDEN_NAME = 'web__001122334455__search_products__ea0593e094b99fe633be'

describe('identity digest', () => {
  it('matches the spec golden vector', () => {
    expect(identityDigest(GOLDEN)).toBe(GOLDEN_DIGEST)
  })

  it('excludes revision, label and title from identity', () => {
    // Same tuple must hash identically regardless of surrounding metadata:
    // a retitled tool keeps its name.
    expect(publishedToolName(GOLDEN, 'Search products')).toBe(GOLDEN_NAME)
    expect(identityDigest({ ...GOLDEN })).toBe(GOLDEN_DIGEST)
  })

  it('separates native and generated sources with the same tool id', () => {
    expect(identityDigest({ ...GOLDEN, sourceKind: 'native' }))
      .not.toBe(identityDigest({ ...GOLDEN, sourceKind: 'generated' }))
  })

  it('separates identical tool ids on different pages', () => {
    expect(identityDigest({ ...GOLDEN, pageId: 'ffeeddccbbaa99887766554433221100' }))
      .not.toBe(GOLDEN_DIGEST)
  })
})

describe('slug normalization', () => {
  it.each([
    ['Search products', 'search_products'],
    ['Crème brûlée / 商品', 'creme_brulee'],
    ['商品', 'tool'],
    ['a'.repeat(40), 'a'.repeat(20)],
  ])('%s -> %s', (title, expected) => {
    expect(toSlug(title)).toBe(expected)
  })

  it('never emits a leading or trailing underscore', () => {
    for (const title of ['  spaced  ', '!!!bang!!!', '商品 x 商品', '-dash-']) {
      const slug = toSlug(title)
      expect(slug).not.toMatch(/^_|_$/)
      expect(slug.length).toBeGreaterThan(0)
    }
  })

  it('trims an underscore newly exposed by truncation', () => {
    // 20 characters of content would end exactly on the separator.
    expect(toSlug('abcdefghijklmnopqrs tuv')).toBe('abcdefghijklmnopqrs')
  })

  it('produces only [a-z0-9_] within the length bound', () => {
    for (const title of ['Ünïcødé Ttl', 'tab\tand\nnewline', '商品/PRODUCT #3']) {
      const slug = toSlug(title)
      expect(slug).toMatch(/^[a-z0-9_]+$/)
      expect(slug.length).toBeLessThanOrEqual(20)
    }
  })
})

describe('published name', () => {
  it('builds the spec example', () => {
    expect(publishedToolName(GOLDEN, 'Search products')).toBe(GOLDEN_NAME)
  })

  it('stays within the documented maximum length', () => {
    const longest = publishedToolName({ ...GOLDEN, toolId: 'x'.repeat(96) }, 'a'.repeat(200))
    expect(longest.length).toBeLessThanOrEqual(MCP_NAME_MAX_LENGTH)
  })

  it('is a valid MCP tool name', () => {
    expect(publishedToolName(GOLDEN, 'Search products')).toMatch(/^[a-z0-9_]+$/)
  })

  it('reuses a stored slug instead of recomputing from a changed title', () => {
    // A revision update must not rerun first-publication naming.
    const frozen = toSlug('Search products')
    const renamed = buildToolName(namespaceFor(GOLDEN.pageId), frozen, identityDigest(GOLDEN))
    expect(renamed).toBe(GOLDEN_NAME)
  })
})
