<script lang="ts">
  import type { StoredShortcuts } from '../../lib/shortcuts.svelte'
  import { formatShortcut } from '../../lib/shortcuts.svelte'

  interface Props {
    variant?: 'primary' | 'secondary'
    onclick: () => void
    action: keyof StoredShortcuts
    configuringFor: keyof StoredShortcuts | null
    shortcuts: StoredShortcuts
    onStartConfiguring: (e: Event, action: keyof StoredShortcuts) => void
    children?: import('svelte').Snippet
  }

  let {
    variant = 'primary',
    onclick,
    action,
    configuringFor,
    shortcuts,
    onStartConfiguring,
    children,
  }: Props = $props()

  let isConfiguring = $derived(configuringFor === action)
  let shortcutLabel = $derived(isConfiguring ? '…' : shortcuts[action] ? formatShortcut(shortcuts[action]!) : '+')
</script>

<button class={variant} {onclick}>
  {@render children?.()}
  <kbd
    class:configuring={isConfiguring}
    onclick={(e) => onStartConfiguring(e, action)}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStartConfiguring(e, action) }}
    role="button"
    tabindex="0"
  >{shortcutLabel}</kbd>
</button>

<style>
  button.primary { background: var(--janus-mauve); color: var(--janus-base); border: none; border-radius: 6px; padding: 10px; font-weight: 700; cursor: pointer; display: flex; justify-content: space-between; align-items: center; font-size: 13px; width: 100%; }
  button.primary:hover { background: var(--janus-mauve-hover); }
  button.secondary { background: var(--janus-surface0); color: var(--janus-text); border: none; border-radius: 6px; padding: 8px 10px; cursor: pointer; font-size: 12px; display: flex; justify-content: space-between; align-items: center; width: 100%; }
  button.secondary:hover { background: var(--janus-surface1); }
  kbd { font-size: 10px; background: rgba(0,0,0,0.2); border-radius: 3px; padding: 2px 4px; font-family: monospace; cursor: pointer; white-space: nowrap; }
  kbd:hover { background: rgba(0,0,0,0.35); }
  kbd.configuring { background: var(--janus-mauve); color: var(--janus-base); animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
</style>
