<script lang="ts">
  import SlotReference from './SlotReference.svelte'
  import type { Template } from '../../lib/prompts/types'
  import { AUTO_FILL_SLOTS } from '../../lib/prompts/types'

  let { template, onSave, onDelete, onReset }: {
    template: Template
    onSave: (t: Template) => void
    onDelete?: () => void
    onReset?: () => void
  } = $props()

  let name = $state('')
  let description = $state('')
  let body = $state('')
  let bodyEl = $state<HTMLTextAreaElement | undefined>(undefined)

  $effect(() => {
    name = template.name
    description = template.description
    body = template.body
  })

  const AUTO_KEYS = new Set([...AUTO_FILL_SLOTS.map(s => s.key), 'user_text'])

  let unknownSlots = $derived(
    [...(body.match(/\{(\w+)\}/g) ?? [])]
      .map(s => s.slice(1, -1))
      .filter(k => !AUTO_KEYS.has(k))
  )

  function save() {
    onSave({ ...template, name, description, body })
  }

  function insertSlot(slot: string) {
    if (!bodyEl) return
    const start = bodyEl.selectionStart
    const end = bodyEl.selectionEnd
    body = body.slice(0, start) + slot + body.slice(end)
    setTimeout(() => {
      if (!bodyEl) return
      bodyEl.selectionStart = bodyEl.selectionEnd = start + slot.length
      bodyEl.focus()
    }, 0)
  }
</script>

<div class="editor">
  <div class="field">
    <label for="tpl-name">Name</label>
    <input id="tpl-name" bind:value={name} placeholder="Template name" />
  </div>
  <div class="field">
    <label for="tpl-description">Description</label>
    <input id="tpl-description" bind:value={description} placeholder="One-line description" />
  </div>
  <div class="body-row">
    <div class="field body-field">
      <label for="tpl-body">Template body</label>
      {#if unknownSlots.length > 0}
        <div class="warn">
          Unknown slots (will prompt user for input): {unknownSlots.map(s => `{${s}}`).join(', ')}
        </div>
      {/if}
      <textarea id="tpl-body" bind:this={bodyEl} bind:value={body} rows={12}></textarea>
    </div>
    <div class="slot-ref-col">
      <SlotReference onInsert={insertSlot} />
    </div>
  </div>
  <div class="actions">
    <button class="save-btn" onclick={save}>Save</button>
    {#if template.isBuiltIn && onReset}
      <button class="reset-btn" onclick={onReset}>Reset to default</button>
    {/if}
    {#if !template.isBuiltIn && onDelete}
      <button class="delete-btn" onclick={onDelete}>Delete</button>
    {/if}
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  label { font-size: 11px; color: #6c7086; text-transform: uppercase; letter-spacing: 0.05em; }
  input, textarea { background: #181825; border: 1px solid #313244; border-radius: 4px; color: #cdd6f4; padding: 6px 8px; font-size: 12px; font-family: monospace; width: 100%; box-sizing: border-box; }
  textarea { resize: vertical; }
  .body-row { display: flex; gap: 16px; }
  .body-field { flex: 1; }
  .slot-ref-col { width: 220px; flex-shrink: 0; padding-top: 20px; }
  .warn { background: #45475a; border-left: 3px solid #fab387; color: #fab387; font-size: 11px; padding: 6px 8px; border-radius: 2px; }
  .actions { display: flex; gap: 8px; }
  .save-btn { background: #cba6f7; color: #1e1e2e; border: none; border-radius: 4px; padding: 8px 16px; font-weight: 700; cursor: pointer; }
  .reset-btn { background: #313244; color: #cdd6f4; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 12px; }
  .delete-btn { background: #f38ba8; color: #1e1e2e; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }
</style>
