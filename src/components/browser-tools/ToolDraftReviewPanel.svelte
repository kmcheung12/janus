<script lang="ts">
  /**
   * §19 draft review.
   *
   * A model's submission arrives here inactive. The human sees exactly what
   * will run — which controls, in what order, what is extracted, and whether
   * it has effects — and enabling is their act, against one exact revision.
   */
  import { onMount } from 'svelte'

  interface Draft {
    id: string
    revision: number
    status: string
    applicability: { origin: string; pathnamePrefix: string }
    bindings: Array<Record<string, unknown>>
    slots: Array<{ id: string; sensitive: boolean }>
    candidateSteps: Array<{ op: string; id: string }>
    expiresAt: number
  }

  interface Definition {
    definitionId: string
    definitionRevision: number
    name: string
    description: string
    inputSchema: { properties: Record<string, { type: string }> }
    steps: Array<{ op: string; id: string }>
    annotations: { readOnly: boolean; consequential: boolean }
  }

  interface Approval { definitionId: string; definitionRevision: number; state: string }

  let drafts = $state<Draft[]>([])
  let definitions = $state<Definition[]>([])
  let approvals = $state<Record<string, Approval>>({})
  let busy = $state('')
  let message = $state('')
  let testInput = $state('')
  let testResult = $state('')
  let confirmingTest = $state('')

  onMount(refresh)

  async function refresh() {
    const state = await browser.runtime.sendMessage({ type: 'JANUS_BT_AUTHORING_STATE' })
    drafts = state?.drafts ?? []
    definitions = state?.definitions ?? []
    approvals = Object.fromEntries((state?.approvals ?? []).map((a: Approval) => [a.definitionId, a]))
  }

  function stateOf(definition: Definition): string {
    const approval = approvals[definition.definitionId]
    if (!approval) return 'pending'
    // A revision bump invalidates the old approval, so say so rather than
    // showing a stale "enabled".
    if (approval.definitionRevision !== definition.definitionRevision) return 'needs review again'
    return approval.state
  }

  async function copyId(draftId: string) {
    await navigator.clipboard.writeText(
      `Author the Janus tool draft ${draftId}: call get_tool_draft then submit_tool_definition.`,
    )
    message = 'Prompt copied — paste it to your agent'
    setTimeout(() => { message = '' }, 2500)
  }

  async function setState(definitionId: string, state: 'enabled' | 'disabled') {
    busy = definitionId
    try {
      await browser.runtime.sendMessage({ type: 'JANUS_BT_SET_APPROVAL', definitionId, state })
      await refresh()
    } finally { busy = '' }
  }

  async function remove(definitionId: string) {
    busy = definitionId
    try {
      await browser.runtime.sendMessage({ type: 'JANUS_BT_DELETE_DEFINITION', definitionId })
      await refresh()
    } finally { busy = '' }
  }

  async function runTest(definition: Definition) {
    busy = definition.definitionId
    testResult = ''
    try {
      let input: Record<string, unknown> = {}
      if (testInput.trim()) {
        try { input = JSON.parse(testInput) } catch { testResult = 'Input must be JSON'; return }
      }
      const result = await browser.runtime.sendMessage({
        type: 'JANUS_BT_TEST_DEFINITION', definitionId: definition.definitionId, input,
      })
      testResult = JSON.stringify(result?.outcome ?? result, null, 2)
      confirmingTest = ''
    } finally { busy = '' }
  }

  async function exportOne(definitionId: string) {
    const result = await browser.runtime.sendMessage({ type: 'JANUS_BT_EXPORT_DEFINITION', definitionId })
    if (result?.json) {
      await navigator.clipboard.writeText(result.json)
      message = 'Export copied'
      setTimeout(() => { message = '' }, 2500)
    }
  }
</script>

<section class="panel">
  <h3>Saved tools</h3>

  {#if message}<p class="ok">{message}</p>{/if}

  <h4>Pending drafts ({drafts.length})</h4>
  {#if drafts.length === 0}
    <p class="desc">
      No drafts. Capture a form on an enabled page, then ask your agent to author it.
    </p>
  {/if}
  {#each drafts as draft (draft.id)}
    <article class="card">
      <div class="row">
        <code>{draft.id}</code>
        <span class="badge">{draft.status}</span>
      </div>
      <p class="desc mono">{draft.applicability.origin}{draft.applicability.pathnamePrefix}</p>
      <p class="desc">
        {draft.candidateSteps.length} steps ·
        {draft.slots.filter((s) => !s.sensitive).length} parameters ·
        {draft.slots.filter((s) => s.sensitive).length} excluded as sensitive
      </p>
      <p class="desc">Expires {new Date(draft.expiresAt).toLocaleString()}</p>
      <button onclick={() => copyId(draft.id)}>Copy prompt for agent</button>
    </article>
  {/each}

  <h4>Definitions ({definitions.length})</h4>
  {#each definitions as definition (definition.definitionId)}
    {@const state = stateOf(definition)}
    <article class="card">
      <div class="row">
        <strong>{definition.name}</strong>
        <span class="badge" data-state={state}>{state}</span>
      </div>
      <p class="desc">{definition.description}</p>
      <p class="desc">
        Parameters: {Object.keys(definition.inputSchema.properties ?? {}).join(', ') || 'none'}
      </p>
      <p class="desc">Operations: {definition.steps.map((s) => s.op).join(' → ')}</p>
      <p class="desc" class:warn={definition.annotations.consequential}>
        {definition.annotations.consequential
          ? 'Has effects — changes the page when it runs'
          : 'Read-only'}
      </p>

      {#if confirmingTest === definition.definitionId}
        <p class="desc warn">
          A test really runs this tool on the live page, with the effects above.
        </p>
        <textarea bind:value={testInput} placeholder={'{"query": "example"}'} rows="2"></textarea>
        <div class="actions">
          <button class="primary" onclick={() => runTest(definition)} disabled={busy === definition.definitionId}>
            Run it
          </button>
          <button onclick={() => { confirmingTest = '' }}>Cancel</button>
        </div>
      {:else}
        <div class="actions">
          <button onclick={() => { confirmingTest = definition.definitionId; testResult = '' }}>Test</button>
          {#if state === 'enabled'}
            <button onclick={() => setState(definition.definitionId, 'disabled')} disabled={busy === definition.definitionId}>
              Disable
            </button>
          {:else}
            <button class="primary" onclick={() => setState(definition.definitionId, 'enabled')} disabled={busy === definition.definitionId}>
              Enable this revision
            </button>
          {/if}
          <button onclick={() => exportOne(definition.definitionId)}>Export</button>
          <button onclick={() => remove(definition.definitionId)} disabled={busy === definition.definitionId}>Delete</button>
        </div>
      {/if}

      {#if testResult}<pre>{testResult}</pre>{/if}
    </article>
  {/each}

  {#if definitions.length === 0}
    <p class="desc">No definitions yet.</p>
  {/if}
</section>

<style>
  .panel { padding: 16px 0; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  h4 { margin: 20px 0 8px; font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }
  .desc { color: #888; font-size: 12px; margin: 0 0 6px; line-height: 1.5; }
  .desc.mono { font-family: monospace; }
  .desc.warn { color: #b9770e; }
  .ok { color: #1e8449; font-size: 12px; }
  .card { border: 1px solid #eee; border-radius: 6px; padding: 12px; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #eee; color: #555; }
  .badge[data-state='enabled'] { background: #d5f5e3; color: #1e8449; }
  .badge[data-state='needs review again'] { background: #fdebd0; color: #b9770e; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  textarea { width: 100%; font-family: monospace; font-size: 12px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; }
  pre { background: #f6f6f6; color: #1a1a1a; padding: 8px; border-radius: 4px; font-size: 11px; overflow-x: auto; max-height: 200px; }
  button { padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; color: #1a1a1a; cursor: pointer; font-size: 11px; }
  button.primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
