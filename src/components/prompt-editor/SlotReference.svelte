<script lang="ts">
  import { AUTO_FILL_SLOTS } from '../../lib/prompts/types'

  let { onInsert }: { onInsert: (slot: string) => void } = $props()
</script>

<div class="ref">
  <div class="ref-title">Available slots</div>
  {#each AUTO_FILL_SLOTS as slot}
    <button class="slot-btn" onclick={() => onInsert(`{${slot.key}}`)}>
      <code>{`{${slot.key}}`}</code>
      <span>{slot.description}</span>
    </button>
  {/each}
  <button class="slot-btn" onclick={() => onInsert('{user_text}')}>
    <code>{'{user_text}'}</code>
    <span>User's annotation note (always prompted)</span>
  </button>
</div>

<style>
  .ref { display: flex; flex-direction: column; gap: 2px; }
  .ref-title { font-size: 11px; color: var(--janus-subtext0); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .slot-btn { display: flex; align-items: baseline; gap: 8px; background: none; border: none; color: var(--janus-text); padding: 4px 0; cursor: pointer; text-align: left; font-size: 12px; }
  .slot-btn:hover code { color: var(--janus-mauve); }
  code { color: #89dceb; font-size: 11px; flex-shrink: 0; }
  span { color: var(--janus-subtext0); font-size: 11px; }
</style>
