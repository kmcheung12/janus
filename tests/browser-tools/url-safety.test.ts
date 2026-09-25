import { describe, expect, it } from 'vitest'
import { hasCredentialParams, sanitizeUrl } from '../../src/lib/browser-tools/url-safety'

describe('sanitizeUrl', () => {
  it('redacts the tokens Hacker News puts in its links', () => {
    // Observed verbatim on a logged-in HN page via read_page.
    const logout = 'https://news.ycombinator.com/logout?auth=6d5957a190ee89ec3bd1d423f4e2c13fc2040335&goto=item%3Fid%3D49836880'
    expect(sanitizeUrl(logout)).not.toContain('6d5957a190ee89ec3bd1d423f4e2c13fc2040335')
    expect(sanitizeUrl(logout)).toContain('auth=REDACTED')

    const fave = 'https://news.ycombinator.com/fave?id=49836880&auth=f4bc5cfddefdf3080a25fc24a9d5845c52afe190'
    expect(sanitizeUrl(fave)).not.toContain('f4bc5cfddefdf3080a25fc24a9d5845c52afe190')
  })

  it('keeps addressing parameters, which is the case the feature exists for', () => {
    // Losing this would break ordinary navigation to a thread or a page.
    expect(sanitizeUrl('https://news.ycombinator.com/item?id=49836880'))
      .toBe('https://news.ycombinator.com/item?id=49836880')
    expect(sanitizeUrl('https://example.com/search?q=oat+milk&page=2'))
      .toBe('https://example.com/search?q=oat+milk&page=2')
  })

  it('matches whole parameter names, so id and sid stay distinct', () => {
    expect(sanitizeUrl('https://example.com/?id=1')).toContain('id=1')
    expect(sanitizeUrl('https://example.com/?sid=1')).toContain('sid=REDACTED')
    // A name that merely contains "key" is addressing, not a credential.
    expect(sanitizeUrl('https://example.com/?monkey=1')).toContain('monkey=1')
  })

  it('leaves a URL untouched when nothing matched', () => {
    // Avoids gratuitously rewriting hrefs the page already had right.
    const href = 'https://example.com/a/b?x=1#frag'
    expect(sanitizeUrl(href)).toBe(href)
  })

  it('does not leak a token out of input that barely parses', () => {
    // Resolution against the document base means almost anything parses, so
    // the guarantee that matters is not "rejects junk" but "never returns the
    // secret" — including for hrefs no sane page would emit.
    expect(sanitizeUrl('::not a url::?auth=secret')).not.toContain('secret')
    expect(sanitizeUrl('//host/path?token=secret')).not.toContain('secret')
    expect(sanitizeUrl('?auth=secret')).not.toContain('secret')
  })
})

describe('hasCredentialParams', () => {
  it('is true for the URLs sanitizeUrl would redact', () => {
    expect(hasCredentialParams('https://news.ycombinator.com/logout?auth=abc')).toBe(true)
    expect(hasCredentialParams('https://example.com/?access_token=abc')).toBe(true)
  })

  it('is false for ordinary addressing', () => {
    expect(hasCredentialParams('https://news.ycombinator.com/item?id=49836880')).toBe(false)
    expect(hasCredentialParams('https://news.ycombinator.com/news')).toBe(false)
  })

  it('does not report a redacted URL as still carrying a credential', () => {
    // navigate() rejects on this, so a false positive on already-safe output
    // would block exactly the links read_page is meant to make usable.
    const redacted = sanitizeUrl('https://example.com/?id=1&auth=secret')
    expect(redacted).toContain('id=1')
    expect(hasCredentialParams(redacted)).toBe(true)
  })
})
