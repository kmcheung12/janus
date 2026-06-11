<script lang="ts">
  import { onMount } from 'svelte'
  import { loadCaptureConfig, saveCaptureConfig, CAPTURE_CONFIG_LABELS } from '../../lib/capture-config'
  import type { CaptureConfig } from '../../lib/capture-config'

  let config = $state<CaptureConfig>({
    click: true, keyboard: true, keyboard_keystrokes: false, navigation: true, api: true,
    scroll: true, drag: true, console_error: true, console_warn: true, console_log: false, resize: true,
  })
  let saved = $state(false)

  onMount(async () => {
    config = await loadCaptureConfig()
  })

  async function toggle(key: keyof CaptureConfig) {
    const newConfig = { ...config, [key]: !config[key] } as CaptureConfig
    config = newConfig
    await saveCaptureConfig(newConfig)
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
  .sidebar { width: 200px; border-right: 1px solid var(--janus-surface0); display: flex; flex-direction: column; flex-shrink: 0; }
  .sidebar-header { padding: 12px; border-bottom: 1px solid var(--janus-surface0); }
  .logo { font-weight: 700; color: var(--janus-mauve); font-size: 14px; }
  .nav-item { padding: 10px 12px; font-size: 13px; color: var(--janus-subtext0); cursor: default; }
  .nav-item.active { background: var(--janus-surface0); color: var(--janus-mauve); }
  .main { flex: 1; padding: 24px; overflow-y: auto; }
  .section-header { margin-bottom: 16px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--janus-subtext0); margin: 0 0 6px; }
  .desc { font-size: 12px; color: var(--janus-surface1); margin: 0; }
  .note { color: var(--janus-mauve); margin-top: 4px; }
  .list { display: flex; flex-direction: column; gap: 2px; max-width: 400px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--janus-surface0); border-radius: 6px; cursor: pointer; }
  .row:hover { background: var(--janus-surface1-hover); }
  .label-text { font-size: 13px; }
  .toggle { position: relative; width: 36px; height: 20px; border-radius: 10px; border: none; background: var(--janus-surface1); cursor: pointer; padding: 0; transition: background 0.15s; flex-shrink: 0; }
  .toggle.on { background: var(--janus-mauve); }
  .knob { position: absolute; top: 3px; left: 3px; width: 14px; height: 14px; border-radius: 50%; background: var(--janus-base); transition: transform 0.15s; display: block; }
  .toggle.on .knob { transform: translateX(16px); }
  .saved { font-size: 12px; color: var(--janus-green); margin: 12px 0 0; }
</style>
