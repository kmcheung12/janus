export interface Template {
  id: string
  name: string
  description: string
  body: string
  isBuiltIn: boolean
  contextScope: 'element' | 'event' | 'both'
}

export const AUTO_FILL_SLOTS = [
  { key: 'url', description: 'Current page URL' },
  { key: 'element_selector', description: 'CSS selector of the picked element' },
  { key: 'interaction_description', description: 'All captured events as numbered steps' },
  { key: 'method', description: 'HTTP method of the selected API call' },
  { key: 'status', description: 'HTTP status code of the selected API call' },
  { key: 'error_details', description: 'Error message or response body on API failure' },
] as const

export type AutoFillSlotKey = typeof AUTO_FILL_SLOTS[number]['key']
