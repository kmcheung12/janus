import type { Template } from './types'
import { DEFAULT_TEMPLATES } from './defaults'

const KEY = 'janus_templates'

export async function loadTemplates(): Promise<Template[]> {
  const result = await browser.storage.local.get(KEY)
  const stored: Template[] = result[KEY] ?? []
  const storedById = new Map(stored.map(t => [t.id, t]))

  const builtIns = DEFAULT_TEMPLATES.map(t => ({ ...t, ...storedById.get(t.id) }))
  const userDefined = stored.filter(t => !t.isBuiltIn)

  return [...builtIns, ...userDefined]
}

export async function saveTemplate(template: Template): Promise<void> {
  const all = await loadTemplates()
  const idx = all.findIndex(t => t.id === template.id)
  if (idx >= 0) all[idx] = template
  else all.push(template)
  await browser.storage.local.set({ [KEY]: all })
}

export async function deleteTemplate(id: string): Promise<void> {
  const all = await loadTemplates()
  const filtered = all.filter(t => t.id !== id || t.isBuiltIn)
  await browser.storage.local.set({ [KEY]: filtered })
}

export async function resetTemplate(id: string): Promise<void> {
  const original = DEFAULT_TEMPLATES.find(t => t.id === id)
  if (original) await saveTemplate(original)
}
