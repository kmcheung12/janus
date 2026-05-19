<script lang="ts">
  import { onMount } from 'svelte'
  import { resolveSelector } from '../../lib/element-selector'
  import type { ElementPickEvent } from '../../lib/event-capture/types'
  import { uuid } from '../../lib/uuid'

  const CAPTURED_STYLES = ['color', 'background', 'visibility', 'display', 'font-size'] as const

  let { onPick }: {
    onPick: (event: ElementPickEvent) => void
  } = $props()

  let hovered = $state<Element | null>(null)
  let ready = false
  onMount(() => {
    setTimeout(() => { ready = true }, 0)
    document.addEventListener('click', handleClick, { capture: true })
    return () => document.removeEventListener('click', handleClick, { capture: true })
  })

  function captureElement(el: Element): ElementPickEvent {
    const attributes: Record<string, string> = {}
    for (const attr of Array.from(el.attributes)) {
      attributes[attr.name] = attr.value
    }

    const computed = window.getComputedStyle(el)
    const styles: Record<string, string> = {}
    for (const prop of CAPTURED_STYLES) {
      const value = computed.getPropertyValue(prop)
      if (value) {
        const key = prop === 'font-size' ? 'font_size' : prop
        styles[key] = value
      }
    }

    return {
      id: uuid(),
      type: 'element_pick',
      timestamp: Date.now(),
      selector: resolveSelector(el),
      text: el.textContent?.trim() ?? '',
      attributes,
      styles,
    }
  }

  function handleMouseOver(e: MouseEvent) {
    e.stopPropagation()
    hovered = e.target as Element
  }

  function handleClick(e: MouseEvent) {
    if (!ready) return
    e.preventDefault()
    e.stopPropagation()
    onPick(captureElement(e.target as Element))
  }

  function handleMouseOut() {
    hovered = null
  }
</script>

<svelte:document
  onmouseover={handleMouseOver}
  onmouseout={handleMouseOut}
/>

{#if hovered}
  {@const rect = hovered.getBoundingClientRect()}
  <div
    class="janus-highlight"
    style="top:{rect.top}px;left:{rect.left}px;width:{rect.width}px;height:{rect.height}px"
  ></div>
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
