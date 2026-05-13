const HASHED_CLASS = /^[a-zA-Z]{2,4}-[a-z0-9]{4,}$|^css-[a-z0-9]+$/

function segmentFor(el: Element): string {
  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${testId}"]`

  if (el.id) return `#${el.id}`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${ariaLabel}"]`

  const classes = Array.from(el.classList)
    .filter(c => !HASHED_CLASS.test(c))
    .slice(0, 2)
    .join('.')

  return classes
    ? `${el.tagName.toLowerCase()}.${classes}`
    : el.tagName.toLowerCase()
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const matches = document.querySelectorAll(selector)
    return matches.length === 1 && matches[0] === el
  } catch {
    return false
  }
}

export function resolveSelector(el: Element): string {
  if (!el.isConnected) return segmentFor(el)

  const segments: string[] = [segmentFor(el)]
  let ancestor: Element | null = el.parentElement

  while (ancestor && ancestor !== document.documentElement) {
    if (isUnique(segments.join(' > '), el)) return segments.join(' > ')
    segments.unshift(segmentFor(ancestor))
    ancestor = ancestor.parentElement
  }

  if (isUnique(segments.join(' > '), el)) return segments.join(' > ')

  // Last resort: nth-child index within immediate parent
  const parent = el.parentElement
  if (parent) {
    const index = Array.from(parent.children).indexOf(el) + 1
    segments[segments.length - 1] = `${el.tagName.toLowerCase()}:nth-child(${index})`
  }
  return segments.join(' > ')
}
