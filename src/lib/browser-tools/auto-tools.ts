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
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return !element.closest('[hidden], [aria-hidden="true"]')
}

/** Chrome that is navigation, not content. Including it wastes most of the budget. */
const CHROME_SELECTORS = [
  'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'template',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
  '[role="complementary"]', '[aria-hidden="true"]', '[hidden]',
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
          href: (a as HTMLAnchorElement).href,
        }))
        .filter((l) => l.text)

      const body = mainText()

      return {
        title: document.title,
        url: window.location.href,
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
        matches.push({ text: clamp(text, SNIPPET), href: anchor?.href ?? null })
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
      const forms = [...document.querySelectorAll('form')].slice(0, 20).map((form, index) => ({
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

function formLabel(form: HTMLFormElement, index: number): string {
  const named = form.getAttribute('name')
    || form.getAttribute('aria-label')
    || form.querySelector('legend, h1, h2, h3')?.textContent
    || form.querySelector('button[type="submit"], input[type="submit"]')?.textContent
    || (form.querySelector('input[type="submit"]') as HTMLInputElement | null)?.value
  const cleaned = clamp(named ?? '', 40)
  return cleaned || `form ${index + 1}`
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
  const forms = [...document.querySelectorAll('form')].slice(0, 8) as HTMLFormElement[]

  for (const [index, form] of forms.entries()) {
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

    definitions.push({
      formatVersion: 1,
      definitionId: `auto_${pageId.slice(0, 8)}_${index}`,
      definitionRevision: 1,
      principalId: 'auto',
      sourceDraft: { id: draft.id, revision: draft.revision },
      applicability: draft.applicability,
      name: `submit_${slug(label)}`,
      description:
        `Fill and submit the "${label}" form on this page, then read the result. `
        + `Automatically derived from the page, not authored — verify the outcome.`,
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
