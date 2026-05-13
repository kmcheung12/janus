export interface Shortcut {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

export interface StoredShortcuts {
  record: Shortcut | null
  annotate: Shortcut | null
  templates: Shortcut | null
  settings: Shortcut | null
}

const STORAGE_KEY = 'janus_shortcuts'

const DEFAULTS: StoredShortcuts = {
  record: { key: 'KeyK', ctrl: false, alt: true, shift: true, meta: false },
  annotate: { key: 'KeyJ', ctrl: false, alt: true, shift: true, meta: false },
  templates: null,
  settings: null,
}

export async function loadShortcuts(): Promise<StoredShortcuts> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  return { ...DEFAULTS, ...result[STORAGE_KEY] }
}

export async function saveShortcuts(shortcuts: StoredShortcuts): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: $state.snapshot(shortcuts) })
}

function codeToDisplay(code: string): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

export function formatShortcut(s: Shortcut): string {
  const parts: string[] = []
  if (s.ctrl) parts.push('Ctrl')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  if (s.meta) parts.push('Meta')
  parts.push(codeToDisplay(s.key))
  return parts.join('+')
}

export function matchesShortcut(e: KeyboardEvent, s: Shortcut): boolean {
  return e.code === s.key &&
    e.ctrlKey === s.ctrl &&
    e.altKey === s.alt &&
    e.shiftKey === s.shift &&
    e.metaKey === s.meta
}

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight',
  'MetaLeft', 'MetaRight',
])

export function shortcutFromEvent(e: KeyboardEvent): Shortcut | null {
  if (MODIFIER_CODES.has(e.code)) return null
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null
  return {
    key: e.code,
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    meta: e.metaKey,
  }
}
