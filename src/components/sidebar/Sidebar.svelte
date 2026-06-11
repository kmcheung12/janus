<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import ElementPicker from './ElementPicker.svelte'
  import EventSidebar from './EventSidebar.svelte'
  import AnnotationPanel from './AnnotationPanel.svelte'
  import type { CapturedEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
  import { getEvents, subscribe, addEvent } from '../../lib/event-capture/store'

  let { onClose, onPickingRef, onSidebarRef, onIsPickingRef, onJourneyIdRef, initialMode }: {
    onClose: () => void
    onPickingRef?: (fn: () => void) => void
    onSidebarRef?: (fn: () => void) => void
    onIsPickingRef?: (fn: () => boolean) => void
    onJourneyIdRef?: (fn: (id: string | null) => void) => void
    initialMode?: 'picking' | 'sidebar'
  } = $props()

  let events = $state<CapturedEvent[]>(getEvents())
  let journeyId = $state<string | null>(null)

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
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const data = btoa(binary)
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
  .janus-journey-id {
    font-family: monospace;
    font-size: 11px;
    color: #a6e3a1;
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 3px;
    padding: 2px 5px;
    letter-spacing: 0.05em;
    cursor: default;
    user-select: all;
  }
  .janus-file-btn {
    background: #313244;
    border: none;
    color: #cdd6f4;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: inline-block;
  }
</style>
