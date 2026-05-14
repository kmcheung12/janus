<script lang="ts">
  import type { CapturedEvent, ClickEvent, KeyboardInputEvent, ApiEvent, NavigationEvent, ConsoleEvent, ScrollEvent, DragEvent, SessionEvent } from '../../lib/event-capture/types'
  import { formatEvents } from '../../lib/prompts/engine'
  import PromptBox from './PromptBox.svelte'

  let { events, onSelect }: { events: CapturedEvent[], onSelect: (e: CapturedEvent) => void } = $props()

  let interactionText = $derived(formatEvents(events))

  function label(e: CapturedEvent): string {
    switch (e.type) {
      case 'navigation': {
        const n = e as NavigationEvent
        return `→ ${n.title || n.url}`
      }
      case 'click': {
        const c = e as ClickEvent
        return `Click: ${c.label || c.selector}${c.count > 1 ? ` ×${c.count}` : ''}`
      }
      case 'keyboard': {
        const k = e as KeyboardInputEvent
        return `Input: ${k.selector}${k.count > 1 ? ` ×${k.count}` : ''}`
      }
      case 'api': {
        const a = e as ApiEvent
        return `${a.method} ${a.url} → ${a.status ?? '…'}`
      }
      case 'console': {
        const c = e as ConsoleEvent
        return `console.${c.level}: ${c.message}`
      }
      case 'scroll': {
        const s = e as ScrollEvent
        return `Scroll ${s.direction} on ${s.selector === 'window' ? 'page' : s.selector}${s.count > 1 ? ` ×${s.count}` : ''}`
      }
      case 'drag': {
        const d = e as DragEvent
        return `Drag ${d.sourceSelector}${d.targetSelector ? ` → ${d.targetSelector}` : ''}`
      }
      case 'session': {
        const s = e as SessionEvent
        return `Session started ${s.viewport.width}×${s.viewport.height}`
      }
    }
  }

  function badge(e: CapturedEvent): string {
    if (e.type === 'api') {
      const a = e as ApiEvent
      if (a.status === null || a.status >= 500) return 'error'
      if (a.status >= 400) return 'warn'
      return 'ok'
    }
    if (e.type === 'console') {
      return `console-${(e as ConsoleEvent).level}`
    }
    return e.type
  }
</script>

<div class="sidebar-wrapper">
  <div class="events-list">
    {#if events.length === 0}
      <p class="empty">No interactions captured yet.</p>
    {:else}
      {#each [...events].reverse() as event (event.id)}
        <button class="entry" onclick={() => onSelect(event)}>
          <span class="badge badge-{badge(event)}">{event.type}</span>
          <span class="entry-label">{label(event)}</span>
        </button>
      {/each}
    {/if}
  </div>

  {#if events.length > 0}
    <div class="prompt-area">
      <p class="label">Interactions</p>
      <PromptBox value={interactionText} rows={5} />
    </div>
  {/if}
</div>

<style>
  .sidebar-wrapper { display: flex; flex-direction: column; flex: 1; overflow: hidden; }
  .events-list { overflow-y: auto; flex: 1; padding: 4px 0; }
  .prompt-area { padding: 8px 12px; border-top: 1px solid #313244; }
  .label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; }
  .empty { padding: 12px; color: #6c7086; font-size: 12px; }
  .entry {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 8px 12px;
    background: none; border: none; color: #cdd6f4;
    cursor: pointer; text-align: left; font-size: 12px;
  }
  .entry:hover { background: #313244; }
  .badge {
    padding: 2px 5px; border-radius: 3px; font-size: 10px;
    font-weight: 600; flex-shrink: 0; text-transform: uppercase;
  }
  .badge-click, .badge-keyboard, .badge-navigation, .badge-scroll, .badge-drag, .badge-session { background: #313244; color: #cdd6f4; }
  .badge-console-error { background: #f38ba8; color: #1e1e2e; }
  .badge-console-warn { background: #fab387; color: #1e1e2e; }
  .badge-ok { background: #a6e3a1; color: #1e1e2e; }
  .badge-warn { background: #fab387; color: #1e1e2e; }
  .badge-error { background: #f38ba8; color: #1e1e2e; }
  .entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
