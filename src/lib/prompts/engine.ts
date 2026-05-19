import type { CapturedEvent, SessionEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ScrollEvent, ConsoleEvent, DragEvent, ElementPickEvent, ResizeEvent } from '../event-capture/types'

export function parseBrowser(ua: string): string {
  if (/Edg\//.test(ua)) {
    const v = ua.match(/Edg\/([\d]+)/)?.[1]
    return v ? `Edge ${v}` : 'Edge'
  }
  if (/Chrome\//.test(ua)) {
    const v = ua.match(/Chrome\/([\d]+)/)?.[1]
    return v ? `Chrome ${v}` : 'Chrome'
  }
  if (/Firefox\//.test(ua)) {
    const v = ua.match(/Firefox\/([\d]+)/)?.[1]
    return v ? `Firefox ${v}` : 'Firefox'
  }
  if (/Safari\//.test(ua)) {
    const v = ua.match(/Version\/([\d]+)/)?.[1]
    return v ? `Safari ${v}` : 'Safari'
  }
  return ua
}

export function fieldsOf(event: CapturedEvent): Record<string, string> {
  switch (event.type) {
    case 'click': {
      const e = event as ClickEvent
      return { selector: e.selector, label: e.label, count: String(e.count), x: String(e.x), y: String(e.y) }
    }
    case 'navigation': {
      const e = event as NavigationEvent
      return { url: e.url, title: e.title }
    }
    case 'api': {
      const e = event as ApiEvent
      const out: Record<string, string> = { method: e.method, url: e.url }
      out.status = e.status != null ? String(e.status) : 'pending'  // always include status
      if (e.requestBody != null) out.request_body = e.requestBody
      if (e.responseBody != null) out.response_body = e.responseBody
      if (e.errorDetails != null) out.error_details = e.errorDetails
      return out
    }
    case 'keyboard': {
      const e = event as KeyboardInputEvent
      const out: Record<string, string> = { selector: e.selector, input_type: e.inputType, count: String(e.count) }
      if (e.key != null) out.key = e.key
      if (e.keys != null) {
        out.sequence = e.keys.map(k => k.length === 1 ? k : `[${k}]`).join('')
      }
      return out
    }
    case 'scroll': {
      const e = event as ScrollEvent
      return { selector: e.selector, direction: e.direction, delta_x: String(e.deltaX), delta_y: String(e.deltaY), count: String(e.count) }
    }
    case 'console': {
      const e = event as ConsoleEvent
      return { level: e.level, message: e.message, source: e.source ?? '' }
    }
    case 'drag': {
      const e = event as DragEvent
      const out: Record<string, string> = {
        source_selector: e.sourceSelector,
        path: e.path.map(p => `(${p.x},${p.y})`).join(' '),
      }
      if (e.targetSelector != null) out.target_selector = e.targetSelector
      return out
    }
    case 'element_pick': {
      const e = event as ElementPickEvent
      const styles = Object.entries(e.styles).map(([k, v]) => `${k}: ${v}`).join('; ')
      return { ...e.attributes, ...e.styles, selector: e.selector, text: e.text, styles }
    }
    case 'session': {
      const e = event as SessionEvent
      return { browser: parseBrowser(e.browser), viewport: `${e.viewport.width}×${e.viewport.height}` }
    }
    case 'resize': {
      const e = event as ResizeEvent
      const out: Record<string, string> = { width: String(e.width), height: String(e.height) }
      if (e.orientation != null) out.orientation = e.orientation
      return out
    }
  }
}

export function defaultNoteTemplate(event: CapturedEvent): string {
  switch (event.type) {
    case 'click':        return 'Clicked {label} at ({x}, {y}) on element {selector}'
    case 'navigation':   return 'Navigated to {url}'
    case 'api':          return '{method} {url} → {status}'
    case 'keyboard': {
      const e = event as KeyboardInputEvent
      if (e.keys != null) return 'Typed "{sequence}" in {selector}'
      if (e.key === 'Enter') return 'Pressed Enter in {selector}'
      return 'Typed {count} characters in {selector}'
    }
    case 'scroll':       return 'Scrolled {direction} on {selector}'
    case 'drag':         return 'Dragged {source_selector} onto {target_selector} path: {path}'
    case 'console':      return 'Console {source} {level}: {message}'
    case 'session':      return 'Session started on {browser} {viewport}'
    case 'element_pick': return ''
    case 'resize':       return 'Viewport resized to {width}×{height}'
  }
}

export function expandFields(text: string, fields: Record<string, string>): string {
  // Temporarily protect double-braces from substitution
  const SENTINEL = '\x00'
  const protected_ = text.replace(/\{\{([\w-]+)\}\}/g, `${SENTINEL}$1${SENTINEL}`)
  // Substitute single-brace tokens; pass through unresolved
  const substituted = protected_.replace(/\{([\w-]+)\}/g, (match, key) => fields[key] ?? match)
  // Unescape sentinels back to literal {field}
  return substituted.replace(new RegExp(`${SENTINEL}([\\w-]+)${SENTINEL}`, 'g'), '{$1}')
}

export interface PromptContext {
  url: string
  elementSelector?: string
  events: CapturedEvent[]
  selectedEvent?: CapturedEvent
  userText: string
  exclude?: string[]
}

export interface SlotValues {
  url: string
  element_selector?: string
  interaction_description: string
  method?: string
  status?: string
  error_details?: string
  user_text: string
  [key: string]: string | undefined
}

export function resolveSlots(ctx: PromptContext): SlotValues {
  const api = ctx.selectedEvent?.type === 'api' ? ctx.selectedEvent as ApiEvent : undefined
  const pick = ctx.selectedEvent?.type === 'element_pick' ? ctx.selectedEvent as ElementPickEvent : undefined
  const eventFields = ctx.selectedEvent ? fieldsOf(ctx.selectedEvent) : {}

  return {
    ...eventFields,
    url: ctx.url,
    element_selector: ctx.elementSelector ?? pick?.selector,
    interaction_description: formatEvents(ctx.exclude?.length ? ctx.events.filter(e => !ctx.exclude!.includes(e.type)) : ctx.events),
    method: api?.method,
    status: api?.status?.toString(),
    error_details: api?.errorDetails ?? undefined,
    user_text: ctx.userText,
  }
}

export function renderTemplate(body: string, slots: SlotValues): string {
  return body
    .split('\n')
    .map(line => line.replace(/\{(\w+)\}/g, (_, key) => slots[key] ?? `{${key}}`))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatEvents(events: CapturedEvent[]): string {
  let i = 0
  return events
    .map(e => {
      if (e.excluded) return null
      const template = e.note ?? defaultNoteTemplate(e)
      if (!template) return null
      i++
      return `${i}. ${expandFields(template, fieldsOf(e))}`
    })
    .filter((line): line is string => line !== null)
    .join('\n')
}
