<script setup lang="ts">
import type { ExerciseProgress } from '@/domain/workout';

// The styleguide's circuit card: one exercise tile on the workout
// screen's select grid - the app's set button. Render + emit only; the
// screen derives progress from session facts and passes it down.
// States: pressed = Lock On (corner reticle snaps inward, accent);
// in-progress = logged/total fraction on the accent channel (red =
// this is happening); done = Clean Outline stamp, non-interactive.

const props = withDefaults(
  defineProps<{
    name: string;
    sets: number;
    loggedSets?: number;
    progress?: ExerciseProgress;
  }>(),
  {
    loggedSets: 0,
    progress: 'pending',
  },
);

const emit = defineEmits<{
  select: [];
}>();

function handleSelect(): void {
  if (props.progress !== 'done') {
    emit('select');
  }
}
</script>

<template>
  <button
    type="button"
    class="circuit-card"
    :class="{
      'circuit-card--in-progress': progress === 'in-progress',
      'circuit-card--done': progress === 'done',
    }"
    :disabled="progress === 'done'"
    @click="handleSelect"
  >
    <span
      v-for="corner in ['tl', 'tr', 'bl', 'br']"
      :key="corner"
      class="circuit-card__tick"
      :class="`circuit-card__tick--${corner}`"
      aria-hidden="true"
    ></span>
    <span class="circuit-card__name">{{ name }}</span>
    <span v-if="progress === 'in-progress'" class="circuit-card__sets">
      <span class="circuit-card__logged">{{ loggedSets }}/{{ sets }}</span> sets
    </span>
    <span v-else class="circuit-card__sets">{{ sets }} sets</span>
    <span v-if="progress === 'done'" class="circuit-card__stamp" aria-hidden="true">
      <span class="circuit-card__stamp-word">Done</span>
    </span>
  </button>
</template>

<style scoped>
.circuit-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: var(--circuit-card-min);
  padding: var(--space-3);
  overflow: hidden;
  text-align: left;
  cursor: pointer;
  background: var(--surface);
  border: var(--hairline) solid var(--border);
  transition:
    border-color var(--motion-press),
    box-shadow var(--motion-press);
}

/* Registration reticle: four corner ticks that read as a targeting
   frame at rest and lock on under the finger. */
.circuit-card__tick {
  position: absolute;
  width: var(--space-2);
  height: var(--space-2);
  pointer-events: none;
  border-color: var(--border-strong);
  transition: all var(--motion-press);
}

.circuit-card__tick--tl {
  top: var(--space-1);
  left: var(--space-1);
  border-top: var(--hairline) solid;
  border-left: var(--hairline) solid;
}

.circuit-card__tick--tr {
  top: var(--space-1);
  right: var(--space-1);
  border-top: var(--hairline) solid;
  border-right: var(--hairline) solid;
}

.circuit-card__tick--bl {
  bottom: var(--space-1);
  left: var(--space-1);
  border-bottom: var(--hairline) solid;
  border-left: var(--hairline) solid;
}

.circuit-card__tick--br {
  bottom: var(--space-1);
  right: var(--space-1);
  border-bottom: var(--hairline) solid;
  border-right: var(--hairline) solid;
}

.circuit-card__name {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-data);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.circuit-card__sets {
  margin-top: var(--space-2);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
}

/* In-progress: the logged fraction rides the accent channel (red =
   this is happening) over an accent left edge; quiet next to the
   done stamp on purpose - there are still reps to go. */
.circuit-card--in-progress {
  border-left: var(--rule) solid var(--accent);
}

.circuit-card__logged {
  color: var(--accent);
  font-weight: 700;
}

/* Completed: Clean Outline stamp. The card recedes hard so the single
   green outline is the only thing that reads; green pairs with the
   word + shape, so it survives grayscale. (Before the press rules
   only for specificity ordering - a done card is disabled and never
   presses.) */
.circuit-card--done {
  cursor: default;
  border-color: var(--border);
}

.circuit-card--done .circuit-card__tick {
  display: none;
}

.circuit-card--done .circuit-card__name,
.circuit-card--done .circuit-card__sets {
  opacity: 0.14;
}

/* Lock On: ticks snap inward, thicken, and go accent while an inset
   glow lights the card. No scale - the reticle is the press. */
.circuit-card:active {
  border-color: var(--accent);
  box-shadow: var(--glow-lock-on);
}

.circuit-card:active .circuit-card__tick {
  width: var(--space-3);
  height: var(--space-3);
  border-color: var(--accent);
  border-width: var(--rule);
}

.circuit-card:active .circuit-card__tick--tl {
  top: var(--space-2);
  left: var(--space-2);
}

.circuit-card:active .circuit-card__tick--tr {
  top: var(--space-2);
  right: var(--space-2);
}

.circuit-card:active .circuit-card__tick--bl {
  bottom: var(--space-2);
  left: var(--space-2);
}

.circuit-card:active .circuit-card__tick--br {
  bottom: var(--space-2);
  right: var(--space-2);
}

.circuit-card__stamp {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.circuit-card__stamp-word {
  padding: 0 var(--space-3);
  color: var(--lock);
  font-family: var(--font-display);
  font-size: var(--type-display-stamp);
  line-height: 1.15;
  letter-spacing: var(--tracking-4);
  text-transform: uppercase;
  border: var(--stamp) solid var(--lock);
  transform: rotate(-8deg);
}
</style>
