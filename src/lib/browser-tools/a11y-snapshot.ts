/**
 * The page as a screen reader would announce it.
 *
 * Scraping text and hrefs gives an agent prose. What it needs before acting is
 * what assistive technology has always needed: what a thing *is*, what it is
 * *called*, and what state it is *in* — a disabled button is not clickable, an
 * expanded menu should not be toggled shut, a checked box should not be blindly
 * flipped.
 *
 * There is no web API for the computed accessibility tree from a content
 * script. Chrome has AOM's computedRole/computedLabel only recently, Firefox
 * not at all, and CDP's Accessibility.getFullAXTree needs a debugger attach we
 * do not have. So it is computed here, using the same accessible-name
 * implementation testing-library runs in browsers.
 *
 * The other reason for this shape is naming. A screen reader never needed
 * unique selectors; it announces context — "Delete, button, Invoice #441". That
 * is what makes a name usable as a tool argument on a page with twelve Delete
 * buttons, where a bare accessible name resolves to all of them.
 */

import { computeAccessibleName } from 'dom-accessibility-api'
import { isVisible } from './visibility'

export interface A11yNode {
  role: string
  name: string
  /** Present only when it constrains what an agent may do. */
  state?: {
    disabled?: boolean
    checked?: boolean
    expanded?: boolean
    selected?: boolean
    required?: boolean
    invalid?: boolean
    busy?: boolean
  }
  /** Current value, for controls that carry one. */
  value?: string
  /** Where a link goes, already sanitised. */
  href?: string
  /** Disambiguating context, as a screen reader would announce it. */
  context?: string
}

/**
 * Implicit roles, kept deliberately small.
 *
 * aria-query has the full mapping, but most of it describes structure an agent
 * never addresses. These are the roles that are either actionable or worth
 * spending output on.
 */
const IMPLICIT_ROLES: Record<string, string> = {
  A: 'link', BUTTON: 'button', SUMMARY: 'button', SELECT: 'combobox',
  TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading',
  H4: 'heading', H5: 'heading', H6: 'heading', NAV: 'navigation',
  MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary',
  FORM: 'form', TABLE: 'table', IMG: 'img', OPTION: 'option',
}

const INPUT_ROLES: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox',
  url: 'textbox', password: 'textbox',
}

/** Roles an agent can act on, as opposed to read. */
const ACTIONABLE = new Set([
  'button', 'link', 'checkbox', 'radio', 'combobox', 'textbox', 'searchbox',
  'slider', 'spinbutton', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'switch', 'tab',
])

export function roleOf(element: Element): string {
  const explicit = element.getAttribute('role')
  if (explicit) return explicit.trim().split(/\s+/)[0]

  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type?.toLowerCase() ?? 'text'
    return INPUT_ROLES[type] ?? 'textbox'
  }
  if (element.tagName === 'A' && !element.hasAttribute('href')) return 'generic'

  const implicit = IMPLICIT_ROLES[element.tagName]
  if (implicit) return implicit

  /*
   * The div-that-is-a-button. A framework that ships no role usually still
   * ships a pointer cursor, and that is the only signal left once event
   * listeners are unreadable from an isolated world. Deliberately last, and
   * only for elements that are focusable or carry an inline handler, so a
   * styled card does not become a control.
   */
  const interactive = element.hasAttribute('onclick')
    || (element as HTMLElement).tabIndex >= 0
  if (interactive && window.getComputedStyle(element).cursor === 'pointer') {
    return 'button'
  }

  return 'generic'
}

function stateOf(element: Element): A11yNode['state'] | undefined {
  const el = element as HTMLInputElement
  const aria = (name: string) => element.getAttribute(`aria-${name}`)

  const state: NonNullable<A11yNode['state']> = {}
  if (el.disabled || aria('disabled') === 'true') state.disabled = true
  if (el.required || aria('required') === 'true') state.required = true
  if (aria('invalid') === 'true') state.invalid = true
  if (aria('busy') === 'true') state.busy = true
  if (aria('expanded')) state.expanded = aria('expanded') === 'true'
  if (aria('selected')) state.selected = aria('selected') === 'true'

  const checkable = el.type === 'checkbox' || el.type === 'radio'
  if (checkable) state.checked = el.checked
  else if (aria('checked')) state.checked = aria('checked') === 'true'

  return Object.keys(state).length ? state : undefined
}

/**
 * What a screen reader announces around a control: the nearest enclosing thing
 * that has a name of its own.
 *
 * This is what makes twelve "Delete" buttons addressable. Bounded to a few
 * ancestors so a deeply nested control does not inherit the whole page.
 */
function contextOf(element: Element, name: string): string | undefined {
  const GROUPING = 'tr,li,article,section,form,fieldset,[role="row"],[role="listitem"],[role="group"],[role="region"],[role="article"]'
  let current = element.parentElement
  for (let depth = 0; current && depth < 6; depth++, current = current.parentElement) {
    if (!current.matches(GROUPING)) continue
    const label = (current.getAttribute('aria-label')
      ?? current.querySelector('h1,h2,h3,h4,[role="heading"]')?.textContent
      ?? current.textContent
      ?? '').replace(/\s+/g, ' ').trim()
    // A container whose only text is the control itself distinguishes nothing.
    const without = label.replace(name, '').trim()
    if (without.length >= 2) return without.slice(0, 80)
  }
  return undefined
}

export function isActionable(node: A11yNode): boolean {
  return ACTIONABLE.has(node.role) && !node.state?.disabled
}

/**
 * A unique, human-meaningful handle for a control.
 *
 * Deliberately the same string an agent reads and the string it passes back:
 * a name it never saw in output is a name it guessed.
 */
export function handleFor(node: A11yNode): string {
  return node.context ? `${node.name} — ${node.context}` : node.name
}

export interface SnapshotOptions {
  /** Excluded from the page's own account of itself. */
  ignoreSelector?: string
  maxNodes?: number
}

/** Every perceivable, named element that carries meaning for an agent. */
export function snapshot(options: SnapshotOptions = {}): A11yNode[] {
  const { ignoreSelector, maxNodes = 200 } = options
  const nodes: A11yNode[] = []

  const candidates = document.querySelectorAll<HTMLElement>(
    'a,button,input,select,textarea,summary,h1,h2,h3,h4,h5,h6,'
    + '[role],[onclick],[tabindex]',
  )

  for (const element of candidates) {
    if (nodes.length >= maxNodes) break
    if (ignoreSelector && element.closest(ignoreSelector)) continue
    // Exactly what a screen reader skips.
    if (!isVisible(element)) continue

    const role = roleOf(element)
    if (role === 'generic') continue

    const name = computeAccessibleName(element).replace(/\s+/g, ' ').trim()
    // An unnamed control cannot be announced, and cannot be addressed either.
    if (!name) continue

    const node: A11yNode = { role, name }
    const state = stateOf(element)
    if (state) node.state = state

    const value = (element as HTMLInputElement).value
    if (value && role !== 'button' && role !== 'link') node.value = value

    const context = contextOf(element, name)
    if (context) node.context = context

    nodes.push(node)
  }

  return nodes
}
