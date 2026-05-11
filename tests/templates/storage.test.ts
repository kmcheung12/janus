import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadTemplates, saveTemplate, deleteTemplate, resetTemplate } from '../../src/lib/templates/storage'
import { DEFAULT_TEMPLATES } from '../../src/lib/templates/defaults'
import type { Template } from '../../src/lib/templates/types'

describe('template storage', () => {
  beforeEach(() => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ janus_templates: [] })
    vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined)
  })

  it('returns built-in templates when storage is empty', async () => {
    const templates = await loadTemplates()
    expect(templates.map(t => t.id)).toEqual(expect.arrayContaining(['bug', 'ux']))
  })

  it('applies stored edits to built-in templates', async () => {
    const edited = { ...DEFAULT_TEMPLATES[0], body: 'Custom body' }
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ janus_templates: [edited] })
    const templates = await loadTemplates()
    expect(templates.find(t => t.id === 'bug')?.body).toBe('Custom body')
  })

  it('includes user-defined templates after built-ins', async () => {
    const custom: Template = { id: 'custom', name: 'Custom', description: '', body: '', isBuiltIn: false, contextScope: 'both' }
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ janus_templates: [custom] })
    const templates = await loadTemplates()
    expect(templates[templates.length - 1].id).toBe('custom')
  })

  it('saveTemplate persists a template', async () => {
    const custom: Template = { id: 'custom', name: 'Custom', description: '', body: '', isBuiltIn: false, contextScope: 'both' }
    await saveTemplate(custom)
    expect(chrome.storage.local.set).toHaveBeenCalled()
  })

  it('deleteTemplate cannot remove built-in templates', async () => {
    await deleteTemplate('bug')
    const setArg = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as Record<string, Template[]>
    const saved = setArg['janus_templates']
    expect(saved.find(t => t.id === 'bug')).toBeDefined()
  })

  it('deleteTemplate removes user-defined templates', async () => {
    const custom: Template = { id: 'custom', name: 'Custom', description: '', body: '', isBuiltIn: false, contextScope: 'both' }
    vi.mocked(chrome.storage.local.get).mockResolvedValue({ janus_templates: [custom] })
    await deleteTemplate('custom')
    const setArg = vi.mocked(chrome.storage.local.set).mock.calls[0][0] as Record<string, Template[]>
    const saved = setArg['janus_templates']
    expect(saved.find(t => t.id === 'custom')).toBeUndefined()
  })
})
