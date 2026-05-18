<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { loadTemplates } from '../../lib/prompts/storage'
  import { resolveSlots, renderTemplate, expandFields, fieldsOf, defaultNoteTemplate } from '../../lib/prompts/engine'
  import { AUTO_FILL_SLOTS } from '../../lib/prompts/types'
  import { updateEvent } from '../../lib/event-capture/store'
  import PromptBox from './PromptBox.svelte'
  import type { Template } from '../../lib/prompts/types'
  import type { CapturedEvent } from '../../lib/event-capture/types'

  let { selectedEvent, events, pageUrl, onBack, onDone }: {
    selectedEvent: CapturedEvent
    events: CapturedEvent[]
    pageUrl: string
    onBack: () => void
    onDone: () => void
  } = $props()

  let templates = $state<Template[]>([])
  let selected = $state<Template | null>(null)
  let extraInputs = $state<Record<string, string>>({})

  onMount(async () => {
    templates = await loadTemplates()
    selected = templates[0] ?? null
  })

  // Seed note from persisted value or default template
  let noteText = $state(selectedEvent.note ?? defaultNoteTemplate(selectedEvent))

  $effect(() => {
    noteText = selectedEvent.note ?? defaultNoteTemplate(selectedEvent)
  })

  function handleNoteInput(e: Event) {
    noteText = (e.target as HTMLTextAreaElement).value
    updateEvent(selectedEvent.id, { note: noteText })
  }

  const autoFillKeys = new Set(AUTO_FILL_SLOTS.map(s => s.key))

  function userSlots(template: Template): string[] {
    const matches = template.body.match(/\{(\w+)\}/g) ?? []
    return [...new Set(
      matches
        .map(m => m.slice(1, -1))
        .filter(k => !autoFillKeys.has(k) && k !== 'user_text')
    )]
  }

  let prompt = $derived.by(() => {
    if (!selected) return ''
    const expandedNote = expandFields(noteText, fieldsOf(selectedEvent))
    const slots = resolveSlots({
      url: pageUrl,
      events,
      selectedEvent,
      userText: expandedNote,
    })
    return renderTemplate(selected.body, { ...slots, ...extraInputs })
  })

  // Field suggestion state
  let noteRef = $state<HTMLTextAreaElement | null>(null)
  let showSuggestions = $state(false)
  let suggestions = $derived(Object.keys(fieldsOf(selectedEvent)))

  function handleNoteKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { showSuggestions = false }
  }

  async function insertSuggestion(field: string) {
    if (!noteRef) return
    const pos = noteRef.selectionStart ?? noteText.length
    // Replace the '{' that triggered the dropdown with '{fieldname}'
    noteText = noteText.slice(0, pos - 1) + `{${field}}` + noteText.slice(pos)
    updateEvent(selectedEvent.id, { note: noteText })
    showSuggestions = false
    await tick()
    const newPos = pos - 1 + field.length + 2
    noteRef.selectionStart = newPos
    noteRef.selectionEnd = newPos
    noteRef.focus()
  }

  function checkForOpenBrace(e: Event) {
    handleNoteInput(e)
    const ta = e.target as HTMLTextAreaElement
    const pos = ta.selectionStart ?? 0
    showSuggestions = pos > 0 && noteText[pos - 1] === '{'
  }
</script>

<div class="panel">
  <button class="back" onclick={onBack}>← Back</button>

  <div class="section">
    <p class="label">Selection</p>
    <div class="selection-info">
      <span class="chip">{selectedEvent.type}: {(selectedEvent as any).url ?? (selectedEvent as any).selector ?? (selectedEvent as any).text ?? ''}</span>
    </div>
  </div>

  <div class="section">
    <p class="label">Tag</p>
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
    <div class="section note-section">
      <label for="panel-note">Note <span class="hint">(your judgment)</span></label>
      <div class="note-wrapper">
        <textarea
          id="panel-note"
          bind:this={noteRef}
          value={noteText}
          oninput={checkForOpenBrace}
          onkeydown={handleNoteKeydown}
          onblur={() => showSuggestions = false}
          rows={3}
          placeholder="Describe what this event means…"
        ></textarea>
        {#if showSuggestions && suggestions.length > 0}
          <ul class="suggestions">
            {#each suggestions as field}
              <li>
                <button
                  class="suggestion-item"
                  onmousedown={(e) => { e.preventDefault(); insertSuggestion(field) }}
                >{field}</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>

    {#each userSlots(selected) as key}
      <div class="section">
        <label for="slot-{key}">{key}</label>
        <input id="slot-{key}" type="text" bind:value={extraInputs[key]} placeholder={key} />
      </div>
    {/each}

    <div class="section prompt-section">
      <p class="label">Prompt</p>
      <PromptBox value={prompt} onCopy={onDone} rows={8} />
    </div>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: 12px; padding: 12px; overflow-y: auto; flex: 1; }
  .back { background: none; border: none; color: #89b4fa; cursor: pointer; font-size: 12px; text-align: left; padding: 0; }
  .section { display: flex; flex-direction: column; gap: 4px; }
  label, .label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .hint { font-size: 10px; color: #45475a; text-transform: none; letter-spacing: 0; }
  .selection-info { font-size: 12px; }
  .chip { background: #313244; border-radius: 3px; padding: 2px 6px; font-family: monospace; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag-btn { background: #313244; border: 1px solid transparent; color: #cdd6f4; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
  .tag-btn.active { border-color: #cba6f7; color: #cba6f7; }
  textarea, input { background: #181825; border: 1px solid #313244; border-radius: 4px; color: #cdd6f4; padding: 6px 8px; font-size: 12px; font-family: inherit; resize: vertical; width: 100%; box-sizing: border-box; }
  .note-section { position: relative; }
  .note-wrapper { position: relative; }
  .suggestions {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: #1e1e2e;
    border: 1px solid #45475a;
    border-radius: 4px;
    list-style: none;
    margin: 2px 0 0;
    padding: 4px 0;
    max-height: 160px;
    overflow-y: auto;
    z-index: 10;
  }
  .suggestion-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: #cdd6f4;
    padding: 4px 10px;
    font-size: 12px;
    font-family: monospace;
    cursor: pointer;
  }
  .suggestion-item:hover { background: #313244; }
</style>
