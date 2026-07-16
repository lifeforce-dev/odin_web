<script setup lang="ts">
import { useDragHandle } from '@/composables/useDragHandle';

// The grip: six dots, the drag surface on a draggable row. Owns the
// press-to-drag decision (useDragHandle) and emits the live pointer
// event once the press travels past the threshold; a press that
// releases without travelling means nothing - a grip has no tap
// meaning. Shared by every draggable row, so the hit area, dot recipe,
// and touch-action rule exist exactly once.

const emit = defineEmits<{
  'drag-start': [event: PointerEvent];
}>();

const drag = useDragHandle({ onDragStart: (event) => emit('drag-start', event) });
</script>

<template>
  <span class="grip-handle" aria-hidden="true" @pointerdown="drag.onPointerDown">
    <span v-for="dot in 6" :key="dot" class="grip-handle__dot"></span>
  </span>
</template>

<style scoped>
/* The browser must not contest a gesture that starts here, so
   touch-action: none lives on this and on nothing else unless the row's
   list has no scroll to lose (the body handle's rule - see
   useBodyHandle). Full row height + tap-min width keeps the handle
   thumbable while the dots stay small; dim ink so red stays reserved. */
.grip-handle {
  --grip-dot: 3px;

  display: grid;
  flex: none;
  grid-template-columns: repeat(2, var(--grip-dot));
  gap: var(--space-1);
  place-content: center;
  width: var(--tap-min);
  cursor: grab;
  touch-action: none;
}

.grip-handle__dot {
  width: var(--grip-dot);
  height: var(--grip-dot);
  background: var(--text-dim);
  border-radius: 50%;
}
</style>
