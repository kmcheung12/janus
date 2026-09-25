import { beforeEach, describe, expect, it } from 'vitest'
import { handleFor, isActionable, roleOf, snapshot } from '../../src/lib/browser-tools/a11y-snapshot'

describe('roleOf', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('uses the explicit role first', () => {
    document.body.innerHTML = '<div id="t" role="button">Go</div>'
    expect(roleOf(document.getElementById('t')!)).toBe('button')
  })

  it('maps inputs by type, not by tag', () => {
    document.body.innerHTML = `
      <input id="a" type="checkbox"><input id="b" type="search"><input id="c" type="submit">`
    expect(roleOf(document.getElementById('a')!)).toBe('checkbox')
    expect(roleOf(document.getElementById('b')!)).toBe('searchbox')
    expect(roleOf(document.getElementById('c')!)).toBe('button')
  })

  it('does not treat a styled card as a control', () => {
    // cursor: pointer alone is not enough — otherwise whole layouts become
    // clickable and the tool list fills with things that do nothing.
    document.body.innerHTML = '<div id="t" style="cursor: pointer">A card</div>'
    expect(roleOf(document.getElementById('t')!)).toBe('generic')
  })

  it('treats a focusable pointer-cursor element as a button', () => {
    // The div-that-is-a-button. Event listeners are unreadable from an
    // isolated world, so this is the signal left.
    document.body.innerHTML = '<div id="t" tabindex="0" style="cursor: pointer">Go</div>'
    expect(roleOf(document.getElementById('t')!)).toBe('button')
  })

  it('does not call an anchor without href a link', () => {
    document.body.innerHTML = '<a id="t">not a link</a>'
    expect(roleOf(document.getElementById('t')!)).toBe('generic')
  })
})

describe('snapshot', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('names controls the way a screen reader would', () => {
    document.body.innerHTML = `
      <button aria-label="Close dialog">×</button>
      <input type="checkbox" id="tos"><label for="tos">Accept terms</label>`

    const nodes = snapshot()
    expect(nodes.find((n) => n.name === 'Close dialog')?.role).toBe('button')
    expect(nodes.find((n) => n.name === 'Accept terms')?.role).toBe('checkbox')
  })

  it('skips what a screen reader skips', () => {
    document.body.innerHTML = `
      <button style="display: none">Hidden</button>
      <div aria-hidden="true"><button>Concealed</button></div>
      <button></button>
      <button>Real</button>`

    const names = snapshot().map((n) => n.name)
    expect(names).toContain('Real')
    expect(names).not.toContain('Hidden')
    expect(names).not.toContain('Concealed')
    // An unnamed control cannot be announced, and cannot be addressed either.
    expect(names.filter((n) => !n).length).toBe(0)
  })

  it('reports the state that decides whether an action is possible', () => {
    document.body.innerHTML = `
      <button id="a" disabled>Submit</button>
      <button id="b" aria-expanded="true">Menu</button>
      <input type="checkbox" id="c" checked><label for="c">Subscribe</label>`

    const nodes = snapshot()
    const submit = nodes.find((n) => n.name === 'Submit')!
    expect(submit.state?.disabled).toBe(true)
    // A disabled control is present but not actionable; clicking it would
    // wait out a budget on something that can never respond.
    expect(isActionable(submit)).toBe(false)

    expect(nodes.find((n) => n.name === 'Menu')!.state?.expanded).toBe(true)
    expect(nodes.find((n) => n.name === 'Subscribe')!.state?.checked).toBe(true)
  })

  it('disambiguates repeated names by their context', () => {
    // The case that makes a bare accessible name useless as a tool argument:
    // a screen reader announces "Delete, Invoice 441", not just "Delete".
    document.body.innerHTML = `
      <ul>
        <li>Invoice 441 <button>Delete</button></li>
        <li>Invoice 892 <button>Delete</button></li>
      </ul>`

    const handles = snapshot().filter((n) => n.name === 'Delete').map(handleFor)
    expect(handles).toHaveLength(2)
    expect(new Set(handles).size, `not unique: ${handles.join(' | ')}`).toBe(2)
    expect(handles.some((h) => h.includes('441'))).toBe(true)
  })

  it('leaves out the panel Janus injects', () => {
    document.body.innerHTML = `
      <div id="janus-agent-tools-root"><button>Agent tools</button></div>
      <button>Real</button>`

    const names = snapshot({ ignoreSelector: '#janus-agent-tools-root' }).map((n) => n.name)
    expect(names).toContain('Real')
    expect(names).not.toContain('Agent tools')
  })
})
