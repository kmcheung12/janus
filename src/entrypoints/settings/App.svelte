<script lang="ts">
  import { onMount } from 'svelte'
  import { loadCaptureConfig, saveCaptureConfig, CAPTURE_CONFIG_LABELS } from '../../lib/capture-config'
  import type { CaptureConfig } from '../../lib/capture-config'

  let config = $state<CaptureConfig>({
    click: true, keyboard: true, keyboard_keystrokes: false, navigation: true, api: true,
    scroll: true, drag: true, console_error: true, console_warn: true, console_log: false,
  })
  let saved = $state(false)

  onMount(async () => {
    config = await loadCaptureConfig()
  })

  async function toggle(key: keyof CaptureConfig) {
    config = { ...config, [key]: !config[key] }
    await saveCaptureConfig(config)
    saved = true
    setTimeout(() => { saved = false }, 1500)
  }
</script>

<div class="page">
  <div class="sidebar">
    <div class="sidebar-header">
      <span class="logo">Janus</span>
    </div>
    <div class="nav-item active">Event capture</div>
  </div>

  <div class="main">
    <div class="section-header">
      <h2>Event capture</h2>
      <p class="desc">Choose which events Janus records while browsing. Changes take effect on the next page load.</p>
      <p class="desc note">Events are only captured while recording is active.</p>
    </div>
    <div class="list">
      {#each Object.entries(CAPTURE_CONFIG_LABELS) as [key, label]}
        {@const k = key as keyof CaptureConfig}
        <label class="row">
          <span class="label-text">{label}</span>
          <button
            class="toggle"
            class:on={config[k]}
            onclick={() => toggle(k)}
            role="switch"
            aria-checked={config[k]}
          aria-label={label}
          >
            <span class="knob"></span>
          </button>
        </label>
      {/each}
    </div>
    {#if saved}
      <p class="saved">Saved</p>
    {/if}
  </div>
</div>

<style>
  :global(body) { margin: 0; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; }
  .page { display: flex; height: 100vh; }
  .sidebar { width: 200px; border-right: 1px solid #313244; display: flex; flex-direction: column; flex-shrink: 0; }
  .sidebar-header { padding: 12px; border-bottom: 1px solid #313244; }
  .logo { font-weight: 700; color: #cba6f7; font-size: 14px; }
  .nav-item { padding: 10px 12px; font-size: 13px; color: #6c7086; cursor: default; }
  .nav-item.active { background: #313244; color: #cba6f7; }
  .main { flex: 1; padding: 24px; overflow-y: auto; }
  .section-header { margin-bottom: 16px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6c7086; margin: 0 0 6px; }
  .desc { font-size: 12px; color: #45475a; margin: 0; }
  .note { color: #cba6f7; margin-top: 4px; }
  .list { display: flex; flex-direction: column; gap: 2px; max-width: 400px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #313244; border-radius: 6px; cursor: pointer; }
  .row:hover { background: #3d3f55; }
  .label-text { font-size: 13px; }
  .toggle { position: relative; width: 36px; height: 20px; border-radius: 10px; border: none; background: #45475a; cursor: pointer; padding: 0; transition: background 0.15s; flex-shrink: 0; }
  .toggle.on { background: #cba6f7; }
  .knob { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: #1e1e2e; transition: transform 0.15s; display: block; }
  .toggle.on .knob { transform: translateX(16px); }
  .saved { font-size: 12px; color: #a6e3a1; margin: 12px 0 0; }
</style>
