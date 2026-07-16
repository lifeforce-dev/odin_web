<script setup lang="ts">
import { onBeforeUnmount } from 'vue';

// Tap-once / hold-to-ramp stepper field (the ref's `pressable`): label,
// minus button, welled display value, plus button. One adjust fires on
// press, then a ramp after the hold delay; the parent owns bounds and
// formatting, so at a bound the extra emits are no-ops there, same as
// the ref. Extracted from WorkoutCard (its two steppers were the same
// control twice over); epic 03's log-set thumb pads are the same
// control family and the known next consumer.

const HOLD_DELAY_MS = 360;
const RAMP_INTERVAL_MS = 110;

const props = withDefaults(
  defineProps<{
    label: string;
    // The value, already formatted (raw count, m:ss, ...).
    display: string;
    decLabel: string;
    incLabel: string;
    // Emitted as -step / +step per adjust.
    step: number;
    // 'rest' wears the amber rest-readout dress (warning ink + the
    // --glow-rest-value recipe) - the app's rest channel.
    tone?: 'plain' | 'rest';
  }>(),
  { tone: 'plain' },
);

const emit = defineEmits<{
  adjust: [delta: number];
}>();

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let rampTimer: ReturnType<typeof setInterval> | null = null;
let steppingPointerId: number | null = null;

function onStepPointerDown(event: PointerEvent, delta: number): void {
  event.preventDefault();
  event.stopPropagation();
  // One live timer pair, always: overwriting these slots would orphan a
  // running ramp interval that keeps writing with no finger down. A new
  // press (any finger) supersedes whatever was stepping.
  stopStepping();
  steppingPointerId = event.pointerId;
  emit('adjust', delta);
  holdTimer = setTimeout(() => {
    rampTimer = setInterval(() => emit('adjust', delta), RAMP_INTERVAL_MS);
  }, HOLD_DELAY_MS);
}

// Release/leave/cancel stop the ramp only for the stepping finger: a
// second finger brushing across the button must not end an active hold.
function onStepPointerEnd(event: PointerEvent): void {
  if (event.pointerId !== steppingPointerId) {
    return;
  }
  stopStepping();
}

function stopStepping(): void {
  if (holdTimer !== null) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (rampTimer !== null) {
    clearInterval(rampTimer);
    rampTimer = null;
  }
  steppingPointerId = null;
}

onBeforeUnmount(stopStepping);
</script>

<template>
  <div class="stepper-field">
    <span class="stepper-field__label">{{ label }}</span>
    <div class="stepper-field__stepper">
      <button
        type="button"
        class="stepper-field__step"
        @pointerdown="onStepPointerDown($event, -props.step)"
        @pointerup="onStepPointerEnd"
        @pointerleave="onStepPointerEnd"
        @pointercancel="onStepPointerEnd"
      >
        {{ decLabel }}
      </button>
      <span class="stepper-field__value" :class="{ 'stepper-field__value--rest': tone === 'rest' }">
        <span class="stepper-field__value-num">{{ display }}</span>
      </span>
      <button
        type="button"
        class="stepper-field__step"
        @pointerdown="onStepPointerDown($event, props.step)"
        @pointerup="onStepPointerEnd"
        @pointerleave="onStepPointerEnd"
        @pointercancel="onStepPointerEnd"
      >
        {{ incLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.stepper-field__label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.stepper-field__stepper {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.stepper-field__step {
  display: flex;
  flex: 0 0 var(--tap-min);
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-data);
  font-weight: 800;
  cursor: pointer;
  background: var(--surface-raise);
  border: var(--hairline) solid var(--border-strong);
  transition:
    background var(--motion-press) ease,
    transform var(--motion-press) ease;
}

.stepper-field__step:active {
  background: var(--border);
  transform: scale(0.96);
}

.stepper-field__value {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  background: var(--bg);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--shadow-well);
}

.stepper-field__value-num {
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-value);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.stepper-field__value--rest {
  border-color: var(--warning);
}

.stepper-field__value--rest .stepper-field__value-num {
  color: var(--warning);
  text-shadow: var(--glow-rest-value);
}
</style>
