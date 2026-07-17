<script setup lang="ts">
import { computed } from 'vue';

// The set-progress readout: one numbered box per prescribed set. Red
// is the lifting channel here, deliberately not green - a logged set
// is not "done-done". done = solid accent fill, current = background
// fill-pulse (never a glow), pending = dim outline. Display-only: the
// boxes ARE the count, so the row speaks one label and the boxes stay
// decorative.

const props = defineProps<{
  sets: number;
  loggedSets: number;
}>();

type BoxState = 'done' | 'current' | 'pending';

const boxes = computed<BoxState[]>(() =>
  Array.from({ length: props.sets }, (_, index) => {
    if (index < props.loggedSets) {
      return 'done';
    }
    return index === props.loggedSets ? 'current' : 'pending';
  }),
);

const label = computed(() => `${props.loggedSets} of ${props.sets} sets logged`);
</script>

<template>
  <div class="set-progress" role="img" :aria-label="label">
    <span
      v-for="(state, index) in boxes"
      :key="index"
      class="set-progress__box"
      :class="`set-progress__box--${state}`"
      aria-hidden="true"
    >
      {{ index + 1 }}
    </span>
  </div>
</template>

<style scoped>
.set-progress {
  /* Box size: the ref draws 56px (a >=52px target); a local knob, the
     --reg-mark idiom. The ref's 10px gap ships as the rhythm's 12. */
  --set-box: 56px;

  display: flex;
  gap: var(--space-3);
  justify-content: center;
}

.set-progress__box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--set-box);
  height: var(--set-box);
  color: var(--text-dim);
  font-family: var(--font-display);
  font-size: var(--type-display-badge);
  background: var(--surface);
  border: var(--rule) solid var(--border-strong);
}

.set-progress__box--done {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

/* The current set blinks between the soft and near-solid accent
   washes via background FILL - no glow, no halo. Reduced motion keeps
   the accent border + soft wash as the static tell. */
.set-progress__box--current {
  color: var(--text);
  background: var(--accent-soft);
  border-color: var(--accent);
  animation: set-fill-pulse var(--motion-pulse) ease-in-out infinite;
}

@keyframes set-fill-pulse {
  0%,
  100% {
    background: var(--accent-soft);
  }

  50% {
    background: var(--accent-pulse);
  }
}

@media (prefers-reduced-motion: reduce) {
  .set-progress__box--current {
    animation: none;
  }
}
</style>
