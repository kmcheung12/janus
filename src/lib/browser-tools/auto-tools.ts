/**
 * Automatic tools for pages with no native WebMCP.
 *
 * Two kinds, with deliberately different risk:
 *
 *  - **Read tools** are packaged adapters (§11): fixed extension code, no
 *    caller-supplied selectors, no writes. They publish automatically on every
 *    enabled page, because reading a page the user has already opened and
 *    explicitly enabled adds no authority an agent did not already have.
 *
 *  - **Form tools** fill and submit. They are derived automatically too, but
 *    only publish when the user opts that page in, because submitting a form
 *    on a logged-in session is exactly the authority the review step exists to
 *    withhold.
 *
 * Neither path involves a model. Structure comes from the DOM, so there is no
 * draft round-trip and nothing to approve for the read case.
 */

import type { GeneratedDefinition, Json, ToolDescriptor, ToolOutcome } from './contract'
import { LIMITS } from './limits'
import { scanForm } from './form-scanner'
import { sanitizeUrl } from './url-safety'

const READ_PREFIX = 'a_'
const FORM_PREFIX = 'af_'

/** Bounds so a large page cannot blow the result limit or the context window. */
const MAX_LINKS = 100
const MAX_HEADINGS = 60
const MAX_TEXT = 8_000
const MAX_MATCHES = 30
const SNIPPET = 240

function clamp(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned
}

/**
 * Deliberately not `offsetParent !== null`: that is also null for
 * `position: fixed` elements, so it would silently drop fixed headers and
 * navigation — and it depends on layout, which means it reports everything as
 * hidden under jsdom.
 */
function visible(element: Element): boolean {
  if (element.closest(JANUS_UI)) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return !element.closest('[hidden], [aria-hidden="true"]')
}

/**
 * Janus's own injected UI. It is in the DOM but it is not the page, and an
 * agent reading its own tool list back as page content would be both a wasted
 * budget and a feedback loop.
 */
const JANUS_UI = '#janus-root, #janus-agent-tools-root'

/** Chrome that is navigation, not content. Including it wastes most of the budget. */
const CHROME_SELECTORS = [
  'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'template',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
  '[role="complementary"]', '[aria-hidden="true"]', '[hidden]',
  JANUS_UI,
].join(', ')

/**
 * The page's actual prose.
 *
 * Reading `body.textContent` on a real site returns mostly menus — a Wikipedia
 * article filled the entire 8k budget with "Toggle the table of contents / Edit
 * links / Article Talk / Read Edit View history" before reaching a sentence.
 * So: prefer a content root, then strip navigation from a clone.
 */
function mainText(): string {
  const root = document.querySelector(
    '#mw-content-text, main, [role="main"], article, #content, .content',
  ) ?? document.body

  const clone = root.cloneNode(true) as HTMLElement
  for (const element of clone.querySelectorAll(CHROME_SELECTORS)) element.remove()
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

// ── Read tools ─────────────────────────────────────────────────────────────

const READ_TOOLS: Array<{
  id: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  run: (input: Record<string, Json>) => Json
}> = [
  {
    id: 'read_page',
    name: 'read_page',
    description:
      'Read the visible content of this page as structured data: title, headings, main text and links. '
      + 'Use this instead of asking for a DOM dump.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const headings = [...document.querySelectorAll('h1, h2, h3')]
        .filter(visible)
        .slice(0, MAX_HEADINGS)
        .map((h) => ({ level: Number(h.tagName[1]), text: clamp(h.textContent ?? '', 200) }))
        .filter((h) => h.text)

      const links = [...document.querySelectorAll('a[href]')]
        .filter(visible)
        .slice(0, MAX_LINKS)
        .map((a) => ({
          text: clamp(a.textContent ?? '', 120),
          href: sanitizeUrl((a as HTMLAnchorElement).href),
        }))
        .filter((l) => l.text)

      const body = mainText()

      return {
        title: document.title,
        // The current URL is as capable of carrying a token as any link on it.
        url: sanitizeUrl(window.location.href),
        headings,
        links,
        text: clamp(body, MAX_TEXT),
        truncated: body.length > MAX_TEXT,
      } as Json
    },
  },
  {
    id: 'find_text',
    name: 'find_text',
    description:
      'Find where a phrase appears on this page. Returns matching snippets with their nearest link, '
      + 'so you can locate an item without reading the whole page.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to look for, case-insensitive.' } },
      required: ['query'],
      additionalProperties: false,
    },
    run: (input) => {
      const query = String(input.query ?? '').toLowerCase()
      if (!query) return { matches: [] } as Json

      const matches: Array<{ text: string; href: string | null }> = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)

      for (let node = walker.nextNode(); node && matches.length < MAX_MATCHES; node = walker.nextNode()) {
        const text = node.textContent ?? ''
        if (!text.toLowerCase().includes(query)) continue
        const element = node.parentElement
        if (!element || !visible(element)) continue
        const anchor = element.closest('a[href]') as HTMLAnchorElement | null
        matches.push({
          text: clamp(text, SNIPPET),
          href: anchor ? sanitizeUrl(anchor.href) : null,
        })
      }

      return { query: String(input.query), matches, truncated: matches.length >= MAX_MATCHES } as Json
    },
  },
  {
    id: 'list_forms',
    name: 'list_forms',
    description:
      'List the forms on this page and their fields. Shows what could be filled, and whether form tools '
      + 'are currently enabled for this page.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => {
      const forms = [...document.querySelectorAll('form')]
        .filter((form) => !form.closest(JANUS_UI))
        .slice(0, 20)
        .map((form, index) => ({
          index,
          label: formLabel(form, index),
          fields: [...form.elements]
            .map((el) => ({
              name: (el as HTMLInputElement).name || (el as HTMLElement).id || null,
              type: (el as HTMLInputElement).type ?? el.tagName.toLowerCase(),
            }))
            .filter((f) => f.name && f.type !== 'hidden'),
        }))
      return { forms } as Json
    },
  },
]

export function readToolDescriptors(): ToolDescriptor[] {
  return READ_TOOLS.map((tool) => ({
    toolId: `${READ_PREFIX}${tool.id}`,
    toolRevision: 1,
    source: { kind: 'generated', definitionId: `builtin_${tool.id}`, definitionRevision: 1 },
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as ToolDescriptor['inputSchema'],
    readOnlyHint: true,
    consequentialHint: false,
  }))
}

export function isAutoToolId(toolId: string): boolean {
  return toolId.startsWith(READ_PREFIX) || toolId.startsWith(FORM_PREFIX)
}

export function invokeReadTool(toolId: string, input: Record<string, Json>): ToolOutcome {
  const tool = READ_TOOLS.find((t) => `${READ_PREFIX}${t.id}` === toolId)
  if (!tool) {
    return {
      status: 'error',
      error: { code: 'TOOL_UNAVAILABLE', message: `No built-in tool "${toolId}"`, execution: 'not_started' },
    }
  }
  try {
    return { status: 'completed', result: tool.run(input) }
  } catch (e) {
    return {
      status: 'error',
      error: { code: 'INTERNAL_ERROR', message: String((e as Error)?.message ?? e), execution: 'failed' },
    }
  }
}

// ── Form tools ─────────────────────────────────────────────────────────────

/**
 * A human name for a form, from whatever the page actually says.
 *
 * "form 1" is useless to an agent choosing between several. Real pages almost
 * always name a form somewhere — its submit button, an aria-label, a search
 * role — it is just never in one consistent place.
 */
function formLabel(form: HTMLFormElement, index: number): string {
  const submitText = () => {
    const button = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])')
    if (!button) return ''
    return button instanceof HTMLInputElement ? button.value : (button.textContent ?? '')
  }

  const searchLike = form.getAttribute('role') === 'search'
    || form.querySelector('input[type="search"]')
    || /search/i.test(form.getAttribute('action') ?? '')

  const candidates = [
    form.getAttribute('aria-label'),
    form.getAttribute('title'),
    submitText(),
    form.querySelector('legend')?.textContent,
    searchLike ? 'search' : '',
    form.getAttribute('name'),
    // Older markup labels a form with a bare text node. Hacker News writes
    // "Search:" directly inside the form — no label, aria-label or button — so
    // without this its search box is named after its field, `q`.
    leadingText(form),
    // A single-field form is named by that field.
    onlyFieldLabel(form),
    lastPathSegment(form.getAttribute('action')),
  ]

  for (const candidate of candidates) {
    const cleaned = clamp(candidate ?? '', 40)
    // Reject pure punctuation/icons and bare numbers.
    if (cleaned && /[a-z]/i.test(cleaned) && !/^\d+$/.test(cleaned)) return cleaned
  }
  return `form ${index + 1}`
}

/**
 * Text the form states about itself, before its first control.
 *
 * Walks in document order rather than over direct children, because sites
 * label a form in every shape imaginable — a bare text node (Hacker News), a
 * wrapping div, a heading. Reading only direct children handled Hacker News
 * and missed the other two.
 *
 * Stops at the first control, so a form wrapping a page section cannot be
 * named after its body copy.
 */
function leadingText(form: HTMLFormElement): string {
  const walker = document.createTreeWalker(form, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let text = ''

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') break
      continue
    }
    text += ` ${node.textContent ?? ''}`
    // Enough to name something; anything more is body copy.
    if (text.trim().length > 60) break
  }

  return text.replace(/\s+/g, ' ').trim().replace(/[:：]\s*$/, '').slice(0, 40)
}

function onlyFieldLabel(form: HTMLFormElement): string {
  const fields = [...form.elements].filter((el) => {
    const type = (el as HTMLInputElement).type
    return type && !['submit', 'button', 'reset', 'image', 'hidden'].includes(type)
  })
  if (fields.length !== 1) return ''
  const field = fields[0] as HTMLInputElement
  return field.getAttribute('aria-label') || field.placeholder || field.name || ''
}

function lastPathSegment(action: string | null): string {
  if (!action) return ''
  try {
    const path = new URL(action, window.location.href).pathname
    return path.split('/').filter(Boolean).at(-1)?.replace(/\.[a-z]+$/i, '') ?? ''
  } catch {
    return ''
  }
}

/** Forms that do the same thing, to avoid publishing a desktop and mobile pair. */
function formSignature(form: HTMLFormElement): string {
  const fields = [...form.elements]
    .map((el) => (el as HTMLInputElement).name || (el as HTMLElement).id)
    .filter(Boolean)
    .sort()
  return `${form.method}|${form.getAttribute('action') ?? ''}|${fields.join(',')}`
}

/** A form with a credential field cannot be driven correctly without it. */
function hasSensitiveField(form: HTMLFormElement): boolean {
  return [...form.elements].some((el) => {
    const type = (el as HTMLInputElement).type
    const autocomplete = el.getAttribute('autocomplete') ?? ''
    return type === 'password'
      || type === 'file'
      || /password|cc-number|cc-csc|one-time-code/.test(autocomplete)
  })
}

function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'form'
}

/**
 * Derive a definition per form, deterministically. Same scanner the authored
 * path uses, so the recipe runtime's target checks, bounds and failure
 * behaviour apply identically — these are not a privileged shortcut.
 */
export function autoFormDefinitions(pageId: string, documentId: string): GeneratedDefinition[] {
  const definitions: GeneratedDefinition[] = []
  const forms = ([...document.querySelectorAll('form')] as HTMLFormElement[])
    .filter((form) => !form.closest(JANUS_UI))
    .slice(0, 16)
  const seenSignature = new Set<string>()
  const usedNames = new Set<string>()

  for (const [index, form] of forms.entries()) {
    // A login form is not partially usable: submitting it without the password
    // just fails, so publishing it would only mislead.
    if (hasSensitiveField(form)) continue

    // Sites commonly render the same form twice for desktop and mobile. Two
    // identical tools with different numbers is worse than one named tool.
    const signature = formSignature(form)
    if (seenSignature.has(signature)) continue
    seenSignature.add(signature)

    let scanned
    try {
      scanned = scanForm({
        form, principalId: 'auto', browserSessionId: 'auto', pageId, documentId,
      })
    } catch {
      continue
    }

    const { draft } = scanned
    const usable = draft.slots.filter((s) => !s.sensitive)
    // A form whose only inputs are sensitive has nothing safe to parameterize.
    if (usable.length === 0) continue

    const used = new Set<string>()
    const parameters = usable.map((slot, i) => ({
      slotId: slot.id,
      name: parameterName(draft, slot.id, i, used),
    }))

    const properties: Record<string, unknown> = {}
    for (const [i, parameter] of parameters.entries()) {
      properties[parameter.name] = usable[i].constraint
    }

    const label = formLabel(form, index)
    let name = slug(label)
    if (name.startsWith('submit_') === false && !/^(search|find|filter|subscribe|sign|log)/.test(name)) {
      name = `submit_${name}`
    }
    // Names must be unique within a page, but a numeric suffix is a last resort.
    let unique = name
    for (let n = 2; usedNames.has(unique); n++) unique = `${name}_${n}`
    usedNames.add(unique)

    const fieldNames = parameters.map((p) => p.name).join(', ')

    definitions.push({
      formatVersion: 1,
      definitionId: `auto_${pageId.slice(0, 8)}_${index}`,
      definitionRevision: 1,
      principalId: 'auto',
      sourceDraft: { id: draft.id, revision: draft.revision },
      applicability: draft.applicability,
      name: unique,
      description:
        `${label.charAt(0).toUpperCase()}${label.slice(1)} on ${window.location.hostname}`
        + `${fieldNames ? ` — fills ${fieldNames}` : ''}, submits the form and returns the result. `
        + `Derived automatically from the page rather than authored, so verify the outcome.`,
      inputSchema: {
        type: 'object',
        properties: properties as never,
        required: parameters.map((p) => p.name),
        additionalProperties: false,
      },
      parameters,
      slots: draft.slots,
      bindings: draft.bindings,
      steps: draft.candidateSteps,
      evidenceIds: [],
      // It submits. Unknown effects default to consequential (§17).
      annotations: { readOnly: false, consequential: true },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }

  return definitions
}

/**
 * Name a parameter after the control it fills.
 *
 * Resolved through the binding to the live element, because the binding ID is
 * a positional token — naming from it produced a parameter literally called
 * "0" on Wikipedia's search form.
 */
function parameterName(
  draft: { candidateSteps: GeneratedDefinition['steps']; bindings: GeneratedDefinition['bindings'] },
  slotId: string,
  index: number,
  used: Set<string>,
): string {
  let candidate = ''

  for (const step of draft.candidateSteps) {
    if ((step.op !== 'set_field' && step.op !== 'select_option')
      || step.value.kind !== 'slot' || step.value.slotId !== slotId) continue

    const binding = draft.bindings.find((b) => b.id === (step as { targetId: string }).targetId)
    if (binding?.kind !== 'control') break

    const element = document.querySelector(binding.selector) as HTMLElement | null
    if (element) {
      candidate = slug(
        (element as HTMLInputElement).name
        || element.getAttribute('aria-label')
        || element.getAttribute('placeholder')
        || element.id
        || element.closest('label')?.textContent
        || '',
      )
    }
    break
  }

  // A purely numeric or empty name is no better than a position, and is
  // awkward for a caller to pass.
  let name = candidate && !/^\d+$/.test(candidate) ? candidate : `field_${index + 1}`
  while (used.has(name)) name = `${name}_${index + 1}`
  used.add(name)
  return name
}

export function autoFormToolId(definitionId: string): string {
  return `${FORM_PREFIX}${definitionId}`
}

export function autoFormDefinitionId(toolId: string): string {
  return toolId.replace(new RegExp(`^${FORM_PREFIX}`), '')
}

export function formToolDescriptor(definition: GeneratedDefinition): ToolDescriptor {
  return {
    toolId: autoFormToolId(definition.definitionId),
    toolRevision: definition.definitionRevision,
    source: {
      kind: 'generated',
      definitionId: definition.definitionId,
      definitionRevision: definition.definitionRevision,
    },
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema as unknown as ToolDescriptor['inputSchema'],
    readOnlyHint: false,
    consequentialHint: true,
  }
}

export { LIMITS }
