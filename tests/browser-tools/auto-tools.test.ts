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
