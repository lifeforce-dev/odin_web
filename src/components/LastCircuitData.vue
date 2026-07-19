<script setup lang="ts">
// The last-circuit-data readout: a labeled HUD box with big centered
// reps/weight numerals split by a divider. Render-only; the screen
// supplies the facts. The unit rides its own prop so copy and data
// never fuse in a template string. Pass label="" to hide the eyebrow.

withDefaults(
  defineProps<{
    reps: number;
    weight: number;
    weightUnit: 'lb' | 'kg';
    label?: string;
  }>(),
  {
    label: 'Last Session',
  },
);
</script>

<template>
  <div class="last-circuit">
    <p v-if="label !== ''" class="last-circuit__eyebrow">{{ label }}</p>
    <div class="last-circuit__readout">
      <div class="last-circuit__item">
        <span class="last-circuit__label">Reps</span>
        <span class="last-circuit__value">{{ reps }}</span>
      </div>
      <span class="last-circuit__divider" aria-hidden="true"></span>
      <div class="last-circuit__item">
        <span class="last-circuit__label">Weight</span>
        <span class="last-circuit__value">
          {{ weight }}<span class="last-circuit__unit">{{ weightUnit }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.last-circuit {
  /* Registration-mark size and the divider's height: local knobs, same
     idiom as the library group header's 7px chip. The divider is sized
     against the --type-display-stat numerals (40px + breathing room);
     retune them together. */
  --reg-mark: 7px;
  --divider-height: 42px;

  position: relative;
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border: var(--hairline) solid var(--border);
}

/* Redline registration marks, opposite corners. The zeroed border
   carries style + ink for every side, so the corner rules set widths
   only - a border SHORTHAND here would silently reset the ink to
   currentcolor. */
.last-circuit::before,
.last-circuit::after {
  position: absolute;
  width: var(--reg-mark);
  height: var(--reg-mark);
  content: '';
  border: 0 solid var(--border-strong);
}

.last-circuit::before {
  top: var(--space-1);
  right: var(--space-1);
  border-top-width: var(--hairline);
  border-right-width: var(--hairline);
}

.last-circuit::after {
  bottom: var(--space-1);
  left: var(--space-1);
  border-bottom-width: var(--hairline);
  border-left-width: var(--hairline);
}

.last-circuit__eyebrow {
  margin: 0 0 var(--space-3);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  letter-spacing: var(--tracking-3);
  text-transform: uppercase;
}

.last-circuit__readout {
  display: flex;
  align-items: center;
  justify-content: space-around;
  text-align: center;
}

.last-circuit__item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.last-circuit__label {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.last-circuit__value {
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-stat);
  line-height: 1;
}

.last-circuit__unit {
  margin-left: var(--space-1);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-data);
  letter-spacing: var(--tracking-1);
}

.last-circuit__divider {
  width: var(--hairline);
  height: var(--divider-height);
  background: var(--border);
}
</style>
