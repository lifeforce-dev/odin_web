<script setup lang="ts">
import { onBeforeUnmount } from 'vue';

// Tap-once / hold-to-ramp stepper field: label, minus button, welled
// display value, plus button. One adjust fires on press, then a ramp
// after the hold delay; the parent owns bounds and formatting, so at a
// bound the extra emits are no-ops there.

const HOLD_DELAY_MS = 360;
const RAMP_INTERVAL_MS = 110;

const props = withDefaults(
  defineProps<{
    label: string;
    // The value, already formatted (raw count, m:ss, ...). Optional: a
    // caller that always fills the #value slot (LogSetControl) never
    // reads this prop, so the fallback span renders empty for it.
    display?: string;
    decLabel: string;
    incLabel: string;
    // Emitted as -step / +step per adjust.
    step: number;
    // 'rest' wears the amber rest-readout dress (warning ink + the
    // --glow-rest-value recipe) - the app's rest channel.
    tone?: 'plain' | 'rest';
  }>(),
  { tone: 'plain', display: '' },
);

const emit = defineEmits<{
  adjust: [delta: number];
}>();

// The optional #value slot lets a caller swap the plain display span
// for its own content (e.g. LogSetControl's contenteditable well) while
// still riding this field's shared label, pads, and hold-to-ramp: one
// shared hold-to-ramp control, swapped via this slot instead of minting
// another press-hold machine.
defineSlots<{
  value?: () => unknown;
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
        <slot name="value">
          <span class="stepper-field__value-num">{{ display }}</span>
        </slot>
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

/* Typography lives on the container, not the fallback num span, so
   slotted content (LogSetControl's contenteditable well) inherits the
   same display recipe without restating it. */
.stepper-field__value {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-value);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  background: var(--bg);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--shadow-well);
}

.stepper-field__value--rest {
  color: var(--warning);
  text-shadow: var(--glow-rest-value);
  border-color: var(--warning);
}
</style>
