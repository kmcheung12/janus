const HASHED_CLASS = /^[a-zA-Z]{2,4}-[a-z0-9]{4,}$|^css-[a-z0-9]+$/

export function resolveSelector(el: Element): string {
  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`

  if (el.id) return `#${el.id}`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`

  const text = el.textContent?.trim().slice(0, 40)
  if (text) return `${el.tagName.toLowerCase()}:contains("${text}")`

  const classes = Array.from(el.classList)
    .filter(c => !HASHED_CLASS.test(c))
    .slice(0, 2)
    .join('.')

  return classes
    ? `${el.tagName.toLowerCase()}.${classes}`
    : el.tagName.toLowerCase()
}
