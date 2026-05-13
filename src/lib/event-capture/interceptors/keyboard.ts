import type { KeyboardInputEvent, CapturedEvent } from '../types'
import { resolveSelector } from '../../element-selector'
import { uuid } from '../../uuid'

// Input type capture matrix:
//
// Type             | Capture input event? | Capture Enter keydown/keyup?
// -----------------|----------------------|------------------------------
// text             | yes                  | yes
// email            | yes                  | yes
// url              | yes                  | yes
// tel              | yes                  | yes
// search           | yes                  | yes
// number           | yes                  | yes
// file             | yes                  | yes
// textarea         | yes                  | no — Enter inserts newline, input captures it
// contenteditable  | yes                  | no — Enter inserts line break, input captures it
// date             | yes                  | no — Enter confirms picker, input captures it
// time             | yes                  | no — Enter confirms picker, input captures it
// color            | yes                  | no — Enter confirms picker, input captures it
// range            | no — click captures  | n/a
// checkbox         | no — click captures  | n/a
// radio            | no — click captures  | n/a
// select-one       | no — click captures  | n/a
// select-multiple  | no — click captures  | n/a
// hidden           | no — no user gesture | n/a
// password         | no — security        | no — security

// Input types where an input event is a side-effect of a click (already captured
// by the click interceptor), or where there is no meaningful user text input.
const INPUT_SKIP_TYPES = new Set([
  'checkbox', 'radio', 'select-one', 'select-multiple', 'range', 'hidden',
])

// Input types where pressing Enter fires an input event that captures the value
// change. Emitting a separate Enter keyboard event would duplicate it.
const ENTER_SKIP_TYPES = new Set(['textarea', 'date', 'time', 'color'])

function shouldSkipEnter(target: Element): boolean {
  const inputType = (target as HTMLInputElement).type
  const el = target as HTMLElement
  const isEditable = el.isContentEditable || el.contentEditable === 'true'
  return ENTER_SKIP_TYPES.has(inputType) || isEditable
}

export function attachKeyboardInterceptor(onEvent: (e: CapturedEvent) => void): () => void {
  function inputHandler(e: Event) {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return

    const inputType = (target as HTMLInputElement).type ?? 'text'
    if (INPUT_SKIP_TYPES.has(inputType)) return

    const event: KeyboardInputEvent = {
      id: uuid(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
    }
    onEvent(event)
  }

  // Chrome's native form-submission handling can swallow keydown for Enter before
  // content-script capture listeners fire. keyup is a reliable fallback.
  // pendingEnter tracks elements where keydown already emitted, so keyup skips them.
  const pendingEnter = new WeakSet<Element>()

  function emitEnter(target: Element) {
    const inputType = (target as HTMLInputElement).type ?? 'text'
    onEvent({
      id: uuid(),
      type: 'keyboard',
      timestamp: Date.now(),
      selector: resolveSelector(target),
      inputType,
      count: 1,
      key: 'Enter',
    })
  }

  function keydownHandler(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    const target = e.target as Element
    if (!target) return
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return
    if (shouldSkipEnter(target)) return
    pendingEnter.add(target)
    emitEnter(target)
  }

  function keyupHandler(e: KeyboardEvent) {
    if (e.key !== 'Enter') return
    const target = e.target as Element
    if (!target) return
    if (pendingEnter.has(target)) {
      pendingEnter.delete(target)
      return // keydown already emitted
    }
    if (target.closest('#janus-root')) return
    if ((target as HTMLInputElement).type === 'password') return
    if (shouldSkipEnter(target)) return
    emitEnter(target)
  }

  document.addEventListener('input', inputHandler, { capture: true })
  document.addEventListener('keydown', keydownHandler, { capture: true })
  document.addEventListener('keyup', keyupHandler, { capture: true })
  return () => {
    document.removeEventListener('input', inputHandler, { capture: true })
    document.removeEventListener('keydown', keydownHandler, { capture: true })
    document.removeEventListener('keyup', keyupHandler, { capture: true })
  }
}
