<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';

import { useDragHandle } from '@/composables/useDragHandle';

// THE workout card (task 02-07): one control for both workbench zones,
// because a workout is one thing wherever it sits - name + sets/rest on
// the identity itself, a circuit is just an ordered list pointing at it.
// Anatomy: head (name + SETS // REST meta; click folds the prescription
// editor open, press-and-hold turns the name editable) and the grip -
// the drag surface. Render + emit only: bounds, persistence, and
// ordering live in useWorkbench / domain. The parent says where the card
// is via `addable` (pool: ADD TO CIRCUIT in the editor) and `removable`
// (circuit: REMOVE FROM CIRCUIT in the editor); both are one button in
// the same slot of the same fold, so the two placements are identical
// until you open one.

const props = withDefaults(
  defineProps<{
    name: string;
    sets: number;
    restSeconds: number;
    open?: boolean;
    dragging?: boolean;
    flash?: boolean;
    addable?: boolean;
    removable?: boolean;
    // Relaxes the grip rule: the body lifts the card too. The parent
    // sets it when this card's list has nothing to scroll, so the
    // gesture is free to mean drag (see useOverflow).
    dragAnywhere?: boolean;
    // The parent's verdict on a rejected rename (name taken).
    notice?: string | null;
  }>(),
  {
    open: false,
    dragging: false,
    flash: false,
    addable: false,
    removable: false,
    dragAnywhere: false,
    notice: null,
  },
);

const emit = defineEmits<{
  toggle: [];
  adjust: [field: 'sets' | 'restSeconds', delta: number];
  add: [];
  remove: [];
  rename: [name: string];
  'drag-start': [event: PointerEvent];
  'flash-end': [];
}>();

// --- Grip: the drag handle -------------------------------------------------
// Always draggable. Under `dragAnywhere` the head is a second handle -
// a separate session, because the two can be pressed independently.

const gripDrag = useDragHandle({ onDragStart: (event) => startDrag(event, 'grip') });
const bodyDrag = useDragHandle({ onDragStart: (event) => startDrag(event, 'body') });

// An open rename owns the card: nothing lifts it out from under the
// entry. The body handle is why this guard exists - the very press that
// matured INTO the rename is still being tracked (useDragHandle listens
// on document, so swapping the head out for the entry did not end its
// session), so without it the same finger walks from renaming straight
// into a drag.
function startDrag(event: PointerEvent, handle: 'grip' | 'body'): void {
  if (renaming.value) {
    return;
  }
  bodyLifted = handle === 'body';
  emit('drag-start', event);
}

// --- Head: click folds the editor, press-and-hold renames -------------------
// The hold matures only while the finger stays put (within the slop);
// movement hands the gesture to native scroll (or, under dragAnywhere,
// to the drag), a quick release is the fold toggle. Document listeners
// filter to the pressing finger.

const RENAME_HOLD_MS = 500;
const RENAME_SLOP_PX = 10;

const renaming = ref(false);
const renameEl = ref<HTMLElement | null>(null);

let holdPointerId: number | null = null;
let holdOrigin: { x: number; y: number } | null = null;
let renameHoldTimer: ReturnType<typeof setTimeout> | null = null;

// A body drag still ends in a click on the head whenever the finger
// happens to release back over it (nothing scrolled to swallow it), and
// that click must not also fold the card open. Cleared by the next
// press, so a release that lands elsewhere cannot poison a later tap.
let bodyLifted = false;

function onHeadPointerDown(event: PointerEvent): void {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  if (holdPointerId !== null || renaming.value) {
    return;
  }
  bodyLifted = false;
  if (props.dragAnywhere) {
    bodyDrag.onPointerDown(event);
  }
  holdPointerId = event.pointerId;
  holdOrigin = { x: event.clientX, y: event.clientY };
  document.addEventListener('pointermove', onHoldPointerMove);
  document.addEventListener('pointerup', releaseHold);
  document.addEventListener('pointercancel', releaseHold);
  renameHoldTimer = setTimeout(() => {
    releaseHoldTracking();
    void startRename();
  }, RENAME_HOLD_MS);
}

function onHoldPointerMove(event: PointerEvent): void {
  if (!holdOrigin || event.pointerId !== holdPointerId) {
    return;
  }
  const travelled = Math.hypot(event.clientX - holdOrigin.x, event.clientY - holdOrigin.y);
  if (travelled >= RENAME_SLOP_PX) {
    releaseHoldTracking();
  }
}

function releaseHold(event: PointerEvent): void {
  if (event.pointerId !== holdPointerId) {
    return;
  }
  releaseHoldTracking();
}

function releaseHoldTracking(): void {
  if (renameHoldTimer !== null) {
    clearTimeout(renameHoldTimer);
    renameHoldTimer = null;
  }
  holdPointerId = null;
  holdOrigin = null;
  document.removeEventListener('pointermove', onHoldPointerMove);
  document.removeEventListener('pointerup', releaseHold);
  document.removeEventListener('pointercancel', releaseHold);
}

function onHeadClick(): void {
  // The click after a matured hold can still land on the old head node
  // before the rename entry replaces it; it must not also fold the card.
  if (renaming.value || bodyLifted) {
    return;
  }
  emit('toggle');
}

// The entry is contenteditable, so Vue must never patch its children -
// the name is seeded imperatively (log-set gotcha: no v-model here).
async function startRename(): Promise<void> {
  renaming.value = true;
  await nextTick();
  if (renameEl.value) {
    renameEl.value.textContent = props.name;
    renameEl.value.focus();
  }
}

function commitRename(): void {
  const entered = renameEl.value?.textContent?.trim() ?? '';
  renaming.value = false;
  if (entered.length > 0 && entered !== props.name) {
    emit('rename', entered);
  }
}

function cancelRename(): void {
  renaming.value = false;
}

// Tapping off the entry abandons the rename (commit stays explicit:
// check or Enter; the check commits on pointerdown, beating the blur).
function onRenameFocusOut(event: FocusEvent): void {
  const stillInside =
    event.relatedTarget instanceof Node &&
    renameEl.value?.parentElement?.contains(event.relatedTarget);
  if (!stillInside) {
    cancelRename();
  }
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
  releaseHoldTracking();
});

// animationend bubbles, so a future descendant animation (a stepper
// pulse, an editor fold) would reach the root handler too and cut a
// running flash short. Scoped styles rename the keyframes to
// card-flash-<scope-hash>, hence startsWith rather than equality.
function onAnimationEnd(event: AnimationEvent): void {
  if (event.animationName.startsWith('card-flash')) {
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
    class="workout-card"
    :class="{
      'workout-card--open': open,
      'workout-card--dragging': dragging,
      'workout-card--flash': flash,
    }"
    @animationend="onAnimationEnd"
  >
    <div class="workout-card__header">
      <button
        v-if="!renaming"
        type="button"
        class="workout-card__head"
        :class="{ 'workout-card__head--draggable': dragAnywhere }"
        @click="onHeadClick"
        @pointerdown="onHeadPointerDown"
      >
        <span class="workout-card__body">
          <span class="workout-card__name">{{ name }}</span>
          <span class="workout-card__meta">{{ sets }} sets // rest {{ restSeconds }}s</span>
        </span>
      </button>
      <div v-else class="workout-card__rename" @focusout="onRenameFocusOut">
        <span
          ref="renameEl"
          class="workout-card__rename-entry"
          contenteditable="true"
          role="textbox"
          aria-label="Workout name"
          @keydown.enter.prevent="commitRename"
          @keydown.esc="cancelRename"
        ></span>
        <button
          type="button"
          class="workout-card__rename-confirm"
          aria-label="Rename workout"
          @pointerdown.prevent="commitRename"
          @click="commitRename"
        >
          &check;
        </button>
      </div>
      <span class="workout-card__grip" aria-hidden="true" @pointerdown="gripDrag.onPointerDown">
        <span v-for="dot in 6" :key="dot" class="workout-card__grip-dot"></span>
      </span>
    </div>
    <p v-if="notice" class="workout-card__notice">{{ notice }}</p>
    <div v-if="open" class="workout-card__editor">
      <div class="workout-card__fields">
        <div class="workout-card__field">
          <span class="workout-card__field-label">Sets</span>
          <div class="workout-card__stepper">
            <button
              type="button"
              class="workout-card__step"
              @pointerdown="onStepPointerDown($event, 'sets', -1)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              &minus;
            </button>
            <span class="workout-card__value">
              <span class="workout-card__value-num">{{ sets }}</span>
            </span>
            <button
              type="button"
              class="workout-card__step"
              @pointerdown="onStepPointerDown($event, 'sets', 1)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              +
            </button>
          </div>
        </div>
        <div class="workout-card__field">
          <span class="workout-card__field-label">Recover // Rest</span>
          <div class="workout-card__stepper">
            <button
              type="button"
              class="workout-card__step"
              @pointerdown="onStepPointerDown($event, 'restSeconds', -15)"
              @pointerup="onStepPointerEnd"
              @pointerleave="onStepPointerEnd"
              @pointercancel="onStepPointerEnd"
            >
              -15
            </button>
            <span class="workout-card__value workout-card__value--rest">
              <span class="workout-card__value-num">{{ formatRest(restSeconds) }}</span>
            </span>
            <button
              type="button"
              class="workout-card__step"
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
      <!-- The card's one placement action, same slot either way: the
           pool card puts it in, the circuit card takes it out. -->
      <button v-if="addable" type="button" class="workout-card__add" @click="emit('add')">
        Add to circuit
      </button>
      <button v-if="removable" type="button" class="workout-card__remove" @click="emit('remove')">
        Remove from circuit
      </button>
    </div>
  </div>
</template>

<style scoped>
.workout-card {
  background: var(--surface);
  border: var(--hairline) solid var(--border);

  /* The accent spine: editable, movable entry (--stamp weight). */
  border-left: var(--stamp) solid var(--accent);
}

.workout-card--dragging {
  opacity: 0.35;
}

.workout-card--flash {
  animation: card-flash var(--motion-flash) ease-out;
}

/* Flash-on-add. The left spine is pinned back to accent at both ends so
   it never fades with the other sides (the ref lets it sweep - a ref
   defect, not a spec). */
@keyframes card-flash {
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

.workout-card__header {
  display: flex;
  align-items: stretch;
}

/* A plain tap target: swiping it pans the zone (base.css buttons are
   touch-action: manipulation); only the grip owns the drag. */
.workout-card__head {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  padding: var(--space-3) 0;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: none;
  border: none;
}

/* Nothing to scroll in this card's list, so the swipe is free to mean
   drag: the head becomes a second handle and takes touch-action with it
   (the browser must not contest a gesture it has nowhere to pan). */
.workout-card__head--draggable {
  cursor: grab;
  touch-action: none;
}

.workout-card__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding-left: var(--space-4);
}

.workout-card__name {
  color: var(--text);
  font-size: var(--type-data);
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.workout-card__meta {
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

/* Press-and-hold swapped the name for this entry, in place. */
.workout-card__rename {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  min-width: 0;
  margin-left: var(--space-4);
  border: var(--hairline) solid var(--border-strong);
}

.workout-card__rename-entry {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 1ch;
  min-height: var(--tap-min);
  padding: 0 var(--space-3);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-data);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
  caret-color: var(--warning);
  outline: none;
}

.workout-card__rename-confirm {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-min);
  color: var(--lock);
  font-size: var(--type-data-lg);
  font-weight: 800;
  cursor: pointer;
  background: none;
  border: none;
}

/* Grip: six dots, the drag surface (02-07 rule) - the browser must not
   contest the gesture here, so touch-action: none lives on this and on
   nothing else unless the list has no scroll to lose (see the
   --draggable head above). Full row height + tap-min width keeps the
   handle thumbable while the dots stay small. Dim so red stays
   reserved. */
.workout-card__grip {
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

.workout-card__grip-dot {
  width: var(--grip-dot);
  height: var(--grip-dot);
  background: var(--text-dim);
  border-radius: 50%;
}

/* The parent's verdict on a rejected rename (name taken). */
.workout-card__notice {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: 1.7;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.workout-card__editor {
  padding: 0 var(--space-4) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

.workout-card__fields {
  display: flex;
  gap: var(--space-3);
  margin: var(--space-3) 0;
}

.workout-card__field {
  flex: 1;
}

.workout-card__field-label {
  display: block;
  margin-bottom: var(--space-2);
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.workout-card__stepper {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.workout-card__step {
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

.workout-card__step:active {
  background: var(--border);
  transform: scale(0.96);
}

.workout-card__value {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  background: var(--bg);
  border: var(--hairline) solid var(--border);
  box-shadow: var(--shadow-well);
}

.workout-card__value-num {
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-value);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.workout-card__value--rest {
  border-color: var(--warning);
}

.workout-card__value--rest .workout-card__value-num {
  color: var(--warning);
  text-shadow: var(--glow-rest-value);
}

/* The placement action, red-ghost: exactly one of these renders, in the
   same slot, so ADD and REMOVE are the same button wearing the label
   the placement earns. */
.workout-card__add,
.workout-card__remove {
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

.workout-card__add:active,
.workout-card__remove:active {
  background: var(--accent-soft);
}
</style>
