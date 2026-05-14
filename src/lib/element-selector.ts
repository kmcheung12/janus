const HASHED_CLASS = /^[a-zA-Z]{2,4}-[a-z0-9]{4,}$|^css-[a-z0-9]+$/

// Polyfill-safe CSS identifier escaping (mirrors CSS.escape spec)
function cssEscapeId(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value)
  // Minimal implementation: escape non-word characters, then handle leading digit
  return value
    .replace(/([^\w-])/g, '\\$1')
    .replace(/^(\d)/, (_, d) => `\\3${d} `)
}

function escapeAttrValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function segmentFor(el: Element): string {
  const testId = el.getAttribute('data-testid')
  if (testId) return `[data-testid="${escapeAttrValue(testId)}"]`

  if (el.id) return `#${cssEscapeId(el.id)}`

  const ariaLabel = el.getAttribute('aria-label')
  if (ariaLabel) return `[aria-label="${escapeAttrValue(ariaLabel)}"]`

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
  } catch (e) {
    console.error('querySelectorAll failed for selector:', selector, e)
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

  // Last resort: apply nth-child progressively up the ancestor chain until unique
  let segIdx = segments.length - 1
  let current: Element | null = el
  while (current?.parentElement) {
    const parent = current.parentElement
    const index = Array.from(parent.children).indexOf(current) + 1
    segments[segIdx] = `${current.tagName.toLowerCase()}:nth-child(${index})`
    if (isUnique(segments.join(' > '), el)) return segments.join(' > ')
    segIdx--
    current = parent
    if (segIdx < 0) break
  }
  return segments.join(' > ')
}
