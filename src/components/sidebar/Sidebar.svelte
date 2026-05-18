<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent } from '../../lib/event-capture/types'
  import { getEvents, subscribe } from '../../lib/event-capture/store'

  let { onClose, onPickingRef, onSidebarRef, initialMode }: {
    onClose: () => void
    onPickingRef?: (fn: () => void) => void
    onSidebarRef?: (fn: () => void) => void
    initialMode?: 'picking' | 'sidebar'
  } = $props()

  let events = $state<CapturedEvent[]>(getEvents())

  onMount(() => {
    onPickingRef?.(() => { mode = 'picking' })
    onSidebarRef?.(() => { mode = 'sidebar' })
    return subscribe(updated => { events = updated })
  })

  type Mode = 'picking' | 'sidebar' | 'panel'

  let mode = $state<Mode>(untrack(() => initialMode ?? 'picking'))
  let previousMode = $state<'picking' | 'sidebar'>('picking')
  let selectedSelector = $state<string | undefined>(undefined)
  let selectedSource = $state<'page' | 'extension' | undefined>(undefined)
  let selectedEvent = $state<CapturedEvent | undefined>(undefined)

  function onElementPicked(selector: string, src: 'page' | 'extension') {
    selectedSelector = selector
    selectedSource = src
    selectedEvent = undefined
    previousMode = 'picking'
    mode = 'panel'
  }

  function onEventSelected(event: CapturedEvent) {
    selectedEvent = event
    selectedSelector = undefined
    selectedSource = 'page'
    previousMode = 'sidebar'
    mode = 'panel'
  }

  function onBack() {
    mode = previousMode
    selectedSelector = undefined
    selectedSource = undefined
    selectedEvent = undefined
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (mode === 'picking') mode = 'sidebar'
    else if (mode === 'sidebar') onClose()
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="janus-sidebar">
  <div class="janus-toolbar">
    <span class="janus-logo">Janus</span>
    <button onclick={() => mode = mode === 'sidebar' ? 'picking' : 'sidebar'}>
      {mode === 'sidebar' ? 'Element Picker' : 'Events'}
    </button>
    <button onclick={onClose}>✕</button>
  </div>

  {#if mode === 'picking'}
    <ElementPicker onSelect={onElementPicked} />
    <div class="janus-hint">Click any element to annotate it</div>
  {:else if mode === 'sidebar'}
    <EventSidebar {events} onSelect={onEventSelected} />
  {:else if mode === 'panel'}
    <AnnotationPanel
      {selectedSelector}
      {selectedSource}
      {selectedEvent}
      {events}
      pageUrl={window.location.href}
      onBack={onBack}
      onDone={onClose}
    />
  {/if}
</div>

<style>
  .janus-sidebar {
    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    height: 100vh;
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    box-shadow: -4px 0 24px rgba(0,0,0,0.4);
  }
  .janus-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid #313244;
  }
  .janus-logo {
    font-weight: 700;
    color: #cba6f7;
    flex: 1;
  }
  .janus-toolbar button {
    background: #313244;
    border: none;
    color: #cdd6f4;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .janus-hint {
    padding: 12px;
    color: #6c7086;
    font-size: 12px;
  }
</style>
