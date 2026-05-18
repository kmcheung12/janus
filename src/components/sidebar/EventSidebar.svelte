<script lang="ts">
  import type { CapturedEvent, ApiEvent, ClickEvent, KeyboardInputEvent, NavigationEvent, ConsoleEvent, ScrollEvent, DragEvent, SessionEvent, ElementPickEvent, EventType } from '../../lib/event-capture/types'
  import { formatEvents, parseBrowser } from '../../lib/prompts/engine'
  import { groupEvents } from '../../lib/event-grouping'
  import type { ApiDomainSubgroup } from '../../lib/event-grouping'
  import { updateEvent } from '../../lib/event-capture/store'
  import PromptBox from './PromptBox.svelte'

  let { events, hiddenTypes, onToggleType, onSelect }: {
    events: CapturedEvent[]
    hiddenTypes: Set<EventType>
    onToggleType: (type: EventType) => void
    onSelect: (e: CapturedEvent) => void
  } = $props()

  let allTypes = $derived([...new Set(events.map(e => e.type))] as EventType[])
  let visibleEvents = $derived(events.filter(e => !hiddenTypes.has(e.type as EventType)))
  let displayItems = $derived([...groupEvents(visibleEvents)].reverse())
  let interactionText = $derived(formatEvents(visibleEvents))

  let expandedGroups = $state(new Set<string>())
  let expandedSubgroups = $state(new Set<string>())

  function toggleGroupExpanded(id: string) {
    const next = new Set(expandedGroups)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedGroups = next
  }

  function toggleSubgroupExpanded(id: string) {
    const next = new Set(expandedSubgroups)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedSubgroups = next
  }

  function toggleEventExcluded(event: CapturedEvent) {
    updateEvent(event.id, { excluded: !event.excluded })
  }

  function toggleGroupExcluded(groupEvts: ApiEvent[]) {
    const allExcluded = groupEvts.every(e => e.excluded)
    groupEvts.forEach(e => updateEvent(e.id, { excluded: !allExcluded }))
  }

  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value
    return { update(v: boolean) { node.indeterminate = v } }
  }

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
        return `Session started on ${parseBrowser(s.browser)} ${s.viewport.width}×${s.viewport.height}`
      }
      case 'element_pick': {
        const p = e as ElementPickEvent
        return `Pick: ${p.selector}`
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
    if (e.type === 'console') return `console-${(e as ConsoleEvent).level}`
    return e.type
  }

  const TYPE_LABELS: Partial<Record<EventType, string>> = {
    click: 'click', navigation: 'nav', keyboard: 'kbd',
    api: 'api', scroll: 'scroll', console: 'console',
    drag: 'drag', element_pick: 'pick', session: 'session',
  }
</script>

<div class="sidebar-wrapper">
  {#if allTypes.length > 0}
    <div class="filter-bar">
      {#each allTypes as type}
        <button
          class="filter-btn"
          class:inactive={hiddenTypes.has(type)}
          onclick={() => onToggleType(type)}
        >{TYPE_LABELS[type] ?? type}</button>
      {/each}
    </div>
  {/if}

  <div class="events-list">
    {#if events.length === 0}
      <p class="empty">No interactions captured yet.</p>
    {:else if visibleEvents.length === 0}
      <p class="empty">All events hidden by filter.</p>
    {:else}
      {#each displayItems as item (item.kind === 'api-group' ? item.id : item.event.id)}
        {#if item.kind === 'api-group'}
          {#if item.subgroups.length === 1}
            {@const sub = item.subgroups[0]}
            {@const allExcluded = sub.events.every(e => e.excluded)}
            {@const someExcluded = sub.events.some(e => e.excluded)}
            {@const isExpanded = expandedGroups.has(item.id)}
            <div class="group-header" class:excluded={allExcluded} onclick={() => toggleGroupExpanded(item.id)} onkeydown={(e) => e.key === 'Enter' && toggleGroupExpanded(item.id)} role="button" tabindex="0">
              <input
                type="checkbox"
                class="event-toggle"
                checked={!allExcluded}
                use:indeterminate={someExcluded && !allExcluded}
                onclick={(e) => e.stopPropagation()}
                onchange={() => toggleGroupExcluded(sub.events)}
              />
              <span class="expand-btn">{isExpanded ? '▼' : '▶'}</span>
              <span class="badge badge-ok">api ×{sub.events.length}</span>
              <span class="group-domain">{sub.domain}</span>
            </div>
            {#if isExpanded}
              {#each [...sub.events].reverse() as event (event.id)}
                <button class="entry entry-indented" class:excluded={event.excluded} onclick={() => onSelect(event)}>
                  <input
                    type="checkbox"
                    class="event-toggle"
                    checked={!event.excluded}
                    onclick={(e) => e.stopPropagation()}
                    onchange={() => toggleEventExcluded(event)}
                  />
                  <span class="badge badge-{badge(event)}">{event.type}</span>
                  <span class="entry-label">{label(event)}</span>
                </button>
              {/each}
            {/if}
          {:else}
            {@const allEvents = item.subgroups.flatMap(s => s.events)}
            {@const totalCount = allEvents.length}
            {@const allExcluded = allEvents.every(e => e.excluded)}
            {@const someExcluded = allEvents.some(e => e.excluded)}
            {@const isExpanded = expandedGroups.has(item.id)}
            <div class="group-header" class:excluded={allExcluded} onclick={() => toggleGroupExpanded(item.id)} onkeydown={(e) => e.key === 'Enter' && toggleGroupExpanded(item.id)} role="button" tabindex="0">
              <input
                type="checkbox"
                class="event-toggle"
                checked={!allExcluded}
                use:indeterminate={someExcluded && !allExcluded}
                onclick={(e) => e.stopPropagation()}
                onchange={() => toggleGroupExcluded(allEvents)}
              />
              <span class="expand-btn">{isExpanded ? '▼' : '▶'}</span>
              <span class="badge badge-ok">api ×{totalCount}</span>
            </div>
            {#if isExpanded}
              {#each item.subgroups as subgroup (subgroup.id)}
                {#if subgroup.events.length === 1}
                  {@const event = subgroup.events[0]}
                  <button class="entry entry-indented" class:excluded={event.excluded} onclick={() => onSelect(event)}>
                    <input
                      type="checkbox"
                      class="event-toggle"
                      checked={!event.excluded}
                      onclick={(e) => e.stopPropagation()}
                      onchange={() => toggleEventExcluded(event)}
                    />
                    <span class="badge badge-{badge(event)}">{event.type}</span>
                    <span class="entry-label">{label(event)}</span>
                  </button>
                {:else}
                  {@const subAllExcluded = subgroup.events.every(e => e.excluded)}
                  {@const subSomeExcluded = subgroup.events.some(e => e.excluded)}
                  {@const isSubExpanded = expandedSubgroups.has(subgroup.id)}
                  <div class="subgroup-header" class:excluded={subAllExcluded} onclick={() => toggleSubgroupExpanded(subgroup.id)} onkeydown={(e) => e.key === 'Enter' && toggleSubgroupExpanded(subgroup.id)} role="button" tabindex="0">
                    <input
                      type="checkbox"
                      class="event-toggle"
                      checked={!subAllExcluded}
                      use:indeterminate={subSomeExcluded && !subAllExcluded}
                      onclick={(e) => e.stopPropagation()}
                      onchange={() => toggleGroupExcluded(subgroup.events)}
                    />
                    <span class="expand-btn">{isSubExpanded ? '▼' : '▶'}</span>
                    <span class="group-domain">{subgroup.domain}</span>
                    <span class="subgroup-count">×{subgroup.events.length}</span>
                  </div>
                  {#if isSubExpanded}
                    {#each [...subgroup.events].reverse() as event (event.id)}
                      <button class="entry entry-double-indented" class:excluded={event.excluded} onclick={() => onSelect(event)}>
                        <input
                          type="checkbox"
                          class="event-toggle"
                          checked={!event.excluded}
                          onclick={(e) => e.stopPropagation()}
                          onchange={() => toggleEventExcluded(event)}
                        />
                        <span class="badge badge-{badge(event)}">{event.type}</span>
                        <span class="entry-label">{label(event)}</span>
                      </button>
                    {/each}
                  {/if}
                {/if}
              {/each}
            {/if}
          {/if}
        {:else}
          <button class="entry" class:excluded={item.event.excluded} onclick={() => onSelect(item.event)}>
            <input
              type="checkbox"
              class="event-toggle"
              checked={!item.event.excluded}
              onclick={(e) => e.stopPropagation()}
              onchange={() => toggleEventExcluded(item.event)}
            />
            <span class="badge badge-{badge(item.event)}">{item.event.type}</span>
            <span class="entry-label">{label(item.event)}</span>
          </button>
        {/if}
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

  .filter-bar {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 6px 8px; border-bottom: 1px solid #313244; flex-shrink: 0;
  }
  .filter-btn {
    padding: 2px 7px; border-radius: 3px; font-size: 10px; font-weight: 600;
    text-transform: uppercase; border: none; cursor: pointer;
    background: #313244; color: #cdd6f4; transition: opacity 0.1s;
  }
  .filter-btn.inactive { opacity: 0.35; text-decoration: line-through; }

  .events-list { overflow-y: auto; flex: 1; padding: 4px 0; }
  .prompt-area { padding: 8px 12px; border-top: 1px solid #313244; flex-shrink: 0; }
  .label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 4px; }
  .empty { padding: 12px; color: #6c7086; font-size: 12px; }

  .entry {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 12px;
    background: none; border: none; color: #cdd6f4;
    cursor: pointer; text-align: left; font-size: 12px;
  }
  .entry:hover { background: #313244; }
  .entry.excluded { opacity: 0.4; }
  .entry-indented { padding-left: 28px; }
  .entry-double-indented { padding-left: 44px; }

  .group-header {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; font-size: 12px; color: #cdd6f4;
    border-bottom: 1px solid #2a2a3e; cursor: pointer;
  }
  .group-header.excluded { opacity: 0.4; }

  .subgroup-header {
    display: flex; align-items: center; gap: 8px;
    padding: 5px 12px 5px 28px; font-size: 12px; color: #cdd6f4;
    border-bottom: 1px solid #252535; cursor: pointer;
  }
  .subgroup-header.excluded { opacity: 0.4; }
  .group-domain { color: #a6adc8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .subgroup-count { color: #6c7086; font-size: 11px; flex-shrink: 0; }

  .expand-btn {
    background: none; border: none; color: #6c7086;
    font-size: 10px; cursor: pointer; padding: 0; flex-shrink: 0;
  }

  .event-toggle {
    flex-shrink: 0; cursor: pointer; accent-color: #cba6f7;
    width: 13px; height: 13px;
  }

  .badge {
    padding: 2px 5px; border-radius: 3px; font-size: 10px;
    font-weight: 600; flex-shrink: 0; text-transform: uppercase;
  }
  .badge-click, .badge-keyboard, .badge-navigation, .badge-scroll, .badge-drag, .badge-session { background: #313244; color: #cdd6f4; }
  .badge-element_pick { background: #cba6f7; color: #1e1e2e; }
  .badge-console-error { background: #f38ba8; color: #1e1e2e; }
  .badge-console-warn { background: #fab387; color: #1e1e2e; }
  .badge-ok { background: #a6e3a1; color: #1e1e2e; }
  .badge-warn { background: #fab387; color: #1e1e2e; }
  .badge-error { background: #f38ba8; color: #1e1e2e; }
  .entry-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
</style>
