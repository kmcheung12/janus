<script lang="ts">
  import { onMount } from 'svelte'
  import { loadShortcuts, saveShortcuts, matchesShortcut } from '../../lib/shortcuts.svelte'
  import type { StoredShortcuts, Shortcut } from '../../lib/shortcuts.svelte'
  import ShortcutButton from '../../components/popup/ShortcutButton.svelte'

  let shortcuts = $state<StoredShortcuts>({
    record: { key: 'KeyK', ctrl: false, alt: true, shift: true, meta: false },
    sidebar: { key: 'KeyJ', ctrl: false, alt: true, shift: true, meta: false },
    annotate: null,
    templates: null,
    settings: null,
  })
  let configuringFor = $state<keyof StoredShortcuts | null>(null)
  let isRecording = $state(false)

  let capturedShortcut: { code: string; mods: { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean } } | null = null
  const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

  onMount(async () => {
    shortcuts = await loadShortcuts()
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      try {
        const res = await browser.runtime.sendMessage({ type: 'JANUS_GET_RECORDING_STATE', tabId: tab.id })
        isRecording = res?.recording ?? false
      } catch (e) {
        console.error('Failed to get recording state:', e)
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
      } catch (e) {
        console.error('Failed to toggle recording:', e)
      }
    }
  }

  async function openSidebar() {
    if (configuringFor) return
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'JANUS_OPEN_SIDEBAR' })
      window.close()
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
    if (!configuringFor) {
      if (shortcuts.record && matchesShortcut(e, shortcuts.record)) {
        e.preventDefault()
        toggleRecording()
      }
      if (shortcuts.sidebar && matchesShortcut(e, shortcuts.sidebar)) {
        e.preventDefault()
        openSidebar()
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

    if (!MODIFIER_KEYS.has(e.key) && !capturedShortcut && (e.ctrlKey || e.altKey || e.metaKey)) {
      capturedShortcut = {
        code: e.code,
        mods: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey },
      }
    }
  }

  async function handleKeyUp(e: KeyboardEvent) {
    if (!configuringFor || !capturedShortcut) return
    // Commit when the captured key is released, OR when any modifier is released.
    // On macOS, keyup for keys pressed while Cmd is held may not fire, so releasing
    // a modifier is used as a fallback commit trigger.
    const isModifier = MODIFIER_KEYS.has(e.key)
    if (!isModifier && e.code !== capturedShortcut.code) return

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
  <ShortcutButton onclick={toggleRecording} action="record" {configuringFor} {shortcuts} onStartConfiguring={startConfiguring}>
    <span class="record-label">
      <span class="record-dot" class:recording={isRecording}></span>
      {isRecording ? 'Stop recording' : 'Start recording events'}
    </span>
  </ShortcutButton>
  <ShortcutButton onclick={openSidebar} action="sidebar" {configuringFor} {shortcuts} onStartConfiguring={startConfiguring}>
    Open sidebar
  </ShortcutButton>
  <ShortcutButton onclick={activate} action="annotate" {configuringFor} {shortcuts} onStartConfiguring={startConfiguring}>
    Pick Element
  </ShortcutButton>
  <ShortcutButton variant="secondary" onclick={openTemplates} action="templates" {configuringFor} {shortcuts} onStartConfiguring={startConfiguring}>
    Manage templates
  </ShortcutButton>
  <ShortcutButton variant="secondary" onclick={openSettings} action="settings" {configuringFor} {shortcuts} onStartConfiguring={startConfiguring}>
    Settings
  </ShortcutButton>
  {#if configuringFor}
    <p class="hint">Press a combo to set · <kbd>Del</kbd> to clear · <kbd>Esc</kbd> to cancel</p>
  {/if}
</div>

<style>
  :global(:root) {
    --janus-base: #1e1e2e;
    --janus-mantle: #181825;
    --janus-surface0: #313244;
    --janus-surface1: #45475a;
    --janus-surface1-hover: #3d3f55;
    --janus-overlay0: #585b70;
    --janus-subtext0: #6c7086;
    --janus-subtext1: #a6adc8;
    --janus-text: #cdd6f4;
    --janus-mauve: #cba6f7;
    --janus-mauve-hover: #d6b9fa;
    --janus-red: #f38ba8;
    --janus-peach: #fab387;
    --janus-green: #a6e3a1;
    --janus-blue: #89b4fa;
    --janus-sky: #89dceb;
  }
  .popup { width: 220px; padding: 16px; background: var(--janus-base); color: var(--janus-text); font-family: system-ui, sans-serif; display: flex; flex-direction: column; gap: 10px; }
  .header { display: flex; flex-direction: column; gap: 2px; }
  .logo { font-weight: 700; font-size: 16px; color: var(--janus-mauve); }
  .tagline { font-size: 11px; color: var(--janus-subtext0); }
  .hint { margin: 0; font-size: 10px; color: var(--janus-subtext0); text-align: center; }
  .hint kbd { cursor: default; font-size: 10px; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 2px 4px; font-family: monospace; white-space: nowrap; }
  .record-label { display: flex; align-items: center; gap: 8px; }
  .record-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--janus-red); border: 2px solid var(--janus-base); flex-shrink: 0; }
  .record-dot.recording { background: var(--janus-green); animation: flash 1s ease-in-out infinite; }
  @keyframes flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
