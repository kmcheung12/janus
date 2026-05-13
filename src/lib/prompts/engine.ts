import type { CapturedEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ScrollEvent, ConsoleEvent } from '../event-capture/types'

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
      case 'navigation':
        return `${i + 1}. Navigated to ${(e as NavigationEvent).url}`
      case 'click': {
        const c = e as ClickEvent
        return `${i + 1}. Clicked ${c.label || c.selector}${c.count > 1 ? ` (×${c.count})` : ''}`
      }
      case 'keyboard': {
        const k = e as KeyboardInputEvent
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
      case 'console': {
        const c = e as ConsoleEvent
        return `${i + 1}. Console ${c.level}: ${c.message}`
      }
    }
  }).join('\n')
}
