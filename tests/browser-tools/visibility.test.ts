import { beforeEach, describe, expect, it } from 'vitest'
import { isVisible } from '../../src/lib/browser-tools/visibility'

describe('isVisible', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('reports a fixed-position element as visible', () => {
    // The regression this exists for: `offsetParent` is null for
    // position: fixed, so the old check reported sticky toolbars, fixed
    // headers and modal dialogs as hidden — the controls a generated tool is
    // most likely to target. await_condition then waited for something that
    // was on screen the whole time.
    document.body.innerHTML = '<button id="b" style="position: fixed">Go</button>'
    expect(isVisible(document.getElementById('b')!)).toBe(true)
  })

  it('reports display:none and visibility:hidden as hidden', () => {
    document.body.innerHTML = `
      <button id="none" style="display: none">a</button>
      <button id="hidden" style="visibility: hidden">b</button>`
    expect(isVisible(document.getElementById('none')!)).toBe(false)
    expect(isVisible(document.getElementById('hidden')!)).toBe(false)
  })

  it('treats a hidden or aria-hidden ancestor as hiding its descendants', () => {
    document.body.innerHTML = `
      <div hidden><button id="a">a</button></div>
      <div aria-hidden="true"><button id="b">b</button></div>`
    expect(isVisible(document.getElementById('a')!)).toBe(false)
    expect(isVisible(document.getElementById('b')!)).toBe(false)
  })

  it('reports an ordinary element as visible under jsdom', () => {
    // Layout-dependent checks report everything as hidden here, which would
    // make every unit test of a tool that waits on an element meaningless.
    document.body.innerHTML = '<button id="b">Go</button>'
    expect(isVisible(document.getElementById('b')!)).toBe(true)
  })
})
