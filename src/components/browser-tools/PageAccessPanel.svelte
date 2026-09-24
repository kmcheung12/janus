<script lang="ts">
  /**
   * §19 page access. Disabled by default: enabling a page is the moment Janus
   * goes from observing a session to controlling it, so it is always an
   * explicit act, never a side effect of switching tabs.
   */
  import { onMount } from 'svelte'
  import PageLabelField from './PageLabelField.svelte'

  interface EnabledPage {
    pageId: string
    tabId: number
    documentId: string
    label: string
    title: string
    url: string
    origin: string
    nativeCapability: 'available' | 'unavailable' | 'untested'
  }

  type Status = { state: string; connectionId?: string }

  let status = $state<Status>({ state: 'idle' })
  let page = $state<EnabledPage | null>(null)
  let pages = $state<EnabledPage[]>([])
  let currentTab = $state<{ id?: number; title?: string; url?: string } | null>(null)
  let error = $state('')
  let busy = $state(false)

  const connected = $derived(status.state === 'connected')
  const isThisTab = $derived(!!page)
  const others = $derived(pages.filter((p) => p.tabId !== currentTab?.id))

  const origin = $derived.by(() => {
    try { return new URL(currentTab?.url ?? '').origin } catch { return '' }
  })
  const supported = $derived(origin.startsWith('http'))

  const capabilityLabel = $derived(
    page?.nativeCapability === 'available' ? 'Native WebMCP available'
    : page?.nativeCapability === 'untested' ? 'Native WebMCP present but unverified'
    : 'No native WebMCP — Janus-generated tools only',
  )

  /**
   * The tab this panel acts on.
   *
   * Normally the active tab. But the popup can itself be open in a tab — when
   * debugging, or under the e2e harness — and it must never target itself, so
   * fall back to the most recently accessed http(s) tab in the window.
   */
  async function resolveTargetTab() {
    const [active] = await browser.tabs.query({ active: true, currentWindow: true })
    if (active?.url?.startsWith('http')) return active

    const candidates = await browser.tabs.query({ currentWindow: true })
    return candidates
      .filter((t) => t.url?.startsWith('http'))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]
  }

  onMount(async () => {
    const tab = await resolveTargetTab()
    currentTab = tab ? { id: tab.id, title: tab.title, url: tab.url } : null
    await refresh()

    browser.runtime.onMessage.addListener((msg: { type: string; status?: Status }) => {
      if (msg.type === 'JANUS_BT_STATUS' && msg.status) status = msg.status
    })
  })

  async function refresh() {
    const state = await browser.runtime.sendMessage({
      type: 'JANUS_BT_GET_STATE', tabId: currentTab?.id,
    })
    status = state?.status ?? { state: 'idle' }
    page = state?.page ?? null
    pages = state?.pages ?? []
  }

  async function enable() {
    if (!currentTab?.id || busy) return
    busy = true
    error = ''
    try {
      // The background resolves the real top-level document and obtains a new
      // page ID before this reports success.
      const result = await browser.runtime.sendMessage({
        type: 'JANUS_BT_ENABLE_PAGE', tabId: currentTab.id, label: currentTab.title,
      })
      if (result?.error) error = result.error
      else { page = result.page; await refresh() }
    } finally {
      busy = false
    }
  }

  async function disable(tabId?: number) {
    busy = true
    try {
      await browser.runtime.sendMessage({
        type: 'JANUS_BT_DISABLE_PAGE', tabId: tabId ?? currentTab?.id,
      })
      if (tabId === undefined || tabId === currentTab?.id) page = null
      await refresh()
    } finally {
      busy = false
    }
  }

  async function saveLabel(next: string): Promise<string | null> {
    const result = await browser.runtime.sendMessage({
      type: 'JANUS_BT_SET_LABEL', tabId: currentTab?.id, label: next,
    })
    if (result?.error) return result.error
    page = result.page
    return null
  }
</script>

<section class="panel">
  <div class="head">
    <h3>Agent tools</h3>
    {#if isThisTab}<span class="badge on">Enabled</span>{/if}
  </div>

  {#if !connected}
    <p class="desc">
      {status.state === 'unauthorized'
        ? 'This browser is not authorized. Re-pair in settings.'
        : 'Not connected to the Janus daemon.'}
    </p>
    <button onclick={() => browser.runtime.openOptionsPage()}>Open connection settings</button>
  {:else if !supported}
    <p class="desc">Tools can only be enabled on http(s) pages.</p>
  {:else if isThisTab && page}
    <PageLabelField label={page.label} onsave={saveLabel} />
    <p class="desc cap">{capabilityLabel}</p>
    <p class="desc mono">{page.origin}</p>
    <div class="actions">
      <button onclick={() => disable()} disabled={busy}>Disable tools on this page</button>
    </div>
    <p class="desc note">
      Disabling withdraws the tools immediately and cancels queued work. If a
      running action cannot be confirmed stopped, its outcome is reported as
      unknown.
    </p>
  {:else}
    <p class="desc">
      Let a connected agent run this page's tools. Off by default.
    </p>
    <p class="desc mono">{origin}</p>
    <div class="actions">
      <button class="primary" onclick={enable} disabled={busy}>Enable tools on this page</button>
    </div>
  {/if}

  {#if others.length}
    <div class="others">
      <p class="desc">Also enabled ({others.length}):</p>
      {#each others as other (other.pageId)}
        <div class="other">
          <span class="other-label" title={other.url}>{other.label}</span>
          <button onclick={() => disable(other.tabId)} disabled={busy}>Disable</button>
        </div>
      {/each}
    </div>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
</section>

<style>
  .panel { padding: 12px 0; border-top: 1px solid #eee; }
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  h3 { margin: 0; font-size: 13px; }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 10px; background: #eee; color: #555; }
  .badge.on { background: #d5f5e3; color: #1e8449; }
  .desc { color: #888; font-size: 11px; margin: 0 0 8px; line-height: 1.5; }
  .desc.mono { font-family: monospace; }
  .desc.cap { color: #666; }
  .note { margin-top: 8px; }
  .error { color: #c0392b; font-size: 11px; margin: 8px 0 0; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
  .others { margin-top: 12px; padding-top: 8px; border-top: 1px solid #f0f0f0; }
  .other { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
  .other-label { font-size: 11px; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { padding: 5px 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; }
  button.primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
