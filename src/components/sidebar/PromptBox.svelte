<script lang="ts">
  import { untrack } from 'svelte'
  import { copyToClipboard } from '../../lib/clipboard'

  let { value, onCopy, rows = 8 }: { value: string; onCopy?: () => void; rows?: number } = $props()

  let editableValue = $state(untrack(() => value))
  let copied = $state(false)

  $effect(() => { editableValue = value })

  async function copy() {
    const ok = await copyToClipboard(editableValue)
    if (ok) {
      copied = true
      setTimeout(() => { copied = false; onCopy?.() }, 1200)
    }
  }
</script>

<div class="prompt-box">
  <textarea bind:value={editableValue} {rows}></textarea>
  <button class="copy-btn" onclick={copy}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
</div>

<style>
  .prompt-box { display: flex; flex-direction: column; gap: 4px; }
  textarea {
    background: #181825; border: 1px solid #313244; border-radius: 4px;
    color: #a6adc8; padding: 6px 8px; font-size: 11px; font-family: monospace;
    resize: vertical; width: 100%; box-sizing: border-box;
  }
  .copy-btn {
    background: #cba6f7; color: #1e1e2e; border: none; border-radius: 4px;
    padding: 8px; font-weight: 700; cursor: pointer; font-size: 12px;
  }
  .copy-btn:hover { background: #d6b9fa; }
</style>
