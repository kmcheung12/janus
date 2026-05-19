<script lang="ts">
  import { untrack } from 'svelte'
  import { copyToClipboard } from '../../lib/clipboard'

  let { value, onCopy, rows = 8, highlightLine, onLineClick }: {
    value: string
    onCopy?: () => void
    rows?: number
    highlightLine?: string
    onLineClick?: (line: string) => void
  } = $props()

  let editableValue = $state(untrack(() => value))
  let copied = $state(false)

  $effect(() => { editableValue = value })

  function scrollIfActive(node: HTMLElement, active: boolean) {
    if (active) node.scrollIntoView({ block: 'nearest' })
    return {
      update(newActive: boolean) {
        if (newActive) node.scrollIntoView({ block: 'nearest' })
      }
    }
  }

  async function copy() {
    const ok = await copyToClipboard(editableValue)
    if (ok) {
      copied = true
      setTimeout(() => { copied = false; onCopy?.() }, 1200)
    }
  }
</script>

<div class="prompt-box">
  {#if highlightLine !== undefined}
    <div class="prompt-display" style="height: calc({rows} * 1.5em + 14px)">
      {#each value.split('\n') as line}
        {@const active = highlightLine.length > 0 && line.includes(highlightLine)}
        <div
          class="display-line"
          class:highlighted={active}
          class:clickable={!!onLineClick}
          onclick={() => onLineClick?.(line)}
          use:scrollIfActive={active}
        >{line}</div>
      {/each}
    </div>
  {:else}
    <textarea bind:value={editableValue} {rows}></textarea>
  {/if}
  <button class="copy-btn" onclick={copy}>{copied ? 'Copied!' : 'Copy to clipboard'}</button>
</div>

<style>
  .prompt-box { display: flex; flex-direction: column; gap: 4px; }
  textarea {
    background: #181825; border: 1px solid #313244; border-radius: 4px;
    color: #a6adc8; padding: 6px 8px; font-size: 11px; font-family: monospace;
    resize: vertical; width: 100%; box-sizing: border-box;
  }
  .prompt-display {
    background: #181825; border: 1px solid #313244; border-radius: 4px;
    font-size: 11px; font-family: monospace; overflow-y: auto;
    width: 100%; box-sizing: border-box; padding: 6px 0;
  }
  .display-line {
    padding: 1px 8px; line-height: 1.5; color: #a6adc8;
    white-space: pre-wrap; word-break: break-all;
  }
  .display-line.highlighted {
    background: #2a2040; border-left: 2px solid #cba6f7;
    padding-left: 6px; color: #cdd6f4;
  }
  .display-line.clickable { cursor: pointer; }
  .display-line.clickable:hover { background: #252535; }
  .copy-btn {
    background: #cba6f7; color: #1e1e2e; border: none; border-radius: 4px;
    padding: 8px; font-weight: 700; cursor: pointer; font-size: 12px;
  }
  .copy-btn:hover { background: #d6b9fa; }
</style>
