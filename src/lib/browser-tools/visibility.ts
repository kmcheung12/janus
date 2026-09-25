/**
 * Whether an element is visible, for tools that act on it.
 *
 * Deliberately not `offsetParent !== null`. That is also null for
 * `position: fixed` elements, so it reports fixed headers, sticky toolbars and
 * modal dialogs as hidden — exactly the controls a generated tool is most
 * likely to target. It also depends on layout, which means it reports
 * everything as hidden under jsdom.
 */
export function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return !element.closest('[hidden], [aria-hidden="true"]')
}
