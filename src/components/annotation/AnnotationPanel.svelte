<script lang="ts">
  import type { CapturedEvent } from '../../lib/event-capture/types'
  let { selectedSelector, selectedEvent, events, pageUrl, onBack, onDone }: {
    selectedSelector?: string
    selectedEvent?: CapturedEvent
    events: CapturedEvent[]
    pageUrl: string
    onBack: () => void
    onDone: () => void
  } = $props()
</script>
<div>AnnotationPanel stub</div>
