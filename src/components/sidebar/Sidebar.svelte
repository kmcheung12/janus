<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
  import { getEvents, subscribe, addEvent } from '../../lib/event-capture/store'

  let { onClose, onPickingRef, onSidebarRef, onIsPickingRef, onJourneyIdRef, initialMode, initialJourneyId = null }: {
    onClose: () => void
    onPickingRef?: (fn: () => void) => void
    onSidebarRef?: (fn: () => void) => void
    onIsPickingRef?: (fn: () => boolean) => void
    onJourneyIdRef?: (fn: (id: string | null) => void) => void
    initialMode?: 'picking' | 'sidebar'
    initialJourneyId?: string | null
  } = $props()

  let events = $state<CapturedEvent[]>(getEvents())
  let journeyId = $state<string | null>(initialJourneyId)

  onMount(() => {
    onPickingRef?.(() => { mode = 'picking' })
    onSidebarRef?.(() => { mode = 'sidebar' })
    onIsPickingRef?.(() => mode === 'picking')
    onJourneyIdRef?.((id) => { journeyId = id })
    return subscribe(updated => { events = updated })
  })

  async function handleFileUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file || !journeyId) return
    const data = await file.arrayBuffer()
    browser.runtime.sendMessage({
      type: 'JANUS_SEND_FILE',
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      data,
    }).catch(() => {})
    ;(e.target as HTMLInputElement).value = ''
  }

  // Type filter — ephemeral per session, does not persist
  let hiddenTypes = $state(new Set<EventType>())

  function onToggleType(type: EventType) {
    const next = new Set(hiddenTypes)
    if (next.has(type)) next.delete(type)
    else next.add(type)
    hiddenTypes = next
  }

  // Events passed to AnnotationPanel: type-filtered + formatEvents will skip excluded
  let promptEvents = $derived(events.filter(e => !hiddenTypes.has(e.type as EventType)))

  type Mode = 'picking' | 'sidebar' | 'panel'

  let mode = $state<Mode>(untrack(() => initialMode ?? 'picking'))
  let previousMode = $state<'picking' | 'sidebar'>('picking')
  let selectedEvent = $state<CapturedEvent | undefined>(undefined)

  function onPick(event: ElementPickEvent) {
    addEvent(event)
    selectedEvent = event
    previousMode = 'picking'
    mode = 'panel'
  }

  function onEventSelected(event: CapturedEvent) {
    selectedEvent = event
    previousMode = 'sidebar'
    mode = 'panel'
  }

  function onBack() {
    mode = previousMode
    selectedEvent = undefined
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    if (mode === 'picking' || mode === 'sidebar') onClose()
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if mode === 'picking'}
  <ElementPicker {onPick} />
{:else}
  <div class="janus-sidebar">
    <div class="janus-toolbar">
      <span class="janus-logo">Janus</span>
      {#if journeyId}
        <span class="janus-journey-id" title="Journey ID">{journeyId}</span>
      {/if}
      <label class="janus-file-btn" title="Attach file to journey">
        +
        <input type="file" style="display:none" onchange={handleFileUpload} />
      </label>
      <button onclick={() => mode = mode === 'sidebar' ? 'picking' : 'sidebar'}>
        {mode === 'sidebar' ? 'Element Picker' : 'Events'}
      </button>
      <button onclick={onClose}>✕</button>
    </div>

    {#if mode === 'sidebar'}
      <EventSidebar {events} {hiddenTypes} {onToggleType} onSelect={onEventSelected} />
    {:else if mode === 'panel' && selectedEvent}
      <AnnotationPanel
        {selectedEvent}
        events={promptEvents}
        pageUrl={window.location.href}
        onBack={onBack}
        onDone={onClose}
        onSelect={(e) => { selectedEvent = e }}
      />
    {/if}
  </div>
{/if}

<style>
  .janus-sidebar {
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

    position: fixed;
    top: 0;
    right: 0;
    width: 320px;
    height: 100vh;
    background: var(--janus-base);
    color: var(--janus-text);
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
    border-bottom: 1px solid var(--janus-surface0);
  }
  .janus-logo {
    font-weight: 700;
    color: var(--janus-mauve);
    flex: 1;
  }
  .janus-toolbar button {
    background: var(--janus-surface0);
    border: none;
    color: var(--janus-text);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .janus-journey-id {
    font-family: monospace;
    font-size: 11px;
    color: var(--janus-green);
    background: var(--janus-base);
    border: 1px solid var(--janus-surface0);
    border-radius: 3px;
    padding: 2px 5px;
    letter-spacing: 0.05em;
    cursor: default;
    user-select: all;
  }
  .janus-file-btn {
    background: var(--janus-surface0);
    border: none;
    color: var(--janus-text);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: inline-block;
  }
</style>
