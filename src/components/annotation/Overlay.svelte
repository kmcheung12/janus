<script lang="ts">
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent } from '../../lib/event-capture/types'

  let {
    events,
    onClose,
  }: {
    events: CapturedEvent[]
    onClose: () => void
  } = $props()

  type Mode = 'picking' | 'sidebar' | 'panel'

  let mode = $state<Mode>('picking')
  let selectedSelector = $state<string | undefined>(undefined)
  let selectedEvent = $state<CapturedEvent | undefined>(undefined)

  function onElementPicked(selector: string) {
    selectedSelector = selector
    selectedEvent = undefined
    mode = 'panel'
  }

  function onEventSelected(event: CapturedEvent) {
    selectedEvent = event
    selectedSelector = undefined
    mode = 'panel'
  }

  function onBack() {
    mode = 'picking'
    selectedSelector = undefined
    selectedEvent = undefined
  }
</script>

<div class="janus-overlay">
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
      {selectedEvent}
      {events}
      pageUrl={window.location.href}
      onBack={onBack}
      onDone={onClose}
    />
  {/if}
</div>

<style>
  .janus-overlay {
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
