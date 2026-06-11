<script lang="ts">
  import { onMount } from 'svelte'
  import TemplateEditor from '../../components/prompt-editor/TemplateEditor.svelte'
  import { loadTemplates, saveTemplate, deleteTemplate, resetTemplate } from '../../lib/prompts/storage'
  import type { Template } from '../../lib/prompts/types'
  import { uuid } from '../../lib/uuid'

  let templates = $state<Template[]>([])
  let selected = $state<Template | null>(null)

  onMount(async () => {
    templates = await loadTemplates()
    selected = templates[0] ?? null
  })

  async function handleSave(t: Template) {
    await saveTemplate(t)
    templates = await loadTemplates()
    selected = templates.find(x => x.id === t.id) ?? null
  }

  async function handleDelete(id: string) {
    await deleteTemplate(id)
    templates = await loadTemplates()
    selected = templates[0] ?? null
  }

  async function handleReset(id: string) {
    await resetTemplate(id)
    templates = await loadTemplates()
    selected = templates.find(x => x.id === id) ?? null
  }

  function newTemplate() {
    const t: Template = {
      id: uuid(),
      name: 'New Template',
      description: '',
      body: 'Describe the change:\n\n{user_text}\n\nCurrent page: {url}',
      isBuiltIn: false,
      contextScope: 'both',
    }
    selected = t
  }
</script>

<div class="page">
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="logo">Janus</span>
      <button onclick={newTemplate}>+ New</button>
    </div>
    {#each templates as t (t.id)}
      <button
        class="template-item"
        class:active={selected?.id === t.id}
        onclick={() => selected = t}
      >
        {t.name}
        {#if t.isBuiltIn}<span class="built-in">built-in</span>{/if}
      </button>
    {/each}
  </div>

  <div class="main">
    {#if selected}
      {#key selected.id}
        <TemplateEditor
          template={selected}
          onSave={handleSave}
          onDelete={!selected.isBuiltIn ? () => handleDelete(selected!.id) : undefined}
          onReset={selected.isBuiltIn ? () => handleReset(selected!.id) : undefined}
        />
      {/key}
    {:else}
      <p class="empty">Select a template or create a new one.</p>
    {/if}
  </div>
</div>

<style>
  :global(:root) {
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
  }
  :global(body) { margin: 0; background: var(--janus-base); color: var(--janus-text); font-family: system-ui, sans-serif; }
  .page { display: flex; height: 100vh; }
  .sidebar { width: 200px; border-right: 1px solid var(--janus-surface0); display: flex; flex-direction: column; }
  .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--janus-surface0); }
  .logo { font-weight: 700; color: var(--janus-mauve); }
  .sidebar-header button { background: var(--janus-surface0); border: none; color: var(--janus-text); padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .template-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: none; border: none; color: var(--janus-text); cursor: pointer; text-align: left; font-size: 13px; width: 100%; }
  .template-item:hover { background: var(--janus-surface0); }
  .template-item.active { background: var(--janus-surface0); color: var(--janus-mauve); }
  .built-in { font-size: 9px; color: var(--janus-subtext0); text-transform: uppercase; background: var(--janus-surface1); border-radius: 2px; padding: 1px 4px; }
  .main { flex: 1; padding: 24px; overflow-y: auto; }
  .empty { color: var(--janus-subtext0); }
</style>
