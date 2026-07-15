<script setup lang="ts">
import { onBeforeUnmount } from 'vue';

// One workout inside a circuit on the workbench, per
// design_reference/components/workbench-slot.html: head (name + SETS //
// REST meta + grip dots) that folds open the inline prescription editor
// (SETS and RECOVER // REST steppers, red-ghost remove). Render + emit
// only: prescription bounds, persistence, and ordering live in
// useWorkbench / domain. This component reports intent and draws the
// state it is given.

withDefaults(
  defineProps<{
    name: string;
    sets: number;
    restSeconds: number;
    open?: boolean;
    dragging?: boolean;
    flash?: boolean;
  }>(),
  {
    open: false,
    dragging: false,
    flash: false,
  },
);

const emit = defineEmits<{
  toggle: [];
  adjust: [field: 'sets' | 'restSeconds', delta: number];
  remove: [];
  'drag-start': [event: PointerEvent];
  'flash-end': [];
}>();

// --- Head: tap-vs-drag (the ref's 10px threshold) -------------------------
// A press that never travels is a toggle; crossing the threshold hands the
// live pointer to the parent, which owns the drag session from there.

const DRAG_THRESHOLD_PX = 10;

// The tracked press's origin and finger. Tracking listens on document, so
// every other finger's moves and lifts arrive here too: without the
// pointerId filter a stray second touch toggles the editor or steals the
// threshold decision (multi-touch is an ordinary accident on a phone).
let pressOrigin: { x: number; y: number } | null = null;
let pressPointerId: number | null = null;

function onHeadPointerDown(event: PointerEvent): void {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  if (pressOrigin !== null) {
    return;
  }
  pressOrigin = { x: event.clientX, y: event.clientY };
  pressPointerId = event.pointerId;
  document.addEventListener('pointermove', onHeadPointerMove);
  document.addEventListener('pointerup', onHeadPointerUp);
  document.addEventListener('pointercancel', onHeadPointerCancel);
}

function onHeadPointerMove(event: PointerEvent): void {
  if (!pressOrigin || event.pointerId !== pressPointerId) {
    return;
  }
  const travelled = Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y);
  if (travelled < DRAG_THRESHOLD_PX) {
    return;
  }
  releaseHeadTracking();
  emit('drag-start', event);
}

function onHeadPointerUp(event: PointerEvent): void {
  if (event.pointerId !== pressPointerId) {
    return;
  }
  releaseHeadTracking();
  emit('toggle');
}

function onHeadPointerCancel(event: PointerEvent): void {
  if (event.pointerId !== pressPointerId) {
    return;
  }
  releaseHeadTracking();
}

function releaseHeadTracking(): void {
  pressOrigin = null;
  pressPointerId = null;
  document.removeEventListener('pointermove', onHeadPointerMove);
  document.removeEventListener('pointerup', onHeadPointerUp);
  document.removeEventListener('pointercancel', onHeadPointerCancel);
}

// --- Steppers: tap-for-one / hold-to-ramp (the ref's `pressable`) ----------
// One adjust on press, then a ramp after the hold delay. The parent owns
// the bounds; at a bound the extra emits are no-ops there, same as the ref.

const HOLD_DELAY_MS = 360;
const RAMP_INTERVAL_MS = 110;

let holdTimer: ReturnType<typeof setTimeout> | null = null;
let rampTimer: ReturnType<typeof setInterval> | null = null;
let steppingPointerId: number | null = null;

function onStepPointerDown(
  event: PointerEvent,
  field: 'sets' | 'restSeconds',
  delta: number,
): void {
  event.preventDefault();
  event.stopPropagation();
  // One live timer pair, always: overwriting these slots would orphan a
  // running ramp interval that keeps writing with no finger down. A new
  // press (any finger) supersedes whatever was stepping.
  stopStepping();
  steppingPointerId = event.pointerId;
  emit('adjust', field, delta);
  holdTimer = setTimeout(() => {
    rampTimer = setInterval(() => emit('adjust', field, delta), RAMP_INTERVAL_MS);
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

onBeforeUnmount(() => {
  stopStepping();
  releaseHeadTracking();
});

// animationend bubbles, so a future descendant animation (a stepper
// pulse, an editor fold) would reach the root handler too and cut a
// running flash short. Scoped styles rename the keyframes to
// slot-flash-<scope-hash>, hence startsWith rather than equality.
function onAnimationEnd(event: AnimationEvent): void {
  if (event.animationName.startsWith('slot-flash')) {
    emit('flash-end');
  }
}

// Editor rest readout is m:ss; the head meta shows raw seconds (ref).
function formatRest(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}
</script>

<template>
  <div
    class="workbench-slot"
    :class="{
      'workbench-slot--open': open,
      'workbench-slot--dragging': dragging,
      'workbench-slot--flash': flash,
    }"
    @animationend="onAnimationEnd"
  >
    <button type="button" class="workbench-slot__head" @pointerdown="onHeadPointerDown">
      <span class="workbench-slot__body">
        <span class="workbench-slot__name">{{ name }}</span>
        <span class="workbench-slot__meta">{{ sets }} sets // rest {{ restSeconds }}s</span>
      </span>
      <span class="workbench-slot__grip" aria-hidden="true">
        <span v-for="dot in 6" :key="dot" class="workbench-slot__grip-dot"></span>
      </span>
    </button>
    <div v-if="open" class="workbench-slot__editor">
      <div class="workbench-slot__fields">
        <div class="workbench-slot__field">
          <span class="workbench-slot__field-label">Sets</span>
          <div class="workbench-slot__stepper">
            <button
              type="button"
              class="workbench-slot__step"
              @pointerdown="onStepPointerDown($event, 'sets', -1)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              &minus;
            </button>
            <span class="workbench-slot__value">
              <span class="workbench-slot__value-num">{{ sets }}</span>
            </span>
            <button
              type="button"
              class="workbench-slot__step"
              @pointerdown="onStepPointerDown($event, 'sets', 1)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              +
            </button>
          </div>
        </div>
        <div class="workbench-slot__field">
          <span class="workbench-slot__field-label">Recover // Rest</span>
          <div class="workbench-slot__stepper">
            <button
              type="button"
              class="workbench-slot__step"
              @pointerdown="onStepPointerDown($event, 'restSeconds', -15)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              -15
            </button>
            <span class="workbench-slot__value workbench-slot__value--rest">
              <span class="workbench-slot__value-num">{{ formatRest(restSeconds) }}</span>
            </span>
            <button
              type="button"
              class="workbench-slot__step"
              @pointerdown="onStepPointerDown($event, 'restSeconds', 15)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              +15
            </button>
          </div>
        </div>
      </div>
      <button type="button" class="workbench-slot__remove" @click="emit('remove')">
        Remove from circuit
      </button>
    </div>
  </div>
</template>

<style scoped>
.workbench-slot {
  background: var(--surface);
  border: var(--hairline) solid var(--border);

  /* The accent spine: editable, reorderable entry (--stamp weight). */
  border-left: var(--stamp) solid var(--accent);
}

.workbench-slot--dragging {
  opacity: 0.35;
}

.workbench-slot--flash {
  animation: slot-flash var(--motion-flash) ease-out;
}

/* Flash-on-add. The left spine is pinned back to accent at both ends so
   it never fades with the other sides (the ref lets it sweep - a ref
   defect, not a spec). */
@keyframes slot-flash {
  0% {
    border-color: var(--accent);
    box-shadow: var(--glow-flash);
  }

  100% {
    border-color: var(--border);
    border-left-color: var(--accent);
    box-shadow: none;
  }
}

.workbench-slot__head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3) var(--space-4) var(--space-3) 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;

  /* The drag handle: page scroll must not steal the gesture. THE touch
     risk this task validates on hardware (feature gotcha; overrides the
     base.css button default of manipulation). */
  touch-action: none;
}

.workbench-slot__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding-left: var(--space-4);
}

.workbench-slot__name {
  color: var(--text);
  font-size: var(--type-data);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.workbench-slot__meta {
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

/* Grip: six dots signalling drag-to-reorder. Dim so red stays reserved. */
.workbench-slot__grip {
  --grip-dot: 3px;

  display: grid;
  flex: none;
  grid-template-columns: repeat(2, var(--grip-dot));
  gap: var(--space-1);
  padding: var(--space-2);
}

.workbench-slot__grip-dot {
  width: var(--grip-dot);
  height: var(--grip-dot);
  background: var(--text-dim);
  border-radius: 50%;
}

.workbench-slot__editor {
  padding: 0 var(--space-4) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

.workbench-slot__fields {
  display: flex;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}

.workbench-slot__field {
  flex: 1;
}

.workbench-slot__field-label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.workbench-slot__stepper {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.workbench-slot__step {
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

.workbench-slot__step:active {
  background: var(--border);
  transform: scale(0.96);
}

.workbench-slot__value {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  background: var(--bg);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--shadow-well);
}

.workbench-slot__value-num {
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-value);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.workbench-slot__value--rest {
  border-color: var(--warning);
}

.workbench-slot__value--rest .workbench-slot__value-num {
  color: var(--warning);
  text-shadow: var(--glow-rest-value);
}

.workbench-slot__remove {
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-3);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  cursor: pointer;
  background: transparent;
  border: var(--hairline) solid var(--accent);
  transition: background var(--motion-press);
}

.workbench-slot__remove:active {
  background: var(--accent-soft);
}
</style>
