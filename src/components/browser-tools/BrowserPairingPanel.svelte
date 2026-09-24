<script lang="ts">
  /**
   * §19 pairing panel.
   *
   * The token is generated here, in the extension background context, and
   * shown exactly once. It is never interpolated into the displayed command —
   * the daemon reads it from stdin so it cannot land in shell history or `ps`.
   */
  import { onMount } from 'svelte'

  interface PairingConfig {
    url: string
    pairingId: string
    token: string
    browserSessionId: string
  }

  type Status =
    | { state: 'idle' } | { state: 'connecting' } | { state: 'connected'; connectionId: string }
    | { state: 'unreachable' } | { state: 'unauthorized' }

  const DEFAULT_URL = 'ws://127.0.0.1:3457'
  const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

  let url = $state(DEFAULT_URL)
  let urlError = $state('')
  let status = $state<Status>({ state: 'idle' })
  let paired = $state(false)
  let pairingPayload = $state<string | null>(null)
  let copied = $state(false)
  let busy = $state(false)
  let confirmingRotate = $state(false)

  const statusLabel = $derived(
    status.state === 'connected' ? 'Connected'
    : status.state === 'connecting' ? 'Connecting…'
    : status.state === 'unauthorized' ? 'Authentication failed'
    : status.state === 'unreachable' ? 'Daemon unreachable'
    : paired ? 'Awaiting daemon' : 'Not paired',
  )

  onMount(async () => {
    const state = await browser.runtime.sendMessage({ type: 'JANUS_BT_GET_STATE' })
    status = state?.status ?? { state: 'idle' }
    paired = status.state !== 'idle'

    browser.runtime.onMessage.addListener((msg: { type: string; status?: Status }) => {
      if (msg.type === 'JANUS_BT_STATUS' && msg.status) status = msg.status
    })
  })

  /**
   * Only loopback. Execution turns this into a remote-control surface for a
   * logged-in browser session, and the bearer-token model explicitly does not
   * defend against a network peer.
   */
  function validateUrl(value: string): string {
    let parsed: URL
    try { parsed = new URL(value) } catch { return 'Enter a WebSocket URL' }
    if (parsed.protocol !== 'ws:') return 'Must start with ws://'
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) return 'Must be a loopback address'
    if (parsed.username || parsed.password) return 'Credentials are not allowed in the URL'
    if (parsed.search || parsed.hash) return 'Query and fragment are not allowed'
    if (parsed.pathname !== '/') return 'Path must be /'
    if (!parsed.port) return 'Include a port'
    return ''
  }

  function randomHex(bytes: number): string {
    const buffer = new Uint8Array(bytes)
    crypto.getRandomValues(buffer)
    return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  async function pair() {
    urlError = validateUrl(url)
    if (urlError || busy) return
    busy = true
    try {
      const config: PairingConfig = {
        url,
        pairingId: `pair_${randomHex(8)}`,
        token: randomHex(32), // 256 bits
        browserSessionId: `browser_${randomHex(8)}`,
      }
      await browser.runtime.sendMessage({ type: 'JANUS_BT_SAVE_PAIRING', config })
      // Shown once. The stored copy stays in background-only storage.
      pairingPayload = JSON.stringify({ pairingId: config.pairingId, token: config.token })
      paired = true
      confirmingRotate = false
    } finally {
      busy = false
    }
  }

  /**
   * §19 Retry. The extension stops reconnecting after a 4401 on purpose —
   * hammering a rejected credential just locks the record out — so once the
   * user has provisioned the daemon, reconnecting is an explicit action.
   * Retry keeps the same credential and never rotates it.
   */
  async function retry() {
    busy = true
    try {
      await browser.runtime.sendMessage({ type: 'JANUS_BT_RECONNECT' })
    } finally { busy = false }
  }

  async function forget() {
    busy = true
    try {
      await browser.runtime.sendMessage({ type: 'JANUS_BT_SAVE_PAIRING', config: null })
      await browser.runtime.sendMessage({ type: 'JANUS_BT_DISABLE_PAGE' })
      paired = false
      pairingPayload = null
      status = { state: 'idle' }
    } finally {
      busy = false
    }
  }

  async function copyPayload() {
    if (!pairingPayload) return
    await navigator.clipboard.writeText(pairingPayload)
    copied = true
    setTimeout(() => { copied = false }, 1500)
  }
</script>

<section class="panel">
  <h3>Browser connection</h3>
  <p class="desc">
    Lets a coding agent discover and run tools on pages you explicitly enable.
    Pairing is required before anything can be executed.
  </p>

  <label class="field">
    <span>Daemon address</span>
    <input
      type="text"
      bind:value={url}
      disabled={paired}
      oninput={() => { urlError = validateUrl(url) }}
      placeholder={DEFAULT_URL}
    />
  </label>
  {#if urlError}<p class="error">{urlError}</p>{/if}

  <div class="status" data-state={status.state}>
    <span class="dot"></span>
    <span>{statusLabel}</span>
  </div>

  {#if status.state === 'unauthorized'}
    <p class="error">
      The daemon rejected this credential. It may have been revoked or replaced.
      Pair again and re-provision it.
    </p>
  {:else if status.state === 'unreachable' && paired}
    <p class="desc">
      Paired, but the daemon is not answering. Start it, then provision this
      browser with the command below.
    </p>
  {/if}

  {#if pairingPayload}
    <div class="handoff">
      <p class="desc">
        Provision this browser with the local daemon. The secret is shown once
        and is read from stdin, so it never appears in your shell history.
      </p>
      <code>janus-mcp pair --stdin</code>
      <button onclick={copyPayload}>{copied ? 'Copied' : 'Copy pairing JSON'}</button>
    </div>
  {/if}

  <div class="actions">
    {#if !paired}
      <button class="primary" onclick={pair} disabled={busy || !!urlError}>Pair with Janus</button>
    {:else if confirmingRotate}
      <span class="desc">Rotating disables control until you re-provision. Continue?</span>
      <button class="primary" onclick={pair} disabled={busy}>Rotate</button>
      <button onclick={() => { confirmingRotate = false }}>Cancel</button>
    {:else}
      {#if status.state !== 'connected'}
        <button class="primary" onclick={retry} disabled={busy}>Retry connection</button>
      {/if}
      <button onclick={() => { confirmingRotate = true }} disabled={busy}>Rotate credential</button>
      <button onclick={forget} disabled={busy}>Forget</button>
    {/if}
  </div>

  {#if paired && !confirmingRotate}
    <p class="desc note">
      Forgetting clears the local token only. Run <code>janus-mcp revoke &lt;pairingId&gt;</code>
      to delete the daemon's record too.
    </p>
  {/if}
</section>

<style>
  .panel { padding: 16px 0; }
  h3 { margin: 0 0 4px; font-size: 14px; }
  .desc { color: #888; font-size: 12px; margin: 0 0 12px; line-height: 1.5; }
  .note { margin-top: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; font-size: 12px; }
  .field input { padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; }
  .field input:disabled { background: #f6f6f6; color: #666; }
  .error { color: #c0392b; font-size: 12px; margin: 4px 0 8px; }
  .status { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 12px 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #bbb; }
  .status[data-state='connected'] .dot { background: #2ecc71; }
  .status[data-state='connecting'] .dot { background: #f1c40f; }
  .status[data-state='unreachable'] .dot,
  .status[data-state='unauthorized'] .dot { background: #e74c3c; }
  .handoff { background: #f6f6f6; border-radius: 6px; padding: 12px; margin-bottom: 12px; }
  .handoff code { display: block; font-size: 12px; margin-bottom: 8px; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; }
  button.primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
