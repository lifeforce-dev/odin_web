<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

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
import type { CircuitSlot } from '@/domain/builder';

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

const drag = useWorkbenchDrag({
  measureSlotMidpoints,
  measurePoolTop: () => poolEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  // The create slot doubles as the trash (the forge rule): it is always
  // laid out and outside the pool's scroll, so its boundary is
  // measurable at begin() before the trash face fades in over it.
  measureTrashTop: () => trashEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  onReorder: applyReorder,
  onRemove: (exerciseId) => {
    const held = slots.value.find((slot) => slot.exerciseId === exerciseId);
    if (held) {
      void workbench.removeSlot(held.id);
    }
  },
  onAdd: applyPoolDrop,
  onTrash: (exerciseId) => {
    void workbench.trashWorkout(exerciseId);
  },
});

onMounted(() => {
  void workbench.load();
});
watch(
  () => props.id,
  () => {
    // A different circuit is a fresh screen: per-circuit UI state must
    // not leak across (an open fold, notice, or running flash keyed to
    // the old circuit's ids).
    openCardId.value = null;
    flashExerciseId.value = null;
    createNotice.value = null;
    renameNotice.value = null;
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
type SlotListRow = { kind: 'slot'; slot: CircuitSlot } | { kind: 'gap' };

const displayRows = computed<SlotListRow[]>(() => {
  const draggedId = drag.state.draggingId;
  const gapAt = drag.state.gapIndex;
  const reordering = draggedId !== null && gapAt !== null;
  const rows: SlotListRow[] = slots.value
    .filter((slot) => !(reordering && slot.exerciseId === draggedId))
    .map((slot) => ({ kind: 'slot', slot }));
  if (reordering) {
    rows.splice(Math.min(gapAt, rows.length), 0, { kind: 'gap' });
  }
  return rows;
});

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
// Circuit cards and available pool cards normalize to one shape here -
// they are the same control.
const draggedCard = computed<{ name: string; sets: number; restSeconds: number } | null>(() => {
  const draggedId = drag.state.draggingId;
  if (draggedId === null) {
    return null;
  }
  if (drag.state.origin === 'circuit') {
    const slot = slots.value.find((entry) => entry.exerciseId === draggedId);
    return slot
      ? { name: slot.exerciseName, sets: slot.sets, restSeconds: slot.restSeconds }
      : null;
  }
  const free = pool.value.available.find((entry) => entry.exerciseId === draggedId);
  return free ? { name: free.name, sets: free.sets, restSeconds: free.restSeconds } : null;
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
             the eye measures it against. -->
        <div class="workbench__zones">
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
                    class="workbench__slot-gap"
                    :style="{ height: `${drag.state.ghostHeight}px` }"
                  ></div>
                  <WorkoutCard
                    v-else
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
            <!-- The forge (02-07 trash pick): the create row docked
                 below the list doubles as the delete target. Idle it
                 creates; while any card is lifted the trash face fades
                 in over it (standby); with the ghost on it, the face
                 arms. Always laid out, so the boundary is measurable at
                 drag start. Dropping here deletes the workout entirely,
                 from either zone. -->
            <div
              ref="trashEl"
              class="workbench__create-slot"
              :class="{ 'workbench__create-slot--lifted': drag.state.draggingId !== null }"
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
                &times; Delete
              </p>
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
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <WorkoutCard
        :name="draggedCard.name"
        :sets="draggedCard.sets"
        :rest-seconds="draggedCard.restSeconds"
      />
    </div>
    <div
      v-else-if="draggedElsewhere"
      class="workbench__drag-ghost"
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <PoolElsewhereRow :name="draggedElsewhere.name" :owner="draggedElsewhere.ownerCircuitName" />
      <p class="workbench__ghost-from">From {{ draggedElsewhere.ownerCircuitName }}</p>
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

/* The landing gap: where the lifted card will drop. Passive (neutral
   dashes, no accent) - the armed zone ring and the lifted card carry the
   red; red means the action, not the destination. */
.workbench__slot-gap {
  border: var(--hairline) dashed var(--border-strong);
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

.workbench__create {
  transition: opacity var(--motion-press);
}

.workbench__create-slot--lifted .workbench__create {
  opacity: 0;
}

/* The trash face. Standby wears NO red - dashes and dim ink, because
   dashes already mean "a row can land here" in this screen's language
   and red is reserved for the pending action (red scarcity: the old
   band was solid alarm-red from the first frame of every drag). Never
   interactive: drops resolve by coordinates, not events. */
.workbench__trash-face {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-dim);
  font-size: var(--type-body);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
  pointer-events: none;
  border: var(--rule) dashed var(--border-strong);
  opacity: 0;
  transition: opacity var(--motion-press);
}

.workbench__create-slot--lifted .workbench__trash-face {
  opacity: 1;
}

.workbench__trash-face--armed {
  color: var(--accent);
  background: var(--surface-alarm);
  border-style: solid;
  border-color: var(--accent);
  box-shadow: var(--glow-zone-armed);
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
</style>
