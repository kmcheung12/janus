<script lang="ts">
  import { onMount } from 'svelte'
  import { loadShortcuts, saveShortcuts, formatShortcut, matchesShortcut } from '../../lib/shortcuts'
  import type { StoredShortcuts, Shortcut } from '../../lib/shortcuts'

  let shortcuts = $state<StoredShortcuts>({
    record: { key: 'KeyK', ctrl: false, alt: true, shift: true, meta: false },
    annotate: { key: 'KeyJ', ctrl: false, alt: true, shift: true, meta: false },
    templates: null,
    settings: null,
  })
  let configuringFor = $state<keyof StoredShortcuts | null>(null)
  let isRecording = $state(false)

  // Modifier tracking for shortcut configuration (keydown tracks, keyup commits)
  let modsDown = $state({ ctrl: false, alt: false, shift: false, meta: false })
  let capturedShortcut: { code: string; mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } } | null = null
  const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

  onMount(async () => {
    shortcuts = await loadShortcuts()
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      try {
        const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE', tabId: tab.id })
        isRecording = res?.recording ?? false
      } catch {
        // background not available
      }
    }
  })

  async function toggleRecording() {
    if (configuringFor) return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      try {
        const res = await browser.runtime.sendMessage({ type: 'JANUS_TOGGLE_RECORDING', tabId: tab.id })
        isRecording = res?.recording ?? false
      } catch {
        // background not available
      }
    }
  }

  async function activate() {
    if (configuringFor) return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'JANUS_ACTIVATE' })
      window.close()
    }
  }

  function openTemplates() {
    if (configuringFor) return
    browser.tabs.create({ url: browser.runtime.getURL('/prompt-manager.html') })
  }

  function openSettings() {
    if (configuringFor) return
    browser.tabs.create({ url: browser.runtime.getURL('/settings.html') })
  }

  function startConfiguring(e: Event, action: keyof StoredShortcuts) {
    e.stopPropagation()
    configuringFor = action
    capturedShortcut = null
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Control') modsDown.ctrl = true
    if (e.key === 'Alt') modsDown.alt = true
    if (e.key === 'Shift') modsDown.shift = true
    if (e.key === 'Meta') modsDown.meta = true

    if (!configuringFor) {
      if (shortcuts.record && matchesShortcut(e, shortcuts.record)) {
        e.preventDefault()
        toggleRecording()
      }
      return
    }

    e.preventDefault()

    if (e.key === 'Escape') {
      configuringFor = null
      capturedShortcut = null
      return
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      shortcuts = { ...shortcuts, [configuringFor]: null }
      saveShortcuts(shortcuts)
      configuringFor = null
      capturedShortcut = null
      return
    }

    if (!MODIFIER_KEYS.has(e.key) && !capturedShortcut && (modsDown.ctrl || modsDown.alt || modsDown.meta)) {
      capturedShortcut = { code: e.code, mods: { ...modsDown } }
    }
  }

  async function handleKeyUp(e: KeyboardEvent) {
    if (e.key === 'Control') modsDown.ctrl = false
    if (e.key === 'Alt') modsDown.alt = false
    if (e.key === 'Shift') modsDown.shift = false
    if (e.key === 'Meta') modsDown.meta = false

    if (!configuringFor || !capturedShortcut) return
    if (e.code !== capturedShortcut.code) return

    const { mods } = capturedShortcut
    if (mods.ctrl || mods.alt || mods.meta) {
      const shortcut: Shortcut = {
        key: capturedShortcut.code,
        ctrl: mods.ctrl,
        alt: mods.alt,
        shift: mods.shift,
        meta: mods.meta,
      }
      shortcuts = { ...shortcuts, [configuringFor]: shortcut }
      await saveShortcuts(shortcuts)
    }

    configuringFor = null
    capturedShortcut = null
  }
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div class="popup">
  <div class="header">
    <span class="logo">Janus</span>
    <span class="tagline">Annotate. Prompt. Iterate.</span>
  </div>
  <button class="primary record-btn" onclick={toggleRecording}>
    <span class="record-label">
      <span class="record-dot" class:recording={isRecording}></span>
      {isRecording ? 'Stop recording' : 'Start recording events'}
    </span>
    <kbd
      class:configuring={configuringFor === 'record'}
      onclick={(e) => startConfiguring(e, 'record')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startConfiguring(e, 'record') }}
      role="button"
      tabindex="0"
    >{configuringFor === 'record' ? '…' : shortcuts.record ? formatShortcut(shortcuts.record) : '+'}</kbd>
  </button>
  <button class="primary" onclick={activate}>
    Annotate this page
    <kbd
      class:configuring={configuringFor === 'annotate'}
      onclick={(e) => startConfiguring(e, 'annotate')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startConfiguring(e, 'annotate') }}
      role="button"
      tabindex="0"
    >{configuringFor === 'annotate' ? '…' : shortcuts.annotate ? formatShortcut(shortcuts.annotate) : '+'}</kbd>
  </button>
  <button class="secondary" onclick={openTemplates}>
    Manage templates
    <kbd
      class:configuring={configuringFor === 'templates'}
      onclick={(e) => startConfiguring(e, 'templates')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startConfiguring(e, 'templates') }}
      role="button"
      tabindex="0"
    >{configuringFor === 'templates' ? '…' : shortcuts.templates ? formatShortcut(shortcuts.templates) : '+'}</kbd>
  </button>
  <button class="secondary" onclick={openSettings}>
    Settings
    <kbd
      class:configuring={configuringFor === 'settings'}
      onclick={(e) => startConfiguring(e, 'settings')}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') startConfiguring(e, 'settings') }}
      role="button"
      tabindex="0"
    >{configuringFor === 'settings' ? '…' : shortcuts.settings ? formatShortcut(shortcuts.settings) : '+'}</kbd>
  </button>
  {#if configuringFor}
    <p class="hint">Press a combo to set · <kbd>Del</kbd> to clear · <kbd>Esc</kbd> to cancel</p>
  {/if}
</div>

<style>
  .popup { width: 220px; padding: 16px; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 10px; }
  .header { display: flex; flex-direction: column; gap: 2px; }
  .logo { font-weight: 700; font-size: 16px; color: #cba6f7; }
  .tagline { font-size: 11px; color: #6c7086; }
  .primary { background: #cba6f7; color: #1e1e2e; border: none; border-radius: 6px; padding: 10px; font-weight: 700; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
  .primary:hover { background: #d6b9fa; }
  .secondary { background: #313244; color: #cdd6f4; border: none; border-radius: 6px; padding: 8px 10px; cursor: pointer; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
  .secondary:hover { background: #45475a; }
  kbd { font-size: 10px; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 2px 4px; font-family: monospace; cursor: pointer; white-space: nowrap; }
  kbd:hover { background: rgba(0,0,0,0.35); }
  kbd.configuring { background: #cba6f7; color: #1e1e2e; animation: pulse 1s ease-in-out infinite; }
  .hint { margin: 0; font-size: 10px; color: #6c7086; text-align: center; }
  .hint kbd { cursor: default; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  .record-label { display: flex; align-items: center; gap: 8px; }
  .record-dot { width: 8px; height: 8px; border-radius: 50%; background: #f38ba8; border: 2px solid #1e1e2e; flex-shrink: 0; }
  .record-dot.recording { background: #a6e3a1; animation: flash 1s ease-in-out infinite; }
  @keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
