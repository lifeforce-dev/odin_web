<script setup lang="ts">
import { computed } from 'vue';

import GripHandle from '@/components/GripHandle.vue';
import { useBodyHandle } from '@/composables/useBodyHandle';

// A workout held by another circuit. One workout lives in one circuit
// at a time, so these rows are recessed + dashed (on someone else's
// rack) with a filled owner pill naming that circuit. Clicking the
// body folds open the steal strip - it states the consequence and the
// named-copy tip every time (no one-time modal), with LEAVE IT / MOVE
// HERE. The grip is the drag surface, joined by the body when
// `dragAnywhere` says the pool has no scroll to protect; dragging one
// in also moves it. Render + emit only: the parent owns `open` and
// executes the steal.

const props = withDefaults(
  defineProps<{
    name: string;
    owner: string;
    open?: boolean;
    dragAnywhere?: boolean;
  }>(),
  { open: false, dragAnywhere: false },
);

const emit = defineEmits<{
  toggle: [];
  close: [];
  steal: [];
  'drag-start': [event: PointerEvent];
}>();

const bodyHandle = useBodyHandle({
  dragAnywhere: () => props.dragAnywhere,
  onDragStart: (event) => emit('drag-start', event),
  onTap: () => emit('toggle'),
});

// The owner's first word is enough to disambiguate ("Pushups //
// Upper").
const copySuggestion = computed(() => `${props.name} // ${props.owner.split(' ')[0]}`);
</script>

<template>
  <div class="pool-elsewhere" :class="{ 'pool-elsewhere--open': open }">
    <div class="pool-elsewhere__row">
      <button
        type="button"
        class="pool-elsewhere__head"
        :class="{ 'pool-elsewhere__head--draggable': dragAnywhere }"
        @click="bodyHandle.onClick"
        @pointerdown="bodyHandle.onPointerDown"
      >
        <span class="pool-elsewhere__name">{{ name }}</span>
        <span class="pool-elsewhere__owner">{{ owner }}</span>
      </button>
      <GripHandle @drag-start="(event) => emit('drag-start', event)" />
    </div>
    <div v-if="open" class="pool-elsewhere__strip">
      <p class="pool-elsewhere__message">
        Moving it here takes it <b>out of {{ owner }}</b
        >. History follows the name.
      </p>
      <p class="pool-elsewhere__hint">
        Need it in both? Make a named copy: "{{ copySuggestion }}".
      </p>
      <div class="pool-elsewhere__actions">
        <button type="button" class="pool-elsewhere__keep" @click="emit('close')">Leave it</button>
        <button type="button" class="pool-elsewhere__move" @click="emit('steal')">Move here</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pool-elsewhere__row {
  display: flex;
  align-items: stretch;
  min-height: var(--tap-min);

  /* Recessed: on someone else's rack, one step below the surface. */
  background: var(--bg);
  border: var(--hairline) dashed var(--border-strong);
}

/* A plain tap target: swiping it pans the pool; only the grip drags. */
.pool-elsewhere__head {
  display: flex;
  flex: 1 1 auto;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;
  padding: var(--space-3) 0 var(--space-3) var(--space-4);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
}

/* Nothing to scroll in the pool, so the swipe is free to mean drag
   (same rule and reason as the workout card's draggable head). */
.pool-elsewhere__head--draggable {
  cursor: grab;
  touch-action: none;
}

.pool-elsewhere--open .pool-elsewhere__row {
  background: var(--accent-soft);
  border-style: solid;
  border-color: var(--accent);
}

.pool-elsewhere__name {
  flex: 1;
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-body);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  white-space: nowrap;
  text-overflow: ellipsis;
  text-transform: uppercase;
}

.pool-elsewhere--open .pool-elsewhere__name {
  color: var(--text);
}

.pool-elsewhere__owner {
  flex: none;
  padding: var(--space-1) var(--space-2);
  color: var(--text-soft);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
  background: var(--surface-raise);
  border: var(--hairline) solid var(--border-strong);
}

/* The steal strip: consequence + named-copy tip, shown every time. */
.pool-elsewhere__strip {
  padding: var(--space-3) var(--space-4);
  background: var(--accent-soft);
  border: var(--hairline) solid var(--accent);
  border-top: none;
  animation: pool-strip-in var(--motion-press) ease-out;
}

@keyframes pool-strip-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.pool-elsewhere__message {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.pool-elsewhere__message b {
  color: var(--accent);
  font-weight: 800;
}

.pool-elsewhere__hint {
  margin: var(--space-1) 0 0;
  color: var(--text-dim);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.pool-elsewhere__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.pool-elsewhere__keep,
.pool-elsewhere__move {
  flex: 1;
  min-height: var(--tap-min);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-15);
  text-transform: uppercase;
  cursor: pointer;
}

.pool-elsewhere__keep {
  color: var(--text-dim);
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
}

.pool-elsewhere__move {
  color: var(--text);
  background: var(--accent);
  border: var(--hairline) solid var(--accent);
}

.pool-elsewhere__move:active {
  background: var(--accent-deep);
}

@media (prefers-reduced-motion: reduce) {
  .pool-elsewhere__strip {
    animation: none;
  }
}
</style>
