import type { CapturedEvent, SessionEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ScrollEvent, ConsoleEvent, DragEvent, ElementPickEvent } from '../event-capture/types'

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
      if (e.status != null) out.status = String(e.status)
      if (e.requestBody != null) out.request_body = e.requestBody
      if (e.responseBody != null) out.response_body = e.responseBody
      if (e.errorDetails != null) out.error_details = e.errorDetails
      return out
    }
    case 'keyboard': {
      const e = event as KeyboardInputEvent
      const out: Record<string, string> = { selector: e.selector, input_type: e.inputType, count: String(e.count) }
      if (e.key != null) out.key = e.key
      return out
    }
    case 'scroll': {
      const e = event as ScrollEvent
      return { selector: e.selector, direction: e.direction, delta_x: String(e.deltaX), delta_y: String(e.deltaY), count: String(e.count) }
    }
    case 'console': {
      const e = event as ConsoleEvent
      return { level: e.level, message: e.message }
    }
    case 'drag': {
      const e = event as DragEvent
      const out: Record<string, string> = { source_selector: e.sourceSelector }
      if (e.targetSelector != null) out.target_selector = e.targetSelector
      return out
    }
    case 'element_pick': {
      const e = event as ElementPickEvent
      return { selector: e.selector, text: e.text, ...e.attributes, ...e.styles }
    }
    case 'session':
      return {}
  }
}

export interface PromptContext {
  url: string
  elementSelector?: string
  events: CapturedEvent[]
  selectedEvent?: CapturedEvent
  userText: string
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

  return {
    url: ctx.url,
    element_selector: ctx.elementSelector,
    interaction_description: formatEvents(ctx.events),
    method: api?.method,
    status: api?.status?.toString(),
    error_details: api?.errorDetails ?? undefined,
    user_text: ctx.userText,
  }
}

export function renderTemplate(body: string, slots: SlotValues): string {
  return body
    .split('\n')
    .map(line => {
      const resolved = line.replace(/\{(\w+)\}/g, (_, key) => slots[key] ?? `{${key}}`)
      // Drop lines that still have unresolved slots
      return /\{[a-z_]+\}/.test(resolved) ? null : resolved
    })
    .filter((line): line is string => line !== null)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function formatEvents(events: CapturedEvent[]): string {
  return events.map((e, i) => {
    switch (e.type) {
      case 'session': {
        const s = e as SessionEvent
        return `${i + 1}. Session started — viewport ${s.viewport.width}×${s.viewport.height}, dpr ${s.dpr}`
      }
      case 'navigation':
        return `${i + 1}. Navigated to ${(e as NavigationEvent).url}`
      case 'click': {
        const c = e as ClickEvent
        return `${i + 1}. Clicked ${c.label || c.selector} at (${c.x}, ${c.y})${c.count > 1 ? ` (×${c.count})` : ''}`
      }
      case 'keyboard': {
        const k = e as KeyboardInputEvent
        if (k.keys !== undefined) {
          const seq = k.keys.map(key => key.length === 1 ? key : `[${key}]`).join('')
          return `${i + 1}. Typed "${seq}" in ${k.selector}`
        }
        if (k.key === 'Enter') {
          return `${i + 1}. Pressed Enter in ${k.selector}${k.count > 1 ? ` (×${k.count})` : ''}`
        }
        return `${i + 1}. Typed ${k.count} characters in ${k.selector} (${k.inputType})`
      }
      case 'api': {
        const a = e as ApiEvent
        return `${i + 1}. ${a.method} ${a.url} → ${a.status ?? 'pending'}`
      }
      case 'scroll': {
        const s = e as ScrollEvent
        const target = s.selector === 'window' ? 'page' : s.selector
        const px = Math.abs(s.deltaX) >= Math.abs(s.deltaY) ? Math.abs(s.deltaX) : Math.abs(s.deltaY)
        return `${i + 1}. Scrolled ${s.direction} ${px}px on ${target}${s.count > 1 ? ` (×${s.count})` : ''}`
      }
      case 'drag': {
        const d = e as DragEvent
        const target = d.targetSelector ? ` onto ${d.targetSelector}` : ''
        const path = d.path.map(p => `(${p.x},${p.y})`).join('→')
        return `${i + 1}. Dragged ${d.sourceSelector}${target}: ${path}`
      }
      case 'console': {
        const c = e as ConsoleEvent
        return `${i + 1}. Console ${c.level}: ${c.message}`
      }
    }
  }).join('\n')
}
