export function resolveSelector(el: Element): string {
  if (el.id) return `#${el.id}`
  return el.tagName.toLowerCase()
}
