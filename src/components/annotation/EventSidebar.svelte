<script lang="ts">
  import type { CapturedEvent, ClickEvent, KeyboardInputEvent, ApiEvent, NavigationEvent } from '../../lib/event-capture/types'

  let { events, onSelect }: { events: CapturedEvent[], onSelect: (e: CapturedEvent) => void } = $props()

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
    }
  }

  function badge(e: CapturedEvent): string {
    if (e.type === 'api') {
      const a = e as ApiEvent
      if (a.status === null || a.status >= 500) return 'error'
      if (a.status >= 400) return 'warn'
      return 'ok'
    }
    return e.type
  }
</script>

<div class="sidebar">
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

<style>
  .sidebar { overflow-y: auto; flex: 1; padding: 4px 0; }
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
  .badge-click, .badge-keyboard, .badge-navigation { background: #313244; color: #cdd6f4; }
  .badge-ok { background: #a6e3a1; color: #1e1e2e; }
  .badge-warn { background: #fab387; color: #1e1e2e; }
  .badge-error { background: #f38ba8; color: #1e1e2e; }
  .entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
