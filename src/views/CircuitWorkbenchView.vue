<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import AppShell from '@/components/AppShell.vue';
import ForgeSlot from '@/components/ForgeSlot.vue';
import PoolCreateRow from '@/components/PoolCreateRow.vue';
import PoolElsewhereRow from '@/components/PoolElsewhereRow.vue';
import PoolGroupHeader from '@/components/PoolGroupHeader.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TransientCardGhost from '@/components/TransientCardGhost.vue';
import TrashSnackbar from '@/components/TrashSnackbar.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useForgeChoreography } from '@/composables/useForgeChoreography';
import type { TransientCard } from '@/composables/useForgeChoreography';
import { useOneShot } from '@/composables/useOneShot';
import { useOverflow } from '@/composables/useOverflow';
import { orderAfterDrop, useWorkbenchDrag } from '@/composables/useWorkbenchDrag';
import type { WorkbenchDragZone } from '@/composables/useWorkbenchDrag';
import { useWorkbench } from '@/composables/useWorkbench';
import type { PrescriptionField } from '@/composables/useWorkbench';
import type { CircuitSlot, PoolAvailableEntry } from '@/domain/builder';
import { MOTION_TICK_MS } from '@/styles/motion';

// The circuit workbench (design_reference/circuit-workbench.html), both
// zones. TOP: the circuit's ordered workout cards. BOTTOM: the WORKOUTS
// pool - AVAILABLE and IN OTHER CIRCUITS groups, the steal flow, and a
// create row docked below the list. One card control everywhere (a
// workout is one thing wherever it sits - 02-07); one drag behavior
// everywhere. The docked create row doubles as the forge - the delete
// target - while a card is lifted (STYLEGUIDE section 9); the forge's
// face and exit choreography live in ForgeSlot + useForgeChoreography,
// this screen owns the drag session, zone layout, and persistence
// wiring.

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
const forgeSlotRef = ref<InstanceType<typeof ForgeSlot> | null>(null);

// The grip rule earns its keep only where a swipe has somewhere to go
// (owner ruling 2026-07-15): a zone that scrolls needs the gesture, so
// its cards drag by the grip alone; a zone whose content fits has no
// scroll to protect and lets the whole card drag, which is what the
// thumb reaches for when there is visibly no scrollbar. Asked per zone -
// a short circuit and a long pool are the ordinary case.
const circuitScrolls = useOverflow(circuitZoneEl, circuitContentEl);
const poolScrolls = useOverflow(poolListEl, poolContentEl);

// Whether the release just handled committed anything (reorder, remove,
// add, trash). The choreography's exit watcher reads it to tell a
// commit apart from a put-back/cancel, which additionally flies the
// card home. Reset when a lift begins (startCardDrag).
let dropCommitted = false;

const drag = useWorkbenchDrag({
  measureSlotMidpoints,
  measurePoolTop: () => poolEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  // The forge (the create slot) is always laid out and outside the
  // pool's scroll, so its boundary is measurable at begin() before the
  // delete face rewrites over it.
  measureForgeTop: () =>
    forgeSlotRef.value?.rootEl?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
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
  onTrash: onForgeDrop,
});

function cardContent(exerciseId: string): TransientCard | null {
  const slot = slots.value.find((entry) => entry.exerciseId === exerciseId);
  if (slot) {
    return {
      kind: 'card',
      name: slot.exerciseName,
      sets: slot.sets,
      restSeconds: slot.restSeconds,
      variant: 'circuit',
    };
  }
  const free = pool.value.available.find((entry) => entry.exerciseId === exerciseId);
  if (free) {
    return {
      kind: 'card',
      name: free.name,
      sets: free.sets,
      restSeconds: free.restSeconds,
      variant: 'pool',
    };
  }
  const held = pool.value.heldElsewhere.find((entry) => entry.exerciseId === exerciseId);
  return held ? { kind: 'elsewhere', name: held.name, owner: held.ownerCircuitName } : null;
}

// The forge exit choreography (consume/abort transients, fly-home, the
// undo snackbar) - extracted whole; this screen only feeds it geometry
// and persistence.
const forge = useForgeChoreography({
  dragState: drag.state,
  cardContent,
  findRowEl: (exerciseId) =>
    workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`) ?? null,
  measureDartTarget: () => forgeSlotRef.value?.rootEl?.getBoundingClientRect().top ?? null,
  wasDropCommitted: () => dropCommitted,
  trashWorkout: workbench.trashWorkout,
  undoTrash: workbench.undoTrash,
});
const { forgeFx, consumeGhost, flyGhost, trashToast, undoTrashTapped } = forge;

function onForgeDrop(exerciseId: string): void {
  dropCommitted = true;
  forge.onTrashDrop(exerciseId);
}

// --- Relight + seam tick (crossing-tick pick, 2026-07-16) -------------------
// The armed zone is the LIT one: while a card is lifted every region
// steps DOWN one luminance grade except the one the drop would land in.
// Relighting is the ABSENCE of the recede class, so arming snaps a
// region bright (the response) while the disarmed one steps down (the
// transient) - there is deliberately no "relit" style to keep in sync.
// Three independently filtered regions (circuit zone, pool stock, forge
// slot) replace the old single zones-wrapper filter; the ghost and
// transients render outside all three, so no filter ever becomes their
// containing block. This retired the red armed-zone rings: red now
// rides only the lifted card and the armed forge.

// The zone armed when the drag ended: the exit restore must skip the
// one region that is already lit (region-restore animates FROM the
// receded grade, so playing it there would flash the lit region dark).
const lastArmedZone = ref<WorkbenchDragZone | null>(null);

// The seam tick renders while > 0; the count keys the element, so a
// recross mid-flash remounts and restarts it cleanly.
const seamTickCount = ref(0);
const seamTickShot = useOneShot();

watch(drag.armedZone, (zone, previous) => {
  if (zone !== null) {
    lastArmedZone.value = zone;
  }
  // The tick marks the CROSSING, not the state, and only the
  // circuit/pool seam wears it - the forge boundary keeps its own armed
  // language, and lift/release are not crossings.
  const crossed =
    (zone === 'pool' && previous === 'circuit') || (zone === 'circuit' && previous === 'pool');
  if (!crossed) {
    return;
  }
  seamTickCount.value += 1;
  seamTickShot.set(() => {
    seamTickCount.value = 0;
  }, MOTION_TICK_MS);
});

// The per-region filter classes; the armed region gets none and simply
// stays (or snaps back to) full luminance.
function regionClasses(region: WorkbenchDragZone): Record<string, boolean> {
  const lifted = drag.state.draggingId !== null;
  const restoring = !lifted && forgeFx.value !== 'idle' && lastArmedZone.value !== region;
  return {
    'workbench__region--receded': lifted && drag.armedZone.value !== region,
    'workbench__region--restoring': restoring,
    'workbench__region--restoring-late': restoring && forgeFx.value === 'consume',
  };
}

onMounted(() => {
  void workbench.reload();
});
watch(
  () => props.id,
  () => {
    // A different circuit is a fresh screen: per-circuit UI state must
    // not leak across (an open fold, notice, running flash, or a forge
    // exit/undo keyed to the old circuit's ids), and reload() flips the
    // status to loading NOW so the old circuit cannot take a stale tap
    // while the new one loads.
    openCardId.value = null;
    flashExerciseId.value = null;
    createNotice.value = null;
    renameNotice.value = null;
    forge.reset();
    seamTickShot.cancel();
    seamTickCount.value = 0;
    void workbench.reload();
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
// the drop preview. Over the pool or forge the gap closes and the origin
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
//
// Measured on the RACK WRAPPERS ([data-rack-id]), never the cards
// inside them: the wrappers are the TransitionGroup children, so the
// FLIP slide puts its inline transform ON them - and offsetTop only
// ignores the measured element's OWN transform. A transformed ancestor
// becomes its descendants' offsetParent, so a card inside a sliding
// wrapper measured ~0 instead of its place in the list and the gap
// flap came back (the loaded-rack regression, owner-caught 2026-07-16).
// The wrappers' offsetParent is the zone itself (position: relative).
function measureSlotMidpoints(draggedId: string): number[] {
  const zone = circuitZoneEl.value;
  if (!zone) {
    return [];
  }
  const zoneTop = zone.getBoundingClientRect().top - zone.scrollTop;
  return [...zone.querySelectorAll<HTMLElement>('[data-rack-id]')]
    .filter((element) => element.dataset.rackId !== draggedId)
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
  dropCommitted = false;
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
// ONE lookup for everything the transients render - the drag ghost, the
// berth test, and the choreography all read the same content model.
const draggedContent = computed<TransientCard | null>(() =>
  drag.state.draggingId !== null ? cardContent(drag.state.draggingId) : null,
);

// The pool's landing preview: while the pool is armed a BERTH opens
// where releasing sends the card. A lifted pool card's own row becomes
// the berth (the put-back preview); a circuit-origin card docks at the
// TOP of the stock (owner pick, 2026-07-16 - a fixed, always-visible
// spot beats the honest sorted position, which read as random and could
// open below the scroll; the stock still reloads sorted, so the row
// settles to its alphabetical place after the drop). An
// elsewhere-origin card returns to the ELSEWHERE group on a put-back,
// so it opens no berth among the stock (that group's design belongs to
// 02-06).
type PoolRow = { kind: 'card'; entry: PoolAvailableEntry } | { kind: 'berth' };

// True while the top-docked berth is open (only a card NOT already in
// the stock earns it); also what the scroll watcher below keys on.
const topBerthOpen = computed(
  () =>
    drag.state.poolArmed &&
    draggedContent.value?.kind === 'card' &&
    !pool.value.available.some((entry) => entry.exerciseId === drag.state.draggingId),
);

const poolRows = computed<PoolRow[]>(() => {
  const rows: PoolRow[] = pool.value.available.map((entry) => ({ kind: 'card', entry }));
  const draggedId = drag.state.draggingId;
  if (!drag.state.poolArmed || draggedId === null) {
    return rows;
  }
  const ownIndex = pool.value.available.findIndex((entry) => entry.exerciseId === draggedId);
  if (ownIndex !== -1) {
    rows.splice(ownIndex, 1, { kind: 'berth' });
    return rows;
  }
  if (topBerthOpen.value) {
    rows.unshift({ kind: 'berth' });
  }
  return rows;
});

// The top berth must be IN VIEW to preview anything: a pool scrolled
// down would open it above the fold, which is the exact complaint the
// fixed top spot exists to fix.
watch(topBerthOpen, (open) => {
  if (open && poolListEl.value) {
    poolListEl.value.scrollTop = 0;
  }
});

// The add-confirmation flash. Toggling through null re-arms it even
// when the same card flashes twice in a row (re-add after an undo), and
// un-sticks a flash whose animationend never fired (unmounted
// mid-flash, display: none ancestor, reduced motion).
async function flashCard(exerciseId: string): Promise<void> {
  flashExerciseId.value = null;
  await nextTick();
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
// its notice there; a success flows back down as the new name prop. A
// failed write says so too (the loud-on-device rule: the name reverting
// with no word is a silent failure).
async function handleRename(exerciseId: string, name: string): Promise<void> {
  const target = props.id;
  renameNotice.value = null;
  const outcome = await workbench.renameWorkout(exerciseId, name);
  if (target !== props.id) {
    // The screen moved to another circuit while the write was queued;
    // the verdict belongs to the old one.
    return;
  }
  if (outcome.kind === 'rejected') {
    renameNotice.value = { exerciseId, message: outcome.message };
  } else if (outcome.kind === 'failed') {
    renameNotice.value = { exerciseId, message: "Couldn't save // try again" };
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
// silently steals), surface the domain's verdict on the name, or say a
// failed write failed (the entry already folded and took the typed name
// with it - silence here loses the user's work without a word).
async function handleCreate(name: string): Promise<void> {
  const target = props.id;
  createNotice.value = null;
  const outcome = await workbench.createWorkout(name);
  if (target !== props.id) {
    return;
  }
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
    return;
  }
  createNotice.value = "Couldn't save // try again";
}
</script>

<template>
  <AppShell>
    <div
      ref="workbenchEl"
      class="workbench"
      :class="{ 'workbench--lifted': drag.state.draggingId !== null }"
    >
      <ScreenHeader :title="headerTitle" back-label="Circuits" :back-to="{ name: 'circuits' }">
        <template #eyebrow>{{ eyebrowText }}</template>
      </ScreenHeader>

      <template v-if="status === 'ready'">
        <!-- The zones own the space below the header and nothing else,
             so --zone-circuit's split is measured against exactly what
             the eye measures it against. While a card is lifted each
             filter REGION inside (circuit zone, pool stock, forge slot)
             steps DOWN one luminance grade EXCEPT the armed one - the
             lit region IS the armed tell (crossing-tick pick,
             2026-07-16) - and steps back on the exit, all in steps(), a
             display losing a grade, never a fade. The drag ghost and
             transients must never be a filtered region's descendant:
             the filter would become their containing block. -->
        <div class="workbench__zones">
          <div
            ref="circuitZoneEl"
            class="workbench__circuit-zone scrolly"
            :class="regionClasses('circuit')"
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
                  <div v-else class="workbench__rack-slot" :data-rack-id="row.slot.exerciseId">
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

          <div ref="poolEl" class="workbench__pool">
            <!-- The seam tick: a one-shot flash of the white raster
                 line on the circuit/pool seam the finger just crossed
                 (crossing-tick pick). The count keys it, so a recross
                 mid-flash restarts the flash instead of stalling it. -->
            <span
              v-if="seamTickCount > 0"
              :key="seamTickCount"
              class="workbench__seam-tick"
              aria-hidden="true"
            ></span>
            <div class="workbench__pool-stock" :class="regionClasses('pool')">
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
                <!-- The content wrapper exists to be measured (see the
                     circuit zone's twin); the TransitionGroup inside
                     slides stock rows around the berth while a card is
                     lifted, and swaps to the settle name post-drop so
                     commits snap (the rack's pattern). -->
                <div ref="poolContentEl">
                  <TransitionGroup
                    tag="div"
                    :name="drag.state.draggingId ? 'pool-shift' : 'pool-settle'"
                    class="workbench__pool-items"
                  >
                    <template
                      v-for="row in poolRows"
                      :key="row.kind === 'card' ? row.entry.exerciseId : 'pool-berth'"
                    >
                      <div v-if="row.kind === 'berth'" class="workbench__berth"></div>
                      <WorkoutCard
                        v-else
                        :data-card-id="row.entry.exerciseId"
                        :name="row.entry.name"
                        :sets="row.entry.sets"
                        :rest-seconds="row.entry.restSeconds"
                        variant="pool"
                        addable
                        :drag-anywhere="!poolScrolls"
                        :open="openCardId === row.entry.exerciseId"
                        :dragging="drag.state.draggingId === row.entry.exerciseId"
                        :notice="noticeFor(row.entry.exerciseId)"
                        @toggle="toggleCard(row.entry.exerciseId)"
                        @adjust="(field, delta) => adjust(row.entry.exerciseId, field, delta)"
                        @add="() => void addTapped(row.entry.exerciseId)"
                        @rename="(name) => void handleRename(row.entry.exerciseId, name)"
                        @drag-start="
                          (event) => void startCardDrag('pool', row.entry.exerciseId, event)
                        "
                      />
                    </template>
                    <PoolGroupHeader
                      v-if="pool.heldElsewhere.length > 0"
                      key="elsewhere-header"
                      label="In Other Circuits"
                      variant="elsewhere"
                    />
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
                  </TransitionGroup>
                </div>
              </div>
            </div>
            <!-- The forge docks below the pool list, outside its scroll:
                 always in view however long the pool grows, and always
                 laid out so the drag can measure its boundary. The place
                 that makes workouts is the place that unmakes them
                 (STYLEGUIDE section 9). -->
            <ForgeSlot
              ref="forgeSlotRef"
              class="workbench__forge-dock"
              :class="regionClasses('forge')"
              :fx="forgeFx"
              :lifted="drag.state.draggingId !== null"
              :armed="drag.state.forgeArmed"
            >
              <PoolCreateRow :notice="createNotice" @create="(name) => void handleCreate(name)" />
            </ForgeSlot>
            <TrashSnackbar
              v-if="trashToast"
              class="workbench__snack-dock"
              :message="trashToast.verdict ?? `${trashToast.name} deleted`"
              :undoable="trashToast.verdict === null"
              @undo="() => void undoTrashTapped()"
            />
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
      v-if="draggedContent"
      class="workbench__drag-ghost"
      :class="{ 'workbench__drag-ghost--yield': drag.state.forgeArmed }"
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <div class="workbench__ghost-card">
        <TransientCardGhost :content="draggedContent" />
        <!-- A lifted elsewhere row carries a FROM <owner> strip - the
             move's consequence stays stated even on the drag path. -->
        <p v-if="draggedContent.kind === 'elsewhere'" class="workbench__ghost-from">
          From {{ draggedContent.owner }}
        </p>
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
      <TransientCardGhost :content="consumeGhost.content" />
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
      <TransientCardGhost :content="flyGhost.content" />
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

/* The page's luminance grammar (signal-rewrite; re-scoped per REGION by
   the crossing-tick pick, 2026-07-16): while a card is lifted every
   region steps one grade DOWN in two hard steps EXCEPT the armed one,
   which simply keeps - or, on a zone handoff, snaps back to - full
   luminance. Arming is instant, disarming is the stepped transient, and
   the lit region IS the armed tell (the red zone rings are retired). On
   the exit the still-receded regions step back UP - late on a consume
   (the impact plays first); the region armed at release is already lit
   and plays nothing. steps(), never a fade: a display losing a grade is
   a transient, and peripheral vision keys on transients. */
.workbench__region--receded {
  animation: region-recede calc(var(--motion-morph) * 0.6) steps(2, end) forwards;
}

.workbench__region--restoring {
  animation: region-restore calc(var(--motion-morph) * 0.5) steps(2, end) both;
}

.workbench__region--restoring-late {
  animation-duration: calc(var(--motion-consume) * 0.28);
  animation-delay: calc(var(--motion-consume) * 0.72);
}

@keyframes region-recede {
  to {
    filter: var(--lift-recede);
  }
}

@keyframes region-restore {
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

  /* Breathing room between the cards and the zone edge. */
  padding: var(--space-1);
  overflow-y: auto;
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
   to the lifted card. Passive (neutral dashes, no accent) - the lifted
   card alone carries the red (the armed zone states itself by staying
   LIT, crossing-tick pick); red means the action, not the
   destination. */
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
  .slot-shift-move,
  .pool-shift-move {
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

/* The pool's filter region (relight): the stock only - the forge below
   is its own region (an armed pool must not light the forge face), and
   the snackbar, outside both, never dims. Takes over the pool's column
   flow so the list geometry is unchanged. */
.workbench__pool-stock {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The seam-crossing tick: one flash of the white raster line ON the
   pool's top border - the seam the finger just crossed. White is the
   EVENT channel (signal-rewrite): the crossing is marked without
   spending red, one shot, never a loop. Only this seam wears it; the
   forge boundary keeps its own armed language. */
.workbench__seam-tick {
  position: absolute;
  top: calc(-1 * var(--rule));
  right: 0;
  left: 0;
  z-index: var(--z-float);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--raster);
  animation: seam-tick var(--motion-tick) steps(3, end) both;
}

@keyframes seam-tick {
  from {
    opacity: 1;
  }

  to {
    opacity: 0;
  }
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

/* The berth: the pool's landing preview - an anonymous open slot in the
   stock at stock-row height, dashed steel. No number (loose stock is
   unordered where the rack is numbered), no accent, no glow (supply
   does not emit light): the rack's numbered gap and this berth are one
   slot-grammar in two dresses. */
.workbench__berth {
  min-height: var(--tap-min);
  border: var(--hairline) dashed var(--supply);
}

/* Stock rows slide to make room for the berth while a card is lifted:
   functional motion (the berth previews the drop outcome). Same
   leave-active trick as the rack: TransitionGroup keeps leavers in the
   DOM ~2 frames, and in-flow they would inflate the pool by a row at
   the berth swap. Post-drop renders swap to the settle name (no move
   transition), so commits snap. */
.pool-shift-move {
  transition: transform var(--motion-slide) ease;
}

.pool-shift-leave-active,
.pool-settle-leave-active {
  position: absolute;
  opacity: 0;
}

/* The forge's dock below the pool list; the slot itself (face, raster,
   exit keyframes) is ForgeSlot's. */
.workbench__forge-dock {
  flex: none;
  margin: var(--space-2) 0 var(--space-3);
}

/* The consume snackbar's dock, over the forge region; the snackbar owns
   its dress and entrance. */
.workbench__snack-dock {
  position: absolute;
  right: 0;
  bottom: var(--space-3);
  left: 0;
  z-index: var(--z-float);
}

/* While a card is lifted the rest of the screen goes inert: the drag
   itself listens on document, but a second finger must not click the
   covered create row (focusing its entry pops the keyboard, which
   resizes the viewport and invalidates the FROZEN zone boundaries),
   fold cards, tick steppers, or tap Undo under the pending drop.
   Multi-touch discipline for the tap surfaces, matching the pointer-id
   filtering the listeners already do. */
.workbench--lifted .workbench__circuit-zone,
.workbench--lifted .workbench__pool-stock,
.workbench--lifted .workbench__forge-dock,
.workbench--lifted .workbench__snack-dock {
  pointer-events: none;
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
   jump - the receded page applies statically and transients simply
   appear/disappear (ForgeSlot and TrashSnackbar carry their own
   carve-outs). */
@media (prefers-reduced-motion: reduce) {
  .workbench__region--receded,
  .workbench__region--restoring,
  .workbench__drag-ghost,
  .workbench__ghost-card,
  .workbench__fly-ghost {
    transition: none;
    animation: none;
  }

  .workbench__region--receded {
    filter: var(--lift-recede);
  }

  .workbench__seam-tick {
    display: none;
  }

  .workbench__consume-ghost,
  .workbench__tvline {
    display: none;
  }
}
</style>
