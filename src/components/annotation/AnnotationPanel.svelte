<script lang="ts">
  import { onMount } from 'svelte'
  import { loadTemplates } from '../../lib/templates/storage'
  import { resolveSlots, renderTemplate } from '../../lib/templates/engine'
  import { copyToClipboard } from '../../lib/clipboard'
  import { AUTO_FILL_SLOTS } from '../../lib/templates/types'
  import type { Template } from '../../lib/templates/types'
  import type { CapturedEvent } from '../../lib/event-capture/types'

  let { selectedSelector, selectedSource, selectedEvent, events, pageUrl, onBack, onDone }: {
    selectedSelector?: string
    selectedSource?: 'page' | 'extension'
    selectedEvent?: CapturedEvent
    events: CapturedEvent[]
    pageUrl: string
    onBack: () => void
    onDone: () => void
  } = $props()

  let templates = $state<Template[]>([])
  let selected = $state<Template | null>(null)
  let userText = $state('')
  let extraInputs = $state<Record<string, string>>({})
  let copied = $state(false)
  let copyFailed = $state(false)
  let generatedPrompt = $state<string | null>(null)

  onMount(async () => {
    templates = await loadTemplates()
    selected = templates[0] ?? null
  })

  const autoFillKeys = new Set(AUTO_FILL_SLOTS.map(s => s.key))

  function userSlots(template: Template): string[] {
    const matches = template.body.match(/\{(\w+)\}/g) ?? []
    return [...new Set(
      matches
        .map(m => m.slice(1, -1))
        .filter(k => !autoFillKeys.has(k) && k !== 'user_text')
    )]
  }

  async function generate() {
    if (!selected) return

    const slots = resolveSlots({
      url: pageUrl,
      elementSelector: selectedSelector,
      events,
      selectedEvent,
      userText,
    })

    const allSlots = { ...slots, ...extraInputs }
    const prompt = renderTemplate(selected.body, allSlots)
    generatedPrompt = prompt

    const ok = await copyToClipboard(prompt)
    if (ok) {
      copied = true
      setTimeout(() => { copied = false; onDone() }, 1200)
    } else {
      copyFailed = true
    }
  }
</script>

<div class="panel">
  <button class="back" onclick={onBack}>← Back</button>

  <div class="section">
    <label>Selection</label>
    <div class="selection-info">
      {#if selectedSelector}
        <span class="chip">{selectedSelector}</span>
        {#if selectedSource}<span class="source-badge source-{selectedSource}">{selectedSource}</span>{/if}
      {:else if selectedEvent}
        <span class="chip">{selectedEvent.type}: {(selectedEvent as any).url ?? (selectedEvent as any).selector ?? ''}</span>
      {/if}
    </div>
  </div>

  <div class="section">
    <label>Tag</label>
    <div class="tags">
      {#each templates as t (t.id)}
        <button
          class="tag-btn"
          class:active={selected?.id === t.id}
          onclick={() => { selected = t; extraInputs = {} }}
        >{t.name}</button>
      {/each}
    </div>
  </div>

  {#if selected}
    <div class="section">
      <label>Note <span class="hint">(your judgment)</span></label>
      <textarea bind:value={userText} rows={3} placeholder="What's wrong or what should change?"></textarea>
    </div>

    {#each userSlots(selected) as key}
      <div class="section">
        <label>{key}</label>
        <input type="text" bind:value={extraInputs[key]} placeholder={key} />
      </div>
    {/each}

    <button class="generate-btn" onclick={generate}>
      {#if copied}
        Copied!
      {:else}
        Generate Prompt
      {/if}
    </button>

    {#if copyFailed && generatedPrompt}
      <div class="fallback">
        <label>Clipboard unavailable — copy manually:</label>
        <textarea readonly value={generatedPrompt} rows={8}></textarea>
      </div>
    {/if}
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; flex: 1; }
  .back { background: none; border: none; color: #89b4fa; cursor: pointer; font-size: 12px; text-align: left; padding: 0; }
  .section { display: flex; flex-direction: column; gap: 4px; }
  label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; }
  .hint { font-size: 10px; color: #45475a; text-transform: none; letter-spacing: 0; }
  .selection-info { font-size: 12px; }
  .chip { background: #313244; border-radius: 3px; padding: 2px 6px; font-family: monospace; }
  .source-badge { font-size: 9px; font-weight: 600; text-transform: uppercase; border-radius: 2px; padding: 1px 5px; vertical-align: middle; }
  .source-page { background: #313244; color: #6c7086; }
  .source-extension { background: #cba6f7; color: #1e1e2e; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-btn { background: #313244; border: 1px solid transparent; color: #cdd6f4; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .tag-btn.active { border-color: #cba6f7; color: #cba6f7; }
  textarea, input { background: #181825; border: 1px solid #313244; border-radius: 4px; color: #cdd6f4; padding: 6px 8px; font-size: 12px; font-family: inherit; resize: vertical; width: 100%; box-sizing: border-box; }
  .generate-btn { background: #cba6f7; color: #1e1e2e; border: none; border-radius: 4px; padding: 10px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .generate-btn:hover { background: #d6b9fa; }
  .fallback { display: flex; flex-direction: column; gap: 4px; }
</style>
