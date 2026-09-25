import { beforeEach, describe, expect, it } from 'vitest'
import {
  autoFormDefinitions, formToolDescriptor, invokeReadTool, isAutoToolId, readToolDescriptors,
} from '../../src/lib/browser-tools/auto-tools'

function markup(html: string) {
  document.body.innerHTML = html
}

function read(tool: string, input: Record<string, unknown> = {}) {
  const outcome = invokeReadTool(`a_${tool}`, input as never)
  if (outcome.status !== 'completed') throw new Error(JSON.stringify(outcome))
  return outcome.result as Record<string, never>
}

beforeEach(() => markup(''))

describe('read tools', () => {
  it('publishes as read-only and non-consequential', () => {
    for (const tool of readToolDescriptors()) {
      expect(tool.readOnlyHint).toBe(true)
      expect(tool.consequentialHint).toBe(false)
      expect(tool.toolId).toMatch(/^[A-Za-z0-9_-]{1,96}$/)
    }
  })

  it('takes no caller-supplied selector anywhere', () => {
    // §11: the client supplies declared business values, never selectors.
    for (const tool of readToolDescriptors()) {
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      )
      expect(properties).not.toContain('selector')
      expect(properties).not.toContain('xpath')
      expect(properties).not.toContain('js')
    }
  })

  it('reads headings, links and text', () => {
    markup(`
      <main><h1>Top stories</h1><h2>Second</h2>
      <a href="https://example.com/a">Story A</a>
      <p>Some body text.</p></main>
    `)
    const result = read('read_page')
    expect(result.title).toBeDefined()
    expect((result.headings as Array<{ text: string }>).map((h) => h.text)).toEqual(['Top stories', 'Second'])
    expect((result.links as Array<{ text: string }>)[0].text).toBe('Story A')
    expect(String(result.text)).toContain('Some body text')
  })

  it('bounds a huge page and says so', () => {
    markup(`<main><p>${'x'.repeat(20_000)}</p></main>`)
    const result = read('read_page')
    // Never silently truncate: the caller must be able to tell.
    expect(String(result.text).length).toBeLessThanOrEqual(8_000)
    expect(result.truncated).toBe(true)
  })

  it('says which list was cut, not just that the prose was', () => {
    // 150 links, capped at 100. This reported `truncated: false`, because only
    // the body text was ever checked — so an agent reading 100 of 150 links
    // had no way to know the one it wanted was among the 50 it never saw.
    markup(`<main>${
      Array.from({ length: 150 }, (_, i) => `<a href="https://example.com/${i}">Link ${i}</a>`).join('')
    }</main>`)
    const result = read('read_page')

    expect((result.links as unknown[]).length).toBe(100)
    expect(result.truncated).toBe(true)
    expect(result.incomplete).toMatchObject({ links: { shown: 100, total: 150 } })
    expect(String(result.note)).toContain('find_text')
  })

  it('claims nothing is missing when nothing is', () => {
    markup('<main><h1>Small</h1><a href="https://example.com/a">One</a><p>Short.</p></main>')
    const result = read('read_page')
    expect(result.truncated).toBe(false)
    expect(result.incomplete).toBeUndefined()
  })

  it('finds text and its nearest link', () => {
    markup('<main><a href="https://example.com/x"><span>Rust is fast</span></a></main>')
    const result = read('find_text', { query: 'rust' })
    const matches = result.matches as Array<{ text: string; href: string | null }>
    expect(matches).toHaveLength(1)
    expect(matches[0].href).toContain('example.com/x')
  })

  it('returns nothing for an empty query rather than everything', () => {
    markup('<main><p>anything</p></main>')
    expect((read('find_text', { query: '' }).matches as unknown[])).toHaveLength(0)
  })

  it('lists forms and their fields, skipping hidden inputs', () => {
    markup(`
      <form name="search"><input name="q" type="text"><input name="csrf" type="hidden"></form>
    `)
    const forms = read('list_forms').forms as Array<{ label: string; fields: Array<{ name: string }> }>
    expect(forms).toHaveLength(1)
    expect(forms[0].fields.map((f) => f.name)).toEqual(['q'])
  })

  it('reports an unknown tool rather than throwing', () => {
    const outcome = invokeReadTool('a_nope', {})
    expect(outcome).toMatchObject({ status: 'error', error: { code: 'TOOL_UNAVAILABLE' } })
  })
})

describe('form tools', () => {
  it('derives one definition per form, marked consequential', () => {
    markup(`
      <form name="search"><input name="q" type="text"><button type="submit">Go</button></form>
      <div id="results">x</div>
    `)
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    expect(definition).toBeDefined()
    // It submits, so it is never read-only.
    expect(definition.annotations).toEqual({ readOnly: false, consequential: true })
    expect(formToolDescriptor(definition).consequentialHint).toBe(true)
  })

  it('ends in an extraction so the agent gets a result back', () => {
    markup('<form name="search"><input name="q" type="text"></form><div id="results">x</div>')
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    expect(definition.steps.at(-1)?.op).toBe('extract_result')
  })

  it('skips a form whose only inputs are sensitive', () => {
    // A login form has nothing safe to parameterize.
    markup('<form name="login"><input name="password" type="password"></form>')
    expect(autoFormDefinitions('0'.repeat(32), 'doc_1')).toHaveLength(0)
  })

  it('never exposes a password as a parameter', () => {
    markup(`
      <form name="login">
        <input name="user" type="text">
        <input name="password" type="password">
      </form>
    `)
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    if (!definition) return
    const properties = Object.keys(definition.inputSchema.properties)
    expect(properties.some((p) => /pass/i.test(p))).toBe(false)
    expect(definition.slots.filter((s) => s.sensitive).length).toBeGreaterThan(0)
  })

  it('produces a closed input schema with every property required', () => {
    markup('<form name="search"><input name="q" type="text"></form>')
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    expect(definition.inputSchema.additionalProperties).toBe(false)
    expect(definition.inputSchema.required.sort())
      .toEqual(Object.keys(definition.inputSchema.properties).sort())
  })

  it('scopes applicability to this origin and path', () => {
    markup('<form name="search"><input name="q" type="text"></form>')
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    expect(definition.applicability.origin).toBe(window.location.origin)
  })
})

describe('tool id routing', () => {
  it.each(['a_read_page', 'af_auto_abc_0'])('recognizes %s as automatic', (id) => {
    expect(isAutoToolId(id)).toBe(true)
  })

  it.each(['n_c2VhcmNo', 'g_def_1'])('leaves %s alone', (id) => {
    expect(isAutoToolId(id)).toBe(false)
  })
})

describe('semantic naming', () => {
  const nameOf = (html: string) => {
    markup(html)
    return autoFormDefinitions('0'.repeat(32), 'doc_1').map((d) => d.name)
  }

  it('names a search form "search" rather than by position', () => {
    // Observed on Wikipedia, which produced submit_form_1 and submit_form_5.
    expect(nameOf(`
      <form role="search"><input name="search" type="search"><button type="submit">Search</button></form>
    `)).toEqual(['search'])
  })

  it('uses the submit button text', () => {
    expect(nameOf(`
      <form><input name="email" type="text"><button type="submit">Subscribe</button></form>
    `)).toEqual(['subscribe'])
  })

  it('prefers an explicit aria-label, and skips the submit_ prefix when the label already reads as a verb', () => {
    expect(nameOf(`
      <form aria-label="Filter results"><input name="q" type="text"><button type="submit">Go</button></form>
    `)).toEqual(['filter_results'])
  })

  it('prefixes submit_ when the label is a noun', () => {
    expect(nameOf(`
      <form aria-label="Delivery address"><input name="line1" type="text"></form>
    `)).toEqual(['submit_delivery_address'])
  })

  it('falls back to a single field\'s label', () => {
    expect(nameOf('<form><input name="postcode" type="text"></form>')).toEqual(['submit_postcode'])
  })

  it('never emits a bare number as a name', () => {
    for (const name of nameOf('<form><input name="2" type="text"></form>')) {
      expect(name).not.toMatch(/^\d+$/)
      expect(name).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('publishes one tool for a form duplicated across breakpoints', () => {
    // Sites commonly render desktop and mobile copies of the same search form.
    const names = nameOf(`
      <form role="search" action="/s"><input name="q" type="search"></form>
      <form role="search" action="/s"><input name="q" type="search"></form>
    `)
    expect(names).toEqual(['search'])
  })

  it('disambiguates genuinely different forms sharing a name', () => {
    const names = nameOf(`
      <form action="/a"><input name="q" type="text"><button type="submit">Go</button></form>
      <form action="/b"><input name="term" type="text"><button type="submit">Go</button></form>
    `)
    expect(new Set(names).size).toBe(names.length)
  })

  it('skips a form containing a credential field entirely', () => {
    // Submitting a login form without its password only fails, so publishing
    // a partial version would mislead rather than help.
    expect(nameOf(`
      <form><input name="user" type="text"><input name="pass" type="password"></form>
    `)).toEqual([])
  })

  it('describes what the tool does and where', () => {
    markup('<form role="search"><input name="search" type="search"></form>')
    const [definition] = autoFormDefinitions('0'.repeat(32), 'doc_1')
    expect(definition.description).toContain(window.location.hostname)
    expect(definition.description).toContain('search')
    expect(definition.description).toMatch(/derived automatically/i)
  })
})
