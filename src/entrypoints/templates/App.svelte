<script lang="ts">
  import { onMount } from 'svelte'
  import TemplateEditor from '../../components/templates/TemplateEditor.svelte'
  import { loadTemplates, saveTemplate, deleteTemplate, resetTemplate } from '../../lib/templates/storage'
  import type { Template } from '../../lib/templates/types'

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
      id: crypto.randomUUID(),
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
      <TemplateEditor
        template={selected}
        onSave={handleSave}
        onDelete={!selected.isBuiltIn ? () => handleDelete(selected!.id) : undefined}
        onReset={selected.isBuiltIn ? () => handleReset(selected!.id) : undefined}
      />
    {:else}
      <p class="empty">Select a template or create a new one.</p>
    {/if}
  </div>
</div>

<style>
  :global(body) { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; }
  .page { display: flex; height: 100vh; }
  .sidebar { width: 200px; border-right: 1px solid #313244; display: flex; flex-direction: column; }
  .sidebar-header { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid #313244; }
  .logo { font-weight: 700; color: #cba6f7; }
  .sidebar-header button { background: #313244; border: none; color: #cdd6f4; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .template-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: none; border: none; color: #cdd6f4; cursor: pointer; text-align: left; font-size: 13px; width: 100%; }
  .template-item:hover { background: #313244; }
  .template-item.active { background: #313244; color: #cba6f7; }
  .built-in { font-size: 9px; color: #6c7086; text-transform: uppercase; background: #45475a; border-radius: 2px; padding: 1px 4px; }
  .main { flex: 1; padding: 24px; overflow-y: auto; }
  .empty { color: #6c7086; }
</style>
