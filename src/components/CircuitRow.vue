<script setup lang="ts">
import { computed } from 'vue';

import GripHandle from '@/components/GripHandle.vue';
import { rackBadge } from '@/composables/rack-badge';
import { useBodyHandle } from '@/composables/useBodyHandle';

// One circuit in the rotation queue: a numbered rack socket (the same
// badge idiom as the workbench's slot rack) holding the name, its
// workout count, a dim delete affordance, and the grip. Render + emit
// only: ordering, session state, and persistence live in
// useCircuitManager / domain/workout.ts. dragAnywhere joins the body to
// the grip as a second drag surface, the same idiom WorkoutCard uses.

const props = withDefaults(
  defineProps<{
    name: string;
    // 1-based queue position.
    order: number;
    workoutCount: number;
    tag?: 'next' | 'active' | null;
    // Swap mode's non-targets: reduced opacity, inert to taps.
    dimmed?: boolean;
    dragAnywhere?: boolean;
  }>(),
  { tag: null, dimmed: false, dragAnywhere: false },
);

const emit = defineEmits<{
  open: [];
  delete: [];
  'drag-start': [event: PointerEvent];
}>();

const bodyHandle = useBodyHandle({
  dragAnywhere: () => props.dragAnywhere,
  onDragStart: (event) => emit('drag-start', event),
  onTap: () => emit('open'),
});

const orderBadge = computed(() => rackBadge(props.order));

// The schema has no duration data, so meta is workout count only.
const meta = computed(() => {
  if (props.workoutCount === 0) {
    return 'Empty';
  }
  return props.workoutCount === 1 ? '1 workout' : `${props.workoutCount} workouts`;
});

const tagLabel = computed(() => (props.tag === 'active' ? 'Active' : 'Next'));
</script>

<template>
  <div
    class="circuit-row"
    :class="{
      'circuit-row--tagged': tag !== null,
      'circuit-row--dimmed': dimmed,
    }"
  >
    <span class="circuit-row__order">{{ orderBadge }}</span>
    <button
      type="button"
      class="circuit-row__body"
      :class="{ 'circuit-row__body--draggable': dragAnywhere }"
      @click="bodyHandle.onClick"
      @pointerdown="bodyHandle.onPointerDown"
    >
      <span class="circuit-row__name">{{ name }}</span>
      <span class="circuit-row__meta-row">
        <span class="circuit-row__meta">{{ meta }}</span>
        <span v-if="tag" class="circuit-row__tag">{{ tagLabel }}</span>
      </span>
    </button>
    <button
      type="button"
      class="circuit-row__delete"
      aria-label="Delete circuit"
      @click="emit('delete')"
    >
      &#10005;
    </button>
    <GripHandle @drag-start="(event) => emit('drag-start', event)" />
  </div>
</template>

<style scoped>
.circuit-row {
  display: flex;
  align-items: stretch;
  background: var(--surface);
  border: var(--hairline) solid var(--border);
}

/* Badge-cell recipe (shared with .workbench__rack-index and
   .circuits__gap-index): this one inherits the row's own surface, so
   it draws only the right divider, no plate. */
.circuit-row__order {
  display: flex;
  flex: 0 0 var(--rack-index);
  align-items: center;
  justify-content: center;
  color: var(--text-soft);
  font-family: var(--font-display);
  font-size: var(--type-display-badge);
  line-height: 1;
  letter-spacing: var(--tracking-1);
  border-right: var(--hairline) solid var(--border-strong);
}

/* A plain tap target: swiping it pans the queue list; only the grip
   drags unless dragAnywhere joins it as a second surface. */
.circuit-row__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
}

.circuit-row__body--draggable {
  cursor: grab;
  touch-action: none;
}

.circuit-row__name {
  overflow: hidden;
  color: var(--text);
  font-size: var(--type-data);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--tracking-05);
  white-space: nowrap;
  text-overflow: ellipsis;
  text-transform: uppercase;
}

.circuit-row__meta-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.circuit-row__meta {
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.circuit-row__tag {
  padding: var(--space-1) var(--space-2);
  color: var(--bg);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-15);
  text-transform: uppercase;
  background: var(--accent);
}

/* Its own tap target, --text-dim ink: red stays reserved for the
   accent-as-affordance channel, never a destructive row control. */
.circuit-row__delete {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-min);
  color: var(--text-dim);
  font-size: var(--type-body);
  cursor: pointer;
  background: none;
  border: none;
}

/* Up-next / active dress: one visual treatment, two words (the tag
   text alone tells them apart). */
.circuit-row--tagged {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.circuit-row--tagged .circuit-row__order {
  color: var(--accent);
  border-right-color: var(--accent);
}

.circuit-row--tagged .circuit-row__name {
  color: var(--accent);
}

.circuit-row--dimmed {
  pointer-events: none;
  opacity: var(--dim-disabled);
}
</style>
