/**
 * The published tool list stays bounded regardless of the page.
 *
 * A tool list is a context-window cost paid on every single turn, by every
 * connected agent, whether or not it uses any of them. A page with three
 * hundred buttons must not produce three hundred tools — the failure is not a
 * crash, it is an agent whose context is full before it has read anything.
 *
 * Asserted here rather than left as a convention, because the obvious way to
 * add a click tool is one tool per control, and that is exactly the mistake
 * this forbids. The shape that stays bounded is a single tool whose argument
 * is an enum of targets.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import * as pageTools from '../../src/lib/browser-tools/page-controller'
import { snapshot } from '../../src/lib/browser-tools/a11y-snapshot'
import { invokeReadTool } from '../../src/lib/browser-tools/auto-tools'

function manyButtons(count: number): string {
  return Array.from({ length: count }, (_, i) => `<button>Action ${i}</button>`).join('')
}

function manyForms(count: number): string {
  return Array.from({ length: count }, (_, i) =>
    `<form><label for="q${i}">Query ${i}</label><input id="q${i}" name="q${i}">`
    + `<button type="submit">Search ${i}</button></form>`).join('')
}

describe('published tool count', () => {
  beforeEach(() => {
    pageTools.resetDocument()
    document.body.innerHTML = ''
  })

  it('does not grow with the number of buttons on the page', async () => {
    document.body.innerHTML = manyButtons(300)
    pageTools.setAutoOptions({ pageId: 'p', allowWrites: true })

    const tools = await pageTools.publish()

    // read_page, find_text, list_forms. Buttons are reported *inside*
    // read_page's result, not published as tools of their own.
    expect(tools.length).toBeLessThanOrEqual(5)
    expect(tools.map((t) => t.name)).toContain('read_page')
  })

  it('bounds the tools derived from a page with many forms', async () => {
    document.body.innerHTML = manyForms(50)
    pageTools.setAutoOptions({ pageId: 'p', allowWrites: true })

    const tools = await pageTools.publish()

    // One per form would be fifty. Whatever the cap is, it is a cap.
    expect(tools.length).toBeLessThan(25)
  })

  it('bounds the controls read_page reports', async () => {
    document.body.innerHTML = manyButtons(300)

    const outcome = invokeReadTool('a_read_page', {})
    expect(outcome.status).toBe('completed')

    const result = outcome.status === 'completed'
      ? outcome.result as unknown as { controls: unknown[] }
      : { controls: [] }

    // Bounded, and small enough that a page of buttons cannot crowd out the
    // prose an agent also needs from the same result.
    expect(result.controls.length).toBeLessThanOrEqual(80)
  })

  it('bounds the snapshot itself', () => {
    document.body.innerHTML = manyButtons(500)
    expect(snapshot().length).toBeLessThanOrEqual(200)
  })
})

describe('reaching control 300 of 300', () => {
  beforeEach(() => {
    pageTools.resetDocument()
    document.body.innerHTML = ''
  })

  it('resolves a named button on a page of three hundred', () => {
    document.body.innerHTML = Array.from(
      { length: 300 }, (_, i) => `<button>Action ${i}</button>`,
    ).join('')

    // The point of the whole design: one call, a human-readable name, and the
    // three hundredth button is as reachable as the first.
    const outcome = invokeReadTool('a_click', { target: 'Action 299' })
    expect(outcome.status, JSON.stringify(outcome)).toBe('completed')
  })

  it('finds controls that read_page could never have listed', () => {
    document.body.innerHTML = Array.from(
      { length: 300 }, (_, i) => `<button>Action ${i}</button>`,
    ).join('')

    const outcome = invokeReadTool('a_find_control', { query: 'Action 250' })
    expect(outcome.status).toBe('completed')
    const result = outcome.status === 'completed'
      ? outcome.result as unknown as { matches: Array<{ target: string }> }
      : { matches: [] }
    expect(result.matches.map((m) => m.target)).toContain('Action 250')
  })

  it('refuses rather than guessing when a name is ambiguous', () => {
    // Three identical bare buttons with no distinguishing context. Acting on
    // the first would act on something the caller never saw.
    document.body.innerHTML = '<button>Go</button><button>Go</button><button>Go</button>'

    const outcome = invokeReadTool('a_click', { target: 'Go' })
    expect(outcome.status).toBe('error')
    if (outcome.status === 'error') expect(outcome.error.code).toBe('TARGET_AMBIGUOUS')
  })

  it('still publishes a flat tool list with click enabled', async () => {
    document.body.innerHTML = manyButtons(300)
    pageTools.setAutoOptions({ pageId: 'p', allowWrites: true })

    const tools = await pageTools.publish()
    // read_page, find_text, list_forms, find_control, click.
    expect(tools.length).toBeLessThanOrEqual(6)
    expect(tools.map((t) => t.name)).toContain('click')
  })
})
