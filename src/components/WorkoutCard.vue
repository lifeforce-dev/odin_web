<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import GripHandle from '@/components/GripHandle.vue';
import InlineNameEntry from '@/components/InlineNameEntry.vue';
import StepperField from '@/components/StepperField.vue';
import { useBodyHandle } from '@/composables/useBodyHandle';

// The workout card: one control for both workbench zones, because a
// workout is one thing wherever it sits - name + sets/rest live on the
// identity, a circuit is just an ordered list pointing at it. Anatomy:
// head (name + meta; click folds the prescription editor open,
// press-and-hold turns the name editable) and the grip, the drag
// surface. Render + emit only: bounds, persistence, and ordering live
// in useWorkbench / domain. The parent says where the card is via
// `addable` (pool) and `removable` (circuit); both are one button in
// the same slot of the same fold.
//
// One identity, two dress states: the circuit variant is the committed
// card - surface plate, accent spine, two-line head; the pool variant
// is cold stock - bg plate, steel hairline, one compressed line at
// tap-min. Behavior is identical in both. Opening a pool card
// necessarily grows it (the fold needs the room).

const props = withDefaults(
  defineProps<{
    name: string;
    sets: number;
    restSeconds: number;
    // The dress state (see above): circuit = committed, pool = stock.
    variant?: 'circuit' | 'pool';
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
    variant: 'circuit',
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

// The grip is always a drag surface; the head joins it under
// dragAnywhere (a separate session, because the two can be pressed
// independently). An open rename owns the card: nothing lifts it out
// from under the entry - the canDrag gate matters because the very
// press that matured into the rename is still tracked on document.

const renaming = ref(false);

const bodyHandle = useBodyHandle({
  dragAnywhere: () => props.dragAnywhere,
  canDrag: () => !renaming.value,
  onDragStart: (event) => emit('drag-start', event),
  onTap: () => {
    if (!renaming.value) {
      emit('toggle');
    }
  },
});

function onGripDrag(event: PointerEvent): void {
  if (!renaming.value) {
    emit('drag-start', event);
  }
}

// The rename hold matures only while the finger stays put (within the
// slop); movement hands the gesture to native scroll (or, under
// dragAnywhere, to the drag), and a quick release is the fold toggle.
// Document listeners filter to the pressing finger.

const RENAME_HOLD_MS = 500;
const RENAME_SLOP_PX = 10;

let holdPointerId: number | null = null;
let holdOrigin: { x: number; y: number } | null = null;
let renameHoldTimer: ReturnType<typeof setTimeout> | null = null;

function onHeadPointerDown(event: PointerEvent): void {
  if (event.button !== undefined && event.button !== 0) {
    return;
  }
  if (holdPointerId !== null || renaming.value) {
    return;
  }
  bodyHandle.onPointerDown(event);
  holdPointerId = event.pointerId;
  holdOrigin = { x: event.clientX, y: event.clientY };
  document.addEventListener('pointermove', onHoldPointerMove);
  document.addEventListener('pointerup', releaseHold);
  document.addEventListener('pointercancel', releaseHold);
  renameHoldTimer = setTimeout(() => {
    releaseHoldTracking();
    renaming.value = true;
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

// The entry machine itself (seeding, commit/cancel keys, focusout) is
// InlineNameEntry; this only decides what a commit means for a rename.
function onRenameCommit(entered: string): void {
  renaming.value = false;
  if (entered.length > 0 && entered !== props.name) {
    emit('rename', entered);
  }
}

onBeforeUnmount(releaseHoldTracking);

// animationend bubbles, so a future descendant animation (a stepper
// pulse, an editor fold) would reach the root handler too and cut a
// running flash short. Scoped styles rename the keyframes to
// card-flash-<scope-hash>, hence startsWith rather than equality.
function onAnimationEnd(event: AnimationEvent): void {
  if (event.animationName.startsWith('card-flash')) {
    emit('flash-end');
  }
}

// Editor rest readout is m:ss; the head meta shows raw seconds.
function formatRest(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// The stock line has no second line to spend, so its meta compresses
// (3X // 60S); the committed card states it in full.
const metaText = computed(() =>
  props.variant === 'pool'
    ? `${props.sets}x // ${props.restSeconds}s`
    : `${props.sets} sets // rest ${props.restSeconds}s`,
);
</script>

<template>
  <div
    class="workout-card"
    :class="{
      'workout-card--pool': variant === 'pool',
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
        @click="bodyHandle.onClick"
        @pointerdown="onHeadPointerDown"
      >
        <span class="workout-card__body">
          <span class="workout-card__name">{{ name }}</span>
          <span class="workout-card__meta">{{ metaText }}</span>
        </span>
      </button>
      <InlineNameEntry
        v-else
        class="workout-card__rename"
        :seed="name"
        size="data"
        entry-label="Workout name"
        confirm-label="Rename workout"
        @commit="onRenameCommit"
        @cancel="renaming = false"
      />
      <GripHandle @drag-start="onGripDrag" />
    </div>
    <p v-if="notice" class="workout-card__notice">{{ notice }}</p>
    <div v-if="open" class="workout-card__editor">
      <div class="workout-card__fields">
        <StepperField
          class="workout-card__field"
          label="Sets"
          :display="String(sets)"
          :dec-label="'\u2212'"
          inc-label="+"
          :step="1"
          @adjust="(delta) => emit('adjust', 'sets', delta)"
        />
        <StepperField
          class="workout-card__field"
          label="Recover // Rest"
          :display="formatRest(restSeconds)"
          dec-label="-15"
          inc-label="+15"
          :step="15"
          tone="rest"
          @adjust="(delta) => emit('adjust', 'restSeconds', delta)"
        />
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

  /* The origin row yields as ground the moment its card lifts;
     stepped, not eased. */
  transition: opacity calc(var(--motion-morph) * 0.6) steps(2, end);
}

.workout-card--dragging {
  opacity: 0.35;
}

.workout-card--flash {
  animation: card-flash var(--motion-flash) ease-out;
}

/* Flash-on-add. The left spine is pinned back to accent at both ends
   so it never fades with the other sides. */
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

/* The pool dress: stock on the shelf goes cold - bg plate, steel
   hairline edge instead of the accent spine, name and meta compressed
   onto one tap-min line. Color says committed-vs-stock, height says
   installed-vs-loose; the accent arrives with membership via the
   landing flash, never in flight. */
.workout-card--pool {
  background: var(--bg);
  border-left: var(--hairline) solid var(--supply);
}

.workout-card--pool .workout-card__head {
  min-height: var(--tap-min);
}

.workout-card--pool .workout-card__body {
  flex-direction: row;
  gap: var(--space-3);
  align-items: center;
}

.workout-card--pool .workout-card__name {
  flex: 1 1 auto;
  overflow: hidden;
  color: var(--text-soft);
  font-size: var(--type-body);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.workout-card--pool .workout-card__meta {
  flex: none;
  font-size: var(--type-micro);
}

/* Press-and-hold swapped the name for the entry, in place; the entry's
   dress is InlineNameEntry's - this frames and places it. */
.workout-card__rename {
  margin-left: var(--space-4);
  border: var(--hairline) solid var(--border-strong);
}

/* The parent's verdict on a rejected rename (name taken). Same recipe
   as PoolCreateRow's .pool-create__notice - these move together (only
   the padding differs, to sit inside the card body). */
.workout-card__notice {
  margin: 0;
  padding: 0 var(--space-4) var(--space-2);
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
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

/* Reduced motion: the flash is a confirmation cue, not information the
   card lacks (it is visibly in the list); with the animation gone,
   animationend never fires, which the parent's null-toggle rearm
   already tolerates. */
@media (prefers-reduced-motion: reduce) {
  .workout-card--flash {
    animation: none;
  }

  .workout-card,
  .workout-card__add,
  .workout-card__remove {
    transition: none;
  }
}
</style>
