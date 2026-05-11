<script lang="ts">
  import { resolveSelector } from '../../lib/element-selector'

  let { onSelect }: { onSelect: (selector: string, source: 'page' | 'extension') => void } = $props()

  let hovered = $state<Element | null>(null)

  function source(el: Element): 'page' | 'extension' {
    return el.closest('#janus-root') !== null ? 'extension' : 'page'
  }

  function handleMouseOver(e: MouseEvent) {
    e.stopPropagation()
    hovered = e.target as Element
  }

  function handleClick(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const target = e.target as Element
    onSelect(resolveSelector(target), source(target))
  }

  function handleMouseOut() {
    hovered = null
  }
</script>

<svelte:document
  onmouseover={handleMouseOver}
  onmouseout={handleMouseOut}
  onclick={handleClick}
/>

{#if hovered}
  {@const rect = hovered.getBoundingClientRect()}
  <div
    class="janus-highlight"
    style="top:{rect.top}px;left:{rect.left}px;width:{rect.width}px;height:{rect.height}px"
  />
{/if}

<style>
  .janus-highlight {
    position: fixed;
    pointer-events: none;
    outline: 2px solid #6366f1;
    background: rgba(99, 102, 241, 0.1);
    z-index: 2147483646;
    border-radius: 2px;
    transition: all 0.05s ease;
  }
</style>
