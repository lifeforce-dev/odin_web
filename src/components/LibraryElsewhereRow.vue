<script setup lang="ts">
import { computed } from 'vue';

import GripHandle from '@/components/GripHandle.vue';
import { useBodyHandle } from '@/composables/useBodyHandle';

// A workout held by another circuit. One workout lives in one circuit
// at a time, so these rows are recessed + dashed (held by another
// circuit) with a filled owner pill naming that circuit. Clicking the
// body folds open the steal strip - it states the consequence and the
// named-copy tip every time (no one-time modal), with LEAVE IT / MOVE
// HERE. The grip is the drag surface, joined by the body when
// `dragAnywhere` says the library has no scroll to protect; dragging one
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
  <div class="library-elsewhere" :class="{ 'library-elsewhere--open': open }">
    <div class="library-elsewhere__row">
      <button
        type="button"
        class="library-elsewhere__head"
        :class="{ 'library-elsewhere__head--draggable': dragAnywhere }"
        @click="bodyHandle.onClick"
        @pointerdown="bodyHandle.onPointerDown"
      >
        <span class="library-elsewhere__name">{{ name }}</span>
        <span class="library-elsewhere__owner">{{ owner }}</span>
      </button>
      <GripHandle @drag-start="(event) => emit('drag-start', event)" />
    </div>
    <div v-if="open" class="library-elsewhere__strip">
      <p class="library-elsewhere__message">
        Moving it here takes it <b>out of {{ owner }}</b
        >. History follows the name.
      </p>
      <p class="library-elsewhere__hint">
        Need it in both? Make a named copy: "{{ copySuggestion }}".
      </p>
      <div class="library-elsewhere__actions">
        <button type="button" class="library-elsewhere__keep" @click="emit('close')">
          Leave it
        </button>
        <button type="button" class="library-elsewhere__move" @click="emit('steal')">
          Move here
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.library-elsewhere__row {
  display: flex;
  align-items: stretch;
  min-height: var(--tap-min);

  /* Recessed: held by another circuit, one step below the surface. */
  background: var(--bg);
  border: var(--hairline) dashed var(--border-strong);
}

/* A plain tap target: swiping it pans the library; only the grip drags. */
.library-elsewhere__head {
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

/* Nothing to scroll in the library, so the swipe is free to mean drag
   (same rule and reason as the workout card's draggable head). */
.library-elsewhere__head--draggable {
  cursor: grab;
  touch-action: none;
}

.library-elsewhere--open .library-elsewhere__row {
  background: var(--accent-soft);
  border-style: solid;
  border-color: var(--accent);
}

.library-elsewhere__name {
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

.library-elsewhere--open .library-elsewhere__name {
  color: var(--text);
}

.library-elsewhere__owner {
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
.library-elsewhere__strip {
  padding: var(--space-3) var(--space-4);
  background: var(--accent-soft);
  border: var(--hairline) solid var(--accent);
  border-top: none;
  animation: library-strip-in var(--motion-press) ease-out;
}

@keyframes library-strip-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.library-elsewhere__message {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.library-elsewhere__message b {
  color: var(--accent);
  font-weight: 800;
}

.library-elsewhere__hint {
  margin: var(--space-1) 0 0;
  color: var(--text-dim);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.library-elsewhere__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.library-elsewhere__keep,
.library-elsewhere__move {
  flex: 1;
  min-height: var(--tap-min);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-15);
  text-transform: uppercase;
  cursor: pointer;
}

.library-elsewhere__keep {
  color: var(--text-dim);
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
}

.library-elsewhere__move {
  color: var(--text);
  background: var(--accent);
  border: var(--hairline) solid var(--accent);
}

.library-elsewhere__move:active {
  background: var(--accent-deep);
}

@media (prefers-reduced-motion: reduce) {
  .library-elsewhere__strip {
    animation: none;
  }
}
</style>
