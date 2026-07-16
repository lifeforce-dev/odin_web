<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';

import AppShell from '@/components/AppShell.vue';
import PoolCreateRow from '@/components/PoolCreateRow.vue';
import PoolElsewhereRow from '@/components/PoolElsewhereRow.vue';
import PoolGroupHeader from '@/components/PoolGroupHeader.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useOverflow } from '@/composables/useOverflow';
import { orderAfterDrop, useWorkbenchDrag } from '@/composables/useWorkbenchDrag';
import { useWorkbench } from '@/composables/useWorkbench';
import type { PrescriptionField } from '@/composables/useWorkbench';
import type { CircuitSlot, TrashedWorkout } from '@/domain/builder';

// The circuit workbench (design_reference/circuit-workbench.html), both
// zones. TOP: the circuit's ordered workout cards. BOTTOM: the WORKOUTS
// pool - AVAILABLE and IN OTHER CIRCUITS groups, the steal flow, and a
// create row docked below the list. One card control everywhere (a
// workout is one thing wherever it sits - 02-07); one drag behavior
// everywhere. The docked create row doubles as the trash while a card
// is lifted (the forge rule, STYLEGUIDE section 9).

const props = defineProps<{
  id: string;
}>();

const db = useDb();
const workbench = useWorkbench(db, () => props.id);
const { status, circuitName, slots, pool } = workbench;

// One fold open at a time, across both zones: a card's editor or an
// elsewhere row's steal strip, keyed by exercise id (cards are the
// workout, wherever it sits).
const openCardId = ref<string | null>(null);
const flashExerciseId = ref<string | null>(null);
const createNotice = ref<string | null>(null);
const renameNotice = ref<{ exerciseId: string; message: string } | null>(null);

const workbenchEl = ref<HTMLElement | null>(null);
const circuitZoneEl = ref<HTMLElement | null>(null);
const circuitContentEl = ref<HTMLElement | null>(null);
const poolEl = ref<HTMLElement | null>(null);
const poolListEl = ref<HTMLElement | null>(null);
const poolContentEl = ref<HTMLElement | null>(null);
const trashEl = ref<HTMLElement | null>(null);

// The grip rule earns its keep only where a swipe has somewhere to go
// (owner ruling 2026-07-15): a zone that scrolls needs the gesture, so
// its cards drag by the grip alone; a zone whose content fits has no
// scroll to protect and lets the whole card drag, which is what the
// thumb reaches for when there is visibly no scrollbar. Asked per zone -
// a short circuit and a long pool are the ordinary case.
const circuitScrolls = useOverflow(circuitZoneEl, circuitContentEl);
const poolScrolls = useOverflow(poolListEl, poolContentEl);

// Whether the release just handled committed anything (reorder, remove,
// add, trash). The exit watcher below reads it to tell a commit apart
// from a put-back/cancel, which additionally flies the card home.
let dropCommitted = false;

const drag = useWorkbenchDrag({
  measureSlotMidpoints,
  measurePoolTop: () => poolEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  // The create slot doubles as the trash (the forge rule): it is always
  // laid out and outside the pool's scroll, so its boundary is
  // measurable at begin() before the trash face rewrites over it.
  measureTrashTop: () => trashEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  onReorder: (draggedExerciseId, insertAt) => {
    dropCommitted = true;
    applyReorder(draggedExerciseId, insertAt);
  },
  onRemove: (exerciseId) => {
    dropCommitted = true;
    const held = slots.value.find((slot) => slot.exerciseId === exerciseId);
    if (held) {
      void workbench.removeSlot(held.id);
    }
  },
  onAdd: (exerciseId, insertAt) => {
    dropCommitted = true;
    applyPoolDrop(exerciseId, insertAt);
  },
  onTrash: onTrashDrop,
});

// --- Forge choreography (signal-rewrite, 2026-07-15 owner pick) -------------
// While a card is lifted the CSS owns MORPH / DORMANT / ARMED from
// drag.state classes. The two EXIT choreographies play after the drag
// session has already reset, so they need their own transient phase:
// consume (tv-off collapse, line dart, white-hot impact, reverse
// rewrite, undo snackbar) after a trash drop; abort (bare reverse
// rewrite, and a fly-home when nothing was committed) after every other
// release. The JS constants mirror the CSS envelope tokens
// (--motion-morph / --motion-consume in structure.css) - the CSS reads
// the tokens, these only decide when the transient phase state drops.
const MOTION_MORPH_MS = 200;
const MOTION_CONSUME_MS = 360;
const FLY_HOME_MS = 150; // mirrors --motion-slide
const TOAST_HOLD_MS = 5000;

const forgeFx = ref<'idle' | 'consume' | 'abort'>('idle');
let forgeFxTimer: ReturnType<typeof setTimeout> | null = null;

// What a transient element renders: the same content model as the drag
// ghost, resolved from either zone (or the elsewhere group).
interface TransientCard {
  name: string;
  sets: number;
  restSeconds: number;
  variant: 'circuit' | 'pool';
  owner: string | null;
}

// The drag session resets before its drop callbacks run, so the exit
// choreographies snapshot the in-flight ghost while it still exists.
interface GhostSnapshot {
  x: number;
  y: number;
  width: number;
  height: number;
}
let ghostSnapshot: GhostSnapshot | null = null;
watchEffect(() => {
  if (drag.state.draggingId !== null) {
    ghostSnapshot = {
      x: drag.state.ghostX,
      y: drag.state.ghostY,
      width: drag.state.ghostWidth,
      height: drag.state.ghostHeight,
    };
  }
});

// The tv-off transient (position via --cg-* custom props; the collapse
// keyframes own transform, so the position must ride inside them).
const consumeGhost = ref<(TransientCard & GhostSnapshot & { dartTo: number }) | null>(null);
// The put-back transient: the lifted card flies back to its row.
const flyGhost = ref<(TransientCard & GhostSnapshot & { toX: number; toY: number }) | null>(null);
let flyTimer: ReturnType<typeof setTimeout> | null = null;

// The consume snackbar. `undo` lands when the trash write settles;
// `spent` marks an undo that expired underneath it (double tap, or the
// freed name retaken).
const trashToast = ref<{ name: string; undo: TrashedWorkout | null; spent: boolean } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function cardContent(exerciseId: string): TransientCard | null {
  const slot = slots.value.find((entry) => entry.exerciseId === exerciseId);
  if (slot) {
    return {
      name: slot.exerciseName,
      sets: slot.sets,
      restSeconds: slot.restSeconds,
      variant: 'circuit',
      owner: null,
    };
  }
  const free = pool.value.available.find((entry) => entry.exerciseId === exerciseId);
  if (free) {
    return {
      name: free.name,
      sets: free.sets,
      restSeconds: free.restSeconds,
      variant: 'pool',
      owner: null,
    };
  }
  const held = pool.value.heldElsewhere.find((entry) => entry.exerciseId === exerciseId);
  return held
    ? { name: held.name, sets: 0, restSeconds: 0, variant: 'pool', owner: held.ownerCircuitName }
    : null;
}

function playForgeFx(phase: 'consume' | 'abort', durationMs: number): void {
  forgeFx.value = phase;
  if (forgeFxTimer !== null) {
    clearTimeout(forgeFxTimer);
  }
  forgeFxTimer = setTimeout(() => {
    forgeFx.value = 'idle';
    consumeGhost.value = null;
    forgeFxTimer = null;
  }, durationMs);
}

function dismissToast(): void {
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  trashToast.value = null;
}

function onTrashDrop(exerciseId: string): void {
  dropCommitted = true;
  const content = cardContent(exerciseId);
  const from = ghostSnapshot;
  if (content && from) {
    const dartTo = trashEl.value?.getBoundingClientRect().top ?? from.y;
    consumeGhost.value = { ...content, ...from, dartTo };
    dismissToast();
    trashToast.value = { name: content.name, undo: null, spent: false };
    toastTimer = setTimeout(dismissToast, MOTION_CONSUME_MS + TOAST_HOLD_MS);
  }
  playForgeFx('consume', MOTION_CONSUME_MS + 60);
  void workbench.trashWorkout(exerciseId).then((undo) => {
    if (trashToast.value && trashToast.value.name === content?.name) {
      trashToast.value.undo = undo;
    }
  });
}

async function undoTrashTapped(): Promise<void> {
  const toast = trashToast.value;
  if (!toast || !toast.undo || toast.spent) {
    return;
  }
  if (await workbench.undoTrash(toast.undo)) {
    dismissToast();
    return;
  }
  // Expired underneath the snackbar (the freed name was retaken); the
  // reload already told the screen the truth - say so, briefly.
  toast.spent = true;
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(dismissToast, 2000);
}

// A put-back (or cancel) flies the card home: functional motion, the
// exit states where the card went. Commits deliberately do not animate
// (release is the preview); consume owns its own exit.
async function flyHome(exerciseId: string): Promise<void> {
  const from = ghostSnapshot;
  const content = cardContent(exerciseId);
  if (!from || !content) {
    return;
  }
  await nextTick();
  const row = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (!row) {
    return;
  }
  const rect = row.getBoundingClientRect();
  flyGhost.value = { ...content, ...from, toX: rect.left, toY: rect.top };
  if (flyTimer !== null) {
    clearTimeout(flyTimer);
  }
  flyTimer = setTimeout(() => {
    flyGhost.value = null;
    flyTimer = null;
  }, FLY_HOME_MS);
}

// The exit watcher: every release that is not a consume plays the
// reverse rewrite (the grammar covers every exit); a release that
// committed nothing also flies the card home. A new lift cancels any
// exit still playing.
watch(
  () => drag.state.draggingId,
  (draggingId, previous) => {
    if (draggingId !== null) {
      dropCommitted = false;
      forgeFx.value = 'idle';
      consumeGhost.value = null;
      if (forgeFxTimer !== null) {
        clearTimeout(forgeFxTimer);
        forgeFxTimer = null;
      }
      return;
    }
    if (previous === null || forgeFx.value === 'consume') {
      return;
    }
    playForgeFx('abort', MOTION_MORPH_MS);
    if (!dropCommitted) {
      void flyHome(previous);
    }
  },
);

function clearForgeTimers(): void {
  for (const timer of [forgeFxTimer, flyTimer, toastTimer]) {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
  forgeFxTimer = null;
  flyTimer = null;
  toastTimer = null;
}

onBeforeUnmount(clearForgeTimers);

onMounted(() => {
  void workbench.load();
});
watch(
  () => props.id,
  () => {
    // A different circuit is a fresh screen: per-circuit UI state must
    // not leak across (an open fold, notice, running flash, or a forge
    // exit/undo keyed to the old circuit's ids).
    openCardId.value = null;
    flashExerciseId.value = null;
    createNotice.value = null;
    renameNotice.value = null;
    forgeFx.value = 'idle';
    consumeGhost.value = null;
    flyGhost.value = null;
    dismissToast();
    clearForgeTimers();
    void workbench.load();
  },
);

// Blank while loading: a placeholder here painted a one-frame WORKBENCH
// flash before the real name landed (owner-reported). The fallback only
// serves the missing/error notes, which have no circuit name to show.
const headerTitle = computed(() => {
  if (status.value === 'loading') {
    return '';
  }
  return circuitName.value || 'Workbench';
});

const eyebrowText = computed(() => {
  if (status.value !== 'ready') {
    return 'Circuit';
  }
  if (slots.value.length === 0) {
    return 'Empty // add a workout below';
  }
  return slots.value.length === 1 ? '1 Workout' : `${slots.value.length} Workouts`;
});

// Standard reorder model: while a lifted CIRCUIT card is over the
// circuit it LEAVES the list (it never appears twice) and a landing gap
// opens at the insertion point - rows slide to make room, and the gap is
// the drop preview. Over the pool or trash the gap closes and the origin
// row returns, dimmed. A lifted POOL card is not in this list at all, so
// the same code previews its insertion among ALL cards. The gap index
// counts non-dragged rows only, matching what measureSlotMidpoints
// reports.
//
// Every row is a numbered rack socket (loaded-rack, 2026-07-15):
// rackIndex is the row's COMMITTED position, and the landing gap wears
// the index it previews - rows deliberately keep their stale numbers
// until the drop lands (the honest wrinkle: mid-drag the gap's number
// can duplicate a neighbor's for a moment). There is no standing empty
// socket: the rack ends at its last card, and the open socket appears
// only as the drag's landing gap (owner edit to the loaded-rack mock).
type SlotListRow =
  { kind: 'slot'; slot: CircuitSlot; rackIndex: number } | { kind: 'gap'; rackIndex: number };

const displayRows = computed<SlotListRow[]>(() => {
  const draggedId = drag.state.draggingId;
  const gapAt = drag.state.gapIndex;
  const reordering = draggedId !== null && gapAt !== null;
  const rows: SlotListRow[] = slots.value
    .map((slot, index) => ({ kind: 'slot' as const, slot, rackIndex: index + 1 }))
    .filter((row) => !(reordering && row.slot.exerciseId === draggedId));
  if (reordering) {
    rows.splice(Math.min(gapAt, rows.length), 0, { kind: 'gap', rackIndex: gapAt + 1 });
  }
  return rows;
});

// Two-digit Bebas badge, the rack's socket number.
function rackBadge(index: number): string {
  return String(index).padStart(2, '0');
}

// Midpoints come from LAYOUT geometry (offsetTop), never from
// getBoundingClientRect: rects include the in-flight FLIP slide
// transforms, so measuring mid-animation fed animating positions back
// into the insertion test - the gap flapped and rows replayed their
// slides at drag start. offsetTop ignores transforms, so every
// measurement describes the settled layout the rows are sliding toward.
// The rows' offsetParent is the zone itself (position: relative).
function measureSlotMidpoints(draggedId: string): number[] {
  const zone = circuitZoneEl.value;
  if (!zone) {
    return [];
  }
  const zoneTop = zone.getBoundingClientRect().top - zone.scrollTop;
  return [...zone.querySelectorAll<HTMLElement>('[data-card-id]')]
    .filter((element) => element.dataset.cardId !== draggedId)
    .map((element) => zoneTop + element.offsetTop + element.offsetHeight / 2);
}

// The gap-to-permutation math is orderAfterDrop (pure, pinned in Node);
// same-order drops write nothing (the composable's guard). The session
// tracks exercise ids; persistence wants item ids, so map at the seam.
function applyReorder(draggedExerciseId: string, insertAt: number): void {
  const dragged = slots.value.find((slot) => slot.exerciseId === draggedExerciseId);
  if (!dragged) {
    return;
  }
  const orderedIds = slots.value.map((slot) => slot.id);
  void workbench.reorderSlots(orderAfterDrop(orderedIds, dragged.id, insertAt));
}

// Scrolls a just-touched card into view; jsdom has no scrollIntoView, so
// feature-check rather than crash under vitest. Exclusive membership
// means an exercise renders in exactly one zone, so one lookup serves
// them all.
function revealCard(exerciseId: string): void {
  const card = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (card && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Folding open pushes content down inside a scrolling zone, so every
// open brings the whole unfolded card back into view (block: 'nearest'
// scrolls the minimum distance - the standard, least-jarring fix for
// "the editor opened below the fold", owner-picked on the device pass).
function toggleCard(exerciseId: string): void {
  const opening = openCardId.value !== exerciseId;
  openCardId.value = opening ? exerciseId : null;
  renameNotice.value = null;
  if (opening) {
    void nextTick(() => revealCard(exerciseId));
  }
}

function adjust(exerciseId: string, field: PrescriptionField, delta: number): void {
  void workbench.adjustPrescription(exerciseId, field, delta);
}

function removeSlot(slot: CircuitSlot): void {
  openCardId.value = null;
  void workbench.removeSlot(slot.id);
}

// Shared by both drag starts. Any open fold was closed by the caller, so
// this waits out that re-render: every drag measurement (gap height,
// ghost size, the frozen zone boundaries) must describe settled
// geometry, or the drag states disagree about heights and the zone seams
// turn into oscillation bands. The finger keeps moving through the
// measurement tick with no session listening yet, so the freshest move
// is carried across the gap (begin() from the original event painted the
// ghost 1-2 frames behind the finger). A pointerup during the tick means
// the flick ended before the drag could begin - null tells the caller
// not to start (without the guard the ghost would stick). These
// listeners live on document, so they filter to the starting finger.
async function settleGeometry(event: PointerEvent): Promise<PointerEvent | null> {
  let released = false;
  let liveEvent = event;
  const onEarlyRelease = (releaseEvent: PointerEvent): void => {
    if (releaseEvent.pointerId === event.pointerId) {
      released = true;
    }
  };
  const onEarlyMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId === event.pointerId) {
      liveEvent = moveEvent;
    }
  };
  document.addEventListener('pointerup', onEarlyRelease);
  document.addEventListener('pointercancel', onEarlyRelease);
  document.addEventListener('pointermove', onEarlyMove);
  await nextTick();
  document.removeEventListener('pointerup', onEarlyRelease);
  document.removeEventListener('pointercancel', onEarlyRelease);
  document.removeEventListener('pointermove', onEarlyMove);
  return released ? null : liveEvent;
}

async function startCardDrag(
  origin: 'circuit' | 'pool',
  exerciseId: string,
  event: PointerEvent,
): Promise<void> {
  // Lifting a card closes every open fold: one live interaction at a
  // time, and closed-card geometry for the measurements.
  openCardId.value = null;
  const liveEvent = await settleGeometry(event);
  const card = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (!liveEvent || !card) {
    return;
  }
  drag.begin(origin, exerciseId, liveEvent, card.getBoundingClientRect());
}

// The lifted card: the REAL component rendered full-size under the thumb
// (grab-point anchored), so the ghost is exactly the row being moved.
// It keeps its origin's dress in flight (loaded-rack: a stock row stays
// cold; the vermilion arrives WITH membership, via the landing flash).
const draggedCard = computed<{
  name: string;
  sets: number;
  restSeconds: number;
  variant: 'circuit' | 'pool';
} | null>(() => {
  const draggedId = drag.state.draggingId;
  if (draggedId === null) {
    return null;
  }
  if (drag.state.origin === 'circuit') {
    const slot = slots.value.find((entry) => entry.exerciseId === draggedId);
    return slot
      ? {
          name: slot.exerciseName,
          sets: slot.sets,
          restSeconds: slot.restSeconds,
          variant: 'circuit',
        }
      : null;
  }
  const free = pool.value.available.find((entry) => entry.exerciseId === draggedId);
  return free
    ? { name: free.name, sets: free.sets, restSeconds: free.restSeconds, variant: 'pool' }
    : null;
});

// A lifted elsewhere row carries a FROM <owner> strip - the move's
// consequence stays stated even on the drag path.
const draggedElsewhere = computed(() =>
  drag.state.origin === 'pool'
    ? (pool.value.heldElsewhere.find((entry) => entry.exerciseId === drag.state.draggingId) ?? null)
    : null,
);

async function flashCard(exerciseId: string): Promise<void> {
  flashExerciseId.value = exerciseId;
  await nextTick();
  revealCard(exerciseId);
}

async function addTapped(exerciseId: string): Promise<void> {
  if (await workbench.addFromPool(exerciseId)) {
    await flashCard(exerciseId);
  }
}

async function confirmSteal(exerciseId: string): Promise<void> {
  openCardId.value = null;
  if (await workbench.stealFromPool(exerciseId)) {
    await flashCard(exerciseId);
  }
}

// Rename verdicts stay on the card that asked: a rejected rename shows
// its notice there; a success flows back down as the new name prop.
async function handleRename(exerciseId: string, name: string): Promise<void> {
  renameNotice.value = null;
  const outcome = await workbench.renameWorkout(exerciseId, name);
  if (outcome.kind === 'rejected') {
    renameNotice.value = { exerciseId, message: outcome.message };
  }
}

function noticeFor(exerciseId: string): string | null {
  return renameNotice.value?.exerciseId === exerciseId ? renameNotice.value.message : null;
}

// A pool card released over the circuit: the previewed gap commits.
// Whether that is an add or a steal follows from where the exercise
// lives right now.
function applyPoolDrop(exerciseId: string, insertAt: number): void {
  const stolen = pool.value.heldElsewhere.some((entry) => entry.exerciseId === exerciseId);
  const landing = stolen
    ? workbench.stealFromPool(exerciseId, insertAt)
    : workbench.addFromPool(exerciseId, insertAt);
  void landing.then((itemId) => {
    if (itemId) {
      void flashCard(exerciseId);
    }
  });
}

// Inline create routes by outcome: reveal the new pool card (create
// stays in the pool - no auto-add), flash the card when the name is
// already in this circuit, open the owner's steal strip (create never
// silently steals), or surface the domain's verdict on the name.
async function handleCreate(name: string): Promise<void> {
  createNotice.value = null;
  const outcome = await workbench.createWorkout(name);
  if (outcome.kind === 'in-pool') {
    await nextTick();
    revealCard(outcome.exerciseId);
    return;
  }
  if (outcome.kind === 'already-in-circuit') {
    await flashCard(outcome.exerciseId);
    return;
  }
  if (outcome.kind === 'held-elsewhere') {
    openCardId.value = outcome.exerciseId;
    await nextTick();
    revealCard(outcome.exerciseId);
    return;
  }
  if (outcome.kind === 'rejected') {
    createNotice.value = outcome.message;
  }
}
</script>

<template>
  <AppShell>
    <div ref="workbenchEl" class="workbench">
      <ScreenHeader :title="headerTitle" back-label="Circuits" :back-to="{ name: 'circuits' }">
        <template #eyebrow>{{ eyebrowText }}</template>
      </ScreenHeader>

      <template v-if="status === 'ready'">
        <!-- The zones own the space below the header and nothing else,
             so --zone-circuit's split is measured against exactly what
             the eye measures it against. While a card is lifted the
             page steps DOWN one luminance grade (figure/ground: the
             ghost, outside this wrapper, steps up) and steps back on
             the exit - all in steps(), a display losing a grade, never
             a fade. The drag ghost must never be a descendant: the
             filter would become its containing block. -->
        <div
          class="workbench__zones"
          :class="{
            'workbench__zones--receded': drag.state.draggingId !== null,
            'workbench__zones--restoring': forgeFx !== 'idle',
            'workbench__zones--restoring-late': forgeFx === 'consume',
          }"
        >
          <div
            ref="circuitZoneEl"
            class="workbench__circuit-zone scrolly"
            :class="{ 'workbench__circuit-zone--armed': drag.state.circuitArmed }"
          >
            <!-- These content wrappers exist to be measured: a scroll
                 container's own box never resizes when a card lands in
                 it, so useOverflow watches the content for the change
                 and the container for the answer. -->
            <div ref="circuitContentEl">
              <p v-if="displayRows.length === 0" class="workbench__empty-hint">
                Tap a workout below to open it // drag it up to place
              </p>
              <!-- Move transitions run only WHILE dragging: the drop must
                   commit the previewed layout instantly (releasing means
                   "keep what I see"), so the drop patch renders under a
                   name with no move transition and simply snaps. -->
              <TransitionGroup
                v-else
                tag="div"
                :name="drag.state.draggingId ? 'slot-shift' : 'slot-settle'"
                class="workbench__slot-list"
              >
                <template
                  v-for="row in displayRows"
                  :key="row.kind === 'slot' ? row.slot.exerciseId : 'landing-gap'"
                >
                  <div
                    v-if="row.kind === 'gap'"
                    class="workbench__rack-slot workbench__rack-slot--gap"
                    :style="{ height: `${drag.state.ghostHeight}px` }"
                  >
                    <span class="workbench__rack-index">{{ rackBadge(row.rackIndex) }}</span>
                    <div class="workbench__rack-vacant"></div>
                  </div>
                  <div v-else class="workbench__rack-slot">
                    <span class="workbench__rack-index">{{ rackBadge(row.rackIndex) }}</span>
                    <WorkoutCard
                      :data-card-id="row.slot.exerciseId"
                      :name="row.slot.exerciseName"
                      :sets="row.slot.sets"
                      :rest-seconds="row.slot.restSeconds"
                      removable
                      :drag-anywhere="!circuitScrolls"
                      :open="openCardId === row.slot.exerciseId"
                      :dragging="drag.state.draggingId === row.slot.exerciseId"
                      :flash="flashExerciseId === row.slot.exerciseId"
                      :notice="noticeFor(row.slot.exerciseId)"
                      @toggle="toggleCard(row.slot.exerciseId)"
                      @adjust="(field, delta) => adjust(row.slot.exerciseId, field, delta)"
                      @remove="removeSlot(row.slot)"
                      @rename="(name) => void handleRename(row.slot.exerciseId, name)"
                      @drag-start="
                        (event) => void startCardDrag('circuit', row.slot.exerciseId, event)
                      "
                      @flash-end="flashExerciseId = null"
                    />
                  </div>
                </template>
              </TransitionGroup>
            </div>
          </div>

          <div
            ref="poolEl"
            class="workbench__pool"
            :class="{ 'workbench__pool--armed': drag.state.poolArmed }"
          >
            <p class="workbench__pool-label">Workouts</p>
            <!-- AVAILABLE docks with the label, outside the scroll: it
                 names the list's default group, so it must stay put
                 while the cards scroll (owner ruling, 2026-07-15). IN
                 OTHER CIRCUITS stays in the flow - it marks a boundary
                 inside the scrolled content. -->
            <PoolGroupHeader
              class="workbench__pool-available"
              label="Available"
              variant="available"
            />
            <div ref="poolListEl" class="workbench__pool-list scrolly">
              <div ref="poolContentEl" class="workbench__pool-items">
                <WorkoutCard
                  v-for="entry in pool.available"
                  :key="entry.exerciseId"
                  :data-card-id="entry.exerciseId"
                  :name="entry.name"
                  :sets="entry.sets"
                  :rest-seconds="entry.restSeconds"
                  variant="pool"
                  addable
                  :drag-anywhere="!poolScrolls"
                  :open="openCardId === entry.exerciseId"
                  :dragging="drag.state.draggingId === entry.exerciseId"
                  :notice="noticeFor(entry.exerciseId)"
                  @toggle="toggleCard(entry.exerciseId)"
                  @adjust="(field, delta) => adjust(entry.exerciseId, field, delta)"
                  @add="() => void addTapped(entry.exerciseId)"
                  @rename="(name) => void handleRename(entry.exerciseId, name)"
                  @drag-start="(event) => void startCardDrag('pool', entry.exerciseId, event)"
                />
                <template v-if="pool.heldElsewhere.length > 0">
                  <PoolGroupHeader label="In Other Circuits" variant="elsewhere" />
                  <PoolElsewhereRow
                    v-for="entry in pool.heldElsewhere"
                    :key="entry.exerciseId"
                    :data-card-id="entry.exerciseId"
                    :name="entry.name"
                    :owner="entry.ownerCircuitName"
                    :drag-anywhere="!poolScrolls"
                    :open="openCardId === entry.exerciseId"
                    @toggle="toggleCard(entry.exerciseId)"
                    @close="openCardId = null"
                    @steal="() => void confirmSteal(entry.exerciseId)"
                    @drag-start="(event) => void startCardDrag('pool', entry.exerciseId, event)"
                  />
                </template>
              </div>
            </div>
            <!-- The forge (02-07): the create row docked below the list
                 doubles as the delete target. Its face is a SIGNAL
                 (signal-rewrite, 2026-07-15 pick): a drag begins and a
                 white raster line REWRITES it top-to-bottom to the
                 dormant x DELETE (the create row stays painted beneath -
                 the split face mid-sweep is the tell); the ghost on it
                 arms the energized double rail; release plays the
                 reverse rewrite (consume adds the tv-off, dart, and
                 white-hot impact first). Always laid out, so the
                 boundary is measurable at drag start. Dropping here
                 deletes the workout entirely, from either zone. -->
            <div
              ref="trashEl"
              class="workbench__create-slot"
              :class="{
                'workbench__create-slot--lifted': drag.state.draggingId !== null,
                'workbench__create-slot--consume': forgeFx === 'consume',
                'workbench__create-slot--abort': forgeFx === 'abort',
              }"
            >
              <PoolCreateRow
                class="workbench__create"
                :notice="createNotice"
                @create="(name) => void handleCreate(name)"
              />
              <p
                class="workbench__trash-face"
                :class="{ 'workbench__trash-face--armed': drag.state.trashArmed }"
                aria-hidden="true"
              >
                <span class="workbench__trash-x">x</span> DELETE
              </p>
              <span class="workbench__raster" aria-hidden="true"></span>
            </div>
            <!-- The consume snackbar: the one recovery path for a
                 gesture with no confirm. Snaps in after the reverse
                 rewrite lands; auto-dismisses. -->
            <div v-if="trashToast" class="workbench__snack" role="status">
              <p class="workbench__snack-msg">
                {{
                  trashToast.spent
                    ? "Couldn't restore // name back in use"
                    : `${trashToast.name} deleted`
                }}
              </p>
              <button
                type="button"
                class="workbench__snack-undo"
                @click="() => void undoTrashTapped()"
              >
                Undo
              </button>
            </div>
          </div>
        </div>
      </template>

      <ScreenNote v-else-if="status === 'loading'">Loading circuit</ScreenNote>
      <ScreenNote v-else-if="status === 'missing'">
        No circuit here // it may have been deleted
      </ScreenNote>
      <ScreenNote v-else-if="status === 'unavailable'">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote
        v-else-if="status === 'error'"
        action="Retry"
        @action="() => void workbench.load()"
      >
        Couldn't load this circuit
      </ScreenNote>
    </div>

    <!-- Positioned by transform, never left/top: the ghost follows every
         pointermove, and a transform stays on the compositor while
         left/top would re-run layout+paint per move (the on-device
         symptom was the ghost flashing at stale positions at drag start
         and release). -->
    <div
      v-if="draggedCard"
      class="workbench__drag-ghost"
      :class="{ 'workbench__drag-ghost--yield': drag.state.trashArmed }"
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <div class="workbench__ghost-card">
        <WorkoutCard
          :name="draggedCard.name"
          :sets="draggedCard.sets"
          :rest-seconds="draggedCard.restSeconds"
          :variant="draggedCard.variant"
        />
      </div>
    </div>
    <div
      v-else-if="draggedElsewhere"
      class="workbench__drag-ghost"
      :class="{ 'workbench__drag-ghost--yield': drag.state.trashArmed }"
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <div class="workbench__ghost-card">
        <PoolElsewhereRow
          :name="draggedElsewhere.name"
          :owner="draggedElsewhere.ownerCircuitName"
        />
        <p class="workbench__ghost-from">From {{ draggedElsewhere.ownerCircuitName }}</p>
      </div>
    </div>

    <!-- Consume transient (signal-rewrite): the trashed card tv-offs to
         a bright line, and the line darts into the forge. Position rides
         in the --cg-* custom props because the collapse keyframes own
         transform. Pure paint - the delete already landed. -->
    <div
      v-if="consumeGhost"
      class="workbench__consume-ghost"
      :style="{
        '--cg-x': `${consumeGhost.x}px`,
        '--cg-y': `${consumeGhost.y}px`,
        width: `${consumeGhost.width}px`,
      }"
      aria-hidden="true"
    >
      <PoolElsewhereRow
        v-if="consumeGhost.owner"
        :name="consumeGhost.name"
        :owner="consumeGhost.owner"
      />
      <WorkoutCard
        v-else
        :name="consumeGhost.name"
        :sets="consumeGhost.sets"
        :rest-seconds="consumeGhost.restSeconds"
        :variant="consumeGhost.variant"
      />
    </div>
    <span
      v-if="consumeGhost"
      class="workbench__tvline"
      :style="{
        left: `${consumeGhost.x}px`,
        width: `${consumeGhost.width}px`,
        '--tv-from': `${consumeGhost.y + consumeGhost.height / 2}px`,
        '--tv-to': `${consumeGhost.dartTo}px`,
      }"
      aria-hidden="true"
    ></span>

    <!-- Put-back transient: the lifted card flies home to its row, so
         the abort states where the card went. -->
    <div
      v-if="flyGhost"
      class="workbench__fly-ghost"
      :style="{
        '--fly-from-x': `${flyGhost.x}px`,
        '--fly-from-y': `${flyGhost.y}px`,
        '--fly-to-x': `${flyGhost.toX}px`,
        '--fly-to-y': `${flyGhost.toY}px`,
        width: `${flyGhost.width}px`,
      }"
      aria-hidden="true"
    >
      <PoolElsewhereRow v-if="flyGhost.owner" :name="flyGhost.name" :owner="flyGhost.owner" />
      <WorkoutCard
        v-else
        :name="flyGhost.name"
        :sets="flyGhost.sets"
        :rest-seconds="flyGhost.restSeconds"
        :variant="flyGhost.variant"
      />
    </div>
  </AppShell>
</template>

<style scoped>
.workbench {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-6) var(--space-4) 0;

  /* The page never scrolls; each zone scrolls inside itself. */
  overflow: hidden;
}

/* The zone pair, and nothing else: the header is NOT in here, which is
   the whole point of the wrapper (see --zone-circuit). */
.workbench__zones {
  /* Designer knob (screen-level layout, STYLEGUIDE section 10): the
     circuit zone's share of the zone area, in parts of 100. Both zones
     hold their share regardless of content and scroll internally -
     lists never resize under the thumb (owner ruling, 2026-07-15).

     Expressed as grow ratios over a zero basis, deliberately. This was
     a flex-basis percentage until 2026-07-15, when it measured against
     the whole screen INCLUDING the header: the header's height came
     out of the pool's share alone, so "65%" drew a circuit zone about
     80% of the space below it and "80%" left the pool a sliver.
     Ratios divide the free space, whatever it turns out to be, so the
     number cannot drift from what it says again. */
  --zone-circuit: 55;

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The page's luminance grammar (signal-rewrite): one grade DOWN in two
   hard steps while a card is lifted, back UP in two on the exit - late
   on a consume (the impact plays first). steps(), never a fade: a
   display losing a grade is a transient, and peripheral vision keys on
   transients. */
.workbench__zones--receded {
  animation: zones-recede calc(var(--motion-morph) * 0.6) steps(2, end) forwards;
}

.workbench__zones--restoring {
  animation: zones-restore calc(var(--motion-morph) * 0.5) steps(2, end) both;
}

.workbench__zones--restoring-late {
  animation-duration: calc(var(--motion-consume) * 0.28);
  animation-delay: calc(var(--motion-consume) * 0.72);
}

@keyframes zones-recede {
  to {
    filter: var(--lift-recede);
  }
}

@keyframes zones-restore {
  from {
    filter: var(--lift-recede);
  }

  to {
    filter: none;
  }
}

.workbench__circuit-zone {
  position: relative;
  flex: var(--zone-circuit) 1 0;
  min-height: 0;

  /* Breathing room so the armed inset ring is not clipped by overflow. */
  padding: var(--space-1);
  overflow-y: auto;
}

.workbench__circuit-zone--armed {
  box-shadow: var(--glow-zone-armed);
}

.workbench__slot-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.workbench__empty-hint {
  margin: 0;
  padding: var(--space-6) var(--space-4);
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
  text-align: center;
  text-transform: uppercase;
  border: var(--hairline) dashed var(--border-strong);
}

/* The rack (loaded-rack, 2026-07-15): every committed row is a numbered
   socket - structure says ORDERED where the pool's flat stock says
   loose. The index cell is dim display-face chrome; the card keeps the
   vermilion spine. */
.workbench__rack-slot {
  display: flex;
  align-items: stretch;
}

.workbench__rack-index {
  display: flex;
  flex: 0 0 var(--rack-index);
  align-items: center;
  justify-content: center;
  color: var(--text-soft);
  font-family: var(--font-display);
  font-size: var(--type-display-badge);
  line-height: 1;
  letter-spacing: var(--tracking-1);
  background: var(--bg);
  border: var(--hairline) solid var(--border-strong);
  border-right: none;
}

.workbench__rack-slot .workout-card {
  flex: 1 1 auto;
  min-width: 0;
}

/* The landing gap: an open socket wearing the index it previews, sized
   to the lifted card. Passive (neutral dashes, no accent) - the armed
   zone ring and the lifted card carry the red; red means the action,
   not the destination. */
.workbench__rack-slot--gap .workbench__rack-index {
  color: var(--text-dim);
  border-style: dashed;
}

.workbench__rack-vacant {
  flex: 1 1 auto;
  border: var(--hairline) dashed var(--border-strong);
  border-left: none;
}

/* Rows slide to make room while a card is lifted: functional motion (the
   gap previews the drop outcome), crisp per the motion policy. */
.slot-shift-move {
  transition: transform var(--motion-slide) ease;
}

/* Leaving rows vacate the flow IMMEDIATELY. TransitionGroup keeps a
   removed element in the DOM for ~2 rAF frames even with no leave
   animation declared (its leave pipeline is frame-based), and in-flow
   that phantom row inflated the zone by one slot at drag start (armed
   ring flashed around 4 rows for ~25ms) and at release (rows painted a
   row too low, then snapped). Leave classes apply before first paint,
   so absolute + transparent means the leaver never affects layout or
   pixels. Both names: shift covers the grabbed card leaving at begin,
   settle covers the gap leaving at drop. This is the documented
   TransitionGroup "Move Transitions" pattern (absolutely-position
   leaving items so FLIP moves stay smooth):
   https://vuejs.org/guide/built-ins/transition-group.html#move-transitions */
.slot-shift-leave-active,
.slot-settle-leave-active {
  position: absolute;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .slot-shift-move {
    transition: none;
  }
}

.workbench__pool {
  position: relative;
  display: flex;
  flex: calc(100 - var(--zone-circuit)) 1 0;
  flex-direction: column;
  min-height: 0;
  margin-top: var(--space-2);
  border-top: var(--rule) solid var(--border-strong);
}

.workbench__pool--armed {
  border-top-color: var(--accent);
  box-shadow: var(--glow-zone-armed);
}

.workbench__pool-label {
  margin: 0;
  padding: var(--space-2) 0 var(--space-1);
  color: var(--text-soft);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

/* Docked between the zone label and the list; keeps the in-list rhythm
   (the items' space-2 gap) to the first card below. */
.workbench__pool-available {
  flex: none;
  margin-bottom: var(--space-2);
}

.workbench__pool-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.workbench__pool-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
}

/* Placement is the screen's job (components never know it): headers get
   extra air above so the groups read as sections, not rows. */
.workbench__pool-items .pool-group {
  margin-top: var(--space-1);
}

.workbench__pool-items .pool-group:first-child {
  margin-top: 0;
}

/* The create slot docks below the pool list, outside its scroll: always
   in view however long the pool grows. It is also the trash (the forge
   rule, STYLEGUIDE section 9): this wrapper is what the drag measures,
   and the face below swaps in over the create row while a card is
   lifted - the place that makes workouts is the place that unmakes
   them, and no chrome is added to the screen during a drag. */
.workbench__create-slot {
  position: relative;
  flex: none;
  margin: var(--space-2) 0 var(--space-3);
}

/* The forge's afterglow: one two-step flicker as the rewrite lands (the
   phosphor settling) - the peripheral event for anyone who missed the
   sweep. */
.workbench__create-slot--lifted {
  animation: forge-afterglow calc(var(--motion-morph) * 0.2) steps(2, end)
    calc(var(--motion-morph) * 0.8);
}

/* The trash face - DORMANT dress. No red: dashes and dim ink (dashes
   already mean "a row can land here", and red is reserved for the
   pending action); the x rides one step brighter as a colorless aiming
   point. Opaque bg plate: the raster rewrite reveals this face over the
   still-painted create row, and the split face mid-sweep is the tell.
   Never interactive: drops resolve by coordinates, not events. */
.workbench__trash-face {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-dim);
  font-size: var(--type-body);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  pointer-events: none;
  background: var(--bg);
  border: var(--rule) dashed var(--border-strong);
  opacity: 0;
}

.workbench__trash-x {
  color: var(--text-soft);
}

/* MORPH: the drag begins and the raster line rewrites the signal
   top-to-bottom once - above the line the delete face is already
   painted, below it create still shows. */
.workbench__create-slot--lifted .workbench__trash-face {
  opacity: 1;
  animation: forge-rewrite calc(var(--motion-morph) * 0.7) linear calc(var(--motion-morph) * 0.1)
    both;
}

/* ARMED: the energized double rail - solid accent border PLUS an inner
   accent rail (two live wires, a signature no other zone wears), charge
   tint over the alarm plate, label at full accent with widened tracking
   (flex layout: no geometry shift). The glow pulses shallowly at the
   --motion-flash cadence via the overlay below - a functional loop on a
   live destructive state, sanctioned with the dnd-03 pick. */
.workbench__trash-face--armed,
.workbench__create-slot--consume .workbench__trash-face {
  color: var(--accent);
  letter-spacing: var(--tracking-15);
  background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--surface-alarm);
  border-style: solid;
  border-color: var(--accent);
  outline: var(--hairline) solid var(--accent);
  outline-offset: calc(-1 * (var(--space-1) + var(--rule)));
}

.workbench__trash-face--armed .workbench__trash-x,
.workbench__create-slot--consume .workbench__trash-x {
  color: inherit;
}

.workbench__trash-face--armed::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: var(--glow-zone-armed);
  animation: forge-charge var(--motion-flash) ease-in-out infinite;
}

/* CONSUME: release while armed. The face holds the armed dress, takes
   the white-hot impact when the tv-off line lands, then the reverse
   sweep rewrites create back bottom-to-top. */
.workbench__create-slot--consume .workbench__trash-face {
  opacity: 1;
  box-shadow: var(--glow-zone-armed);
  animation:
    forge-impact calc(var(--motion-consume) / 6) linear calc(var(--motion-consume) * 0.55) both,
    forge-unwrite calc(var(--motion-consume) * 0.39) linear calc(var(--motion-consume) * 0.61) both;
}

/* ABORT: any other release - the bare reverse sweep, no impact, no
   flicker. The rewrite grammar covers every exit. */
.workbench__create-slot--abort .workbench__trash-face {
  opacity: 1;
  animation: forge-unwrite calc(var(--motion-morph) * 0.7) linear both;
}

/* The raster line: 2px of white with the white event glow - the one
   bright event, entirely off the red channel (the ambient scanlines'
   language turned into an EVENT). Sits after the face in the DOM, so it
   paints above at the same z. */
.workbench__raster {
  position: absolute;
  right: 0;
  left: 0;
  z-index: var(--z-float);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--raster);
  opacity: 0;
}

.workbench__create-slot--lifted .workbench__raster {
  animation: raster-down calc(var(--motion-morph) * 0.7) linear calc(var(--motion-morph) * 0.1) both;
}

.workbench__create-slot--consume .workbench__raster {
  animation: raster-up calc(var(--motion-consume) * 0.39) linear calc(var(--motion-consume) * 0.61)
    both;
}

.workbench__create-slot--abort .workbench__raster {
  animation: raster-up calc(var(--motion-morph) * 0.7) linear both;
}

@keyframes forge-rewrite {
  from {
    clip-path: inset(0 0 100% 0);
  }

  to {
    clip-path: inset(0 0 0 0);
  }
}

@keyframes forge-unwrite {
  from {
    clip-path: inset(0 0 0 0);
  }

  to {
    clip-path: inset(0 0 100% 0);
  }
}

@keyframes raster-down {
  0% {
    top: 0;
    opacity: 1;
  }

  95% {
    opacity: 1;
  }

  100% {
    top: calc(100% - var(--rule));
    opacity: 0;
  }
}

@keyframes raster-up {
  0% {
    top: calc(100% - var(--rule));
    opacity: 1;
  }

  95% {
    opacity: 1;
  }

  100% {
    top: 0;
    opacity: 0;
  }
}

@keyframes forge-afterglow {
  0% {
    filter: brightness(0.8);
  }

  50% {
    filter: brightness(1.08);
  }

  100% {
    filter: brightness(1);
  }
}

@keyframes forge-charge {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.62;
  }
}

@keyframes forge-impact {
  0% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-zone-armed);
  }

  35% {
    color: var(--text);
    border-color: var(--text);
    box-shadow: var(--raster);
  }

  100% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-flash);
  }
}

/* The consume snackbar, docked over the forge region; UNDO is the one
   recovery path for a gesture that deliberately has no confirm. */
.workbench__snack {
  position: absolute;
  right: 0;
  bottom: var(--space-3);
  left: 0;
  z-index: var(--z-float);
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--surface-raise);
  border: var(--hairline) solid var(--border-strong);
  animation: snack-in calc(var(--motion-consume) * 0.28) steps(2, end)
    calc(var(--motion-consume) + 0.06s) both;
}

.workbench__snack-msg {
  flex: 1;
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.workbench__snack-undo {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  cursor: pointer;
  background: none;
  border: none;
}

@keyframes snack-in {
  from {
    opacity: 0;
    transform: translateY(var(--space-2));
  }

  to {
    opacity: 1;
    transform: none;
  }
}

/* The in-flight card: content is the real card component (its own
   chrome), this wrapper only positions it and adds the lifted glow.
   Anchored at the viewport origin and moved by the inline transform;
   will-change promotes it to its own compositor layer at mount so the
   first frames do not repaint mid-gesture. */
.workbench__drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  opacity: 0.94;
  will-change: transform;

  /* The card steps UP as the page steps down (figure over ground): a
     3-step micro-flicker on lift, then held one grade bright. */
  filter: brightness(1.05);
  animation: ghost-lift calc(var(--motion-morph) * 0.7) steps(3, end);
}

/* Over the armed forge the card YIELDS: desaturated, slightly small,
   the charge tint reading through as ground while the card stays
   figure (topmost). The scale rides the inner wrapper - the outer
   transform is the inline pointer-follow. */
.workbench__drag-ghost--yield {
  opacity: 0.9;
  filter: grayscale(0.65) brightness(0.98);
}

.workbench__ghost-card {
  transition: transform var(--motion-press) ease;
}

.workbench__drag-ghost--yield .workbench__ghost-card {
  transform: scale(0.95);
}

@keyframes ghost-lift {
  from {
    opacity: 0.5;
    filter: brightness(0.9);
  }

  to {
    opacity: 0.94;
    filter: brightness(1.05);
  }
}

/* The steal-drag consequence line under the lifted row: the move always
   states what it leaves, on the drag path via the ghost itself. */
.workbench__ghost-from {
  margin: 0;
  padding: var(--space-1) var(--space-4);
  color: var(--accent);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
  background: var(--surface-alarm);
  border: var(--hairline) solid var(--accent);
  border-top: none;
}

/* CONSUME transient: the tv-off. The card collapses to a bright
   horizontal line in four hard steps (a switched-off tube), edges
   brightening as the content compresses to light; the keyframes own
   transform, so the position rides in the --cg-* props. */
.workbench__consume-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  animation: tv-off calc(var(--motion-consume) / 3) steps(4, end) forwards;
  will-change: transform;
}

@keyframes tv-off {
  0% {
    transform: translate3d(var(--cg-x), var(--cg-y), 0);
    opacity: 0.9;
    filter: grayscale(0.65);
  }

  60% {
    filter: grayscale(0.8) brightness(1.3);
  }

  100% {
    transform: translate3d(var(--cg-x), var(--cg-y), 0) scaleX(1.01) scaleY(0.04);
    opacity: 0;
    filter: grayscale(1) brightness(1.5);
  }
}

/* The tv-off line, darting into the forge: the card's death stays on
   the luminance channel - white, never red; the button's response is
   the red. */
.workbench__tvline {
  position: fixed;
  top: var(--tv-from);
  z-index: var(--z-ghost);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--raster);
  opacity: 0;
  animation: tv-dart calc(var(--motion-consume) * 0.22) linear calc(var(--motion-consume) / 3) both;
}

@keyframes tv-dart {
  0% {
    top: var(--tv-from);
    opacity: 1;
  }

  90% {
    opacity: 1;
  }

  100% {
    top: var(--tv-to);
    opacity: 0;
  }
}

/* ABORT transient: a put-back flies the card home (functional motion -
   the exit states where the card went); commits stay snap-instant, and
   the fade keeps it from double-exposing over the real row it lands
   on. */
.workbench__fly-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  animation: fly-home var(--motion-slide) ease-out forwards;
  will-change: transform;
}

@keyframes fly-home {
  from {
    transform: translate3d(var(--fly-from-x), var(--fly-from-y), 0);
    opacity: 0.94;
  }

  to {
    transform: translate3d(var(--fly-to-x), var(--fly-to-y), 0);
    opacity: 0;
  }
}

/* Reduced motion: every choreography collapses to an instant state
   jump - the receded page applies statically, faces and transients
   simply appear/disappear, and the charge pulse holds still. */
@media (prefers-reduced-motion: reduce) {
  .workbench__zones--receded,
  .workbench__zones--restoring,
  .workbench__create-slot--lifted,
  .workbench__create-slot--lifted .workbench__trash-face,
  .workbench__create-slot--consume .workbench__trash-face,
  .workbench__create-slot--abort .workbench__trash-face,
  .workbench__raster,
  .workbench__trash-face--armed::after,
  .workbench__drag-ghost,
  .workbench__ghost-card,
  .workbench__snack,
  .workbench__fly-ghost {
    transition: none;
    animation: none;
  }

  .workbench__zones--receded {
    filter: var(--lift-recede);
  }

  .workbench__create-slot--consume .workbench__trash-face,
  .workbench__create-slot--abort .workbench__trash-face {
    opacity: 0;
  }

  .workbench__consume-ghost,
  .workbench__tvline {
    display: none;
  }
}
</style>
