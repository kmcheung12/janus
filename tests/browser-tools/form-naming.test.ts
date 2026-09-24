import { describe, expect, it } from 'vitest'
import { autoFormDefinitions } from '../../src/lib/browser-tools/auto-tools'

/**
 * Naming has to work on markup nobody designed for us. These are the shapes
 * real sites use to label a form, collected from actual pages rather than
 * invented.
 */
function nameOf(html: string): string | undefined {
  document.body.innerHTML = html
  return autoFormDefinitions('0'.repeat(32), 'doc_1')[0]?.name
}

describe('label sources', () => {
  it.each([
    ['aria-label', '<form aria-label="Search"><input name="x" type="text"></form>'],
    ['role=search', '<form role="search"><input name="x" type="text"></form>'],
    ['input type=search', '<form><input name="x" type="search"></form>'],
    ['submit button text', '<form><input name="x" type="text"><button type="submit">Search</button></form>'],
    ['submit input value', '<form><input name="x" type="text"><input type="submit" value="Search"></form>'],
    ['legend', '<form><fieldset><legend>Search</legend><input name="x" type="text"></fieldset></form>'],
    ['action path', '<form action="/search"><input name="x" type="text"></form>'],
    ['bare text node (Hacker News)', '<form>Search: <input name="x" type="text"></form>'],
    ['wrapped label element', '<form><label>Search <input name="x" type="text"></label></form>'],
    ['nested text', '<form><div class="row">Search: <input name="x" type="text"></div></form>'],
    ['heading inside form', '<form><h2>Search</h2><input name="x" type="text"></form>'],
    ['placeholder only', '<form><input name="x" type="text" placeholder="Search"></form>'],
  ])('finds a name from %s', (_label, html) => {
    expect(nameOf(html)).toBe('search')
  })
})

describe('robustness', () => {
  it('is not confused by a form wrapping a whole page section', () => {
    // A form that contains paragraphs of body copy must not be named after them.
    const name = nameOf(`
      <form aria-label="Newsletter">
        <p>${'Lorem ipsum dolor sit amet. '.repeat(40)}</p>
        <input name="email" type="text">
      </form>
    `)
    expect(name).toBe('submit_newsletter')
    expect(name!.length).toBeLessThan(40)
  })

  it('ignores punctuation-only and icon-only labels', () => {
    expect(nameOf('<form><input name="postcode" type="text"><button type="submit">→</button></form>'))
      .toBe('submit_postcode')
  })

  it('never produces an invalid identifier', () => {
    const shapes = [
      '<form>  :  <input name="a" type="text"></form>',
      '<form aria-label="!!! ???"><input name="a" type="text"></form>',
      '<form aria-label="商品検索"><input name="a" type="text"></form>',
      '<form><input name="2" type="text"></form>',
      '<form><input name="très-cher" type="text"></form>',
    ]
    for (const html of shapes) {
      const name = nameOf(html)
      expect(name, html).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('prefers the more specific source when several are present', () => {
    // An explicit aria-label beats a generic "Go" button.
    expect(nameOf(`
      <form aria-label="Track a parcel">
        <input name="ref" type="text"><button type="submit">Go</button>
      </form>
    `)).toBe('submit_track_a_parcel')
  })

  it('handles a form whose only text is its own long body', () => {
    const name = nameOf(`<form><p>${'x'.repeat(500)}</p><input name="a" type="text"></form>`)
    expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    expect(name!.length).toBeLessThan(40)
  })
})
