<script lang="ts">
  /**
   * §19 page label. Display metadata only: a label never affects tool
   * identity, routing or revision, and is not unique.
   */
  const MIN = 1
  const MAX = 48

  let { label = '', onsave }: { label?: string; onsave: (next: string) => Promise<string | null> } = $props()

  let draft = $state(label)
  let editing = $state(false)
  let saving = $state(false)
  let error = $state('')

  // Keep the field in step when the page changes underneath us, but never
  // clobber what the user is currently typing.
  $effect(() => { if (!editing) draft = label })

  async function commit() {
    const next = draft.trim()
    if (next === label) { editing = false; return }
    if (next.length < MIN) { error = 'Label cannot be empty'; return }
    if (next.length > MAX) { error = `Keep it under ${MAX} characters`; return }
    if (saving) return

    saving = true
    error = ''
    try {
      const failure = await onsave(next)
      if (failure) {
        error = failure
        draft = label // Apply acknowledged values only.
      } else {
        editing = false
      }
    } finally {
      saving = false
    }
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); void commit() }
    if (event.key === 'Escape') { draft = label; error = ''; editing = false }
  }
</script>

<div class="label-field">
  <input
    type="text"
    bind:value={draft}
    onfocus={() => { editing = true }}
    onblur={commit}
    {onkeydown}
    disabled={saving}
    maxlength={MAX}
    aria-label="Page label"
    placeholder="Name this page"
  />
  {#if saving}<span class="hint">Saving…</span>{/if}
  {#if error}<span class="hint error">{error}</span>{/if}
</div>

<style>
  .label-field { display: flex; align-items: center; gap: 8px; }
  input { flex: 1; padding: 5px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; }
  input:disabled { background: #f6f6f6; color: #666; }
  .hint { font-size: 11px; color: #888; }
  .hint.error { color: #c0392b; }
</style>
