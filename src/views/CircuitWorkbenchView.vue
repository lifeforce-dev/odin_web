<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import AppShell from '@/components/AppShell.vue';
import ForgeSlot from '@/components/ForgeSlot.vue';
import NavUpRow from '@/components/NavUpRow.vue';
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

// The circuit workbench: the circuit's ordered cards on top, the
// workout pool below. The docked create row doubles as the forge (the
// delete target) while a card is lifted; its face and exit
// choreography live in ForgeSlot and useForgeChoreography. This screen
// owns the drag session, zone layout, and persistence wiring.

const props = defineProps<{
  id: string;
}>();

const db = useDb();
const workbench = useWorkbench(db, () => props.id);
const { status, circuitName, slots, pool } = workbench;

// One fold open at a time across both zones: a card's editor or an
// elsewhere row's steal strip, keyed by exercise id.
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

// A zone that scrolls needs the swipe gesture, so its cards drag by
// the grip alone; a zone whose content fits lets the whole card drag.
const circuitScrolls = useOverflow(circuitZoneEl, circuitContentEl);
const poolScrolls = useOverflow(poolListEl, poolContentEl);

// True when the release committed a change; the exit choreography uses
// it to tell a commit from a put-back. Reset when a lift begins.
let dropCommitted = false;

const drag = useWorkbenchDrag({
  measureSlotMidpoints,
  measurePoolTop: () => poolEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  // The forge is always laid out outside the pool's scroll, so its
  // boundary is measurable when the drag begins.
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

// While a card is lifted every region (circuit zone, pool stock, forge
// slot) steps down one luminance grade except the one the drop would
// land in. Relighting is the absence of the recede class, so there is
// no lit style to drift out of sync.

// The zone armed when the drag ended: the exit restore skips it, since
// region-restore animates from the receded grade and would flash the
// already-lit region dark.
const lastArmedZone = ref<WorkbenchDragZone | null>(null);

// The seam tick renders while > 0; the count keys the element so a
// recross mid-flash remounts and restarts the flash.
const seamTickCount = ref(0);
const seamTickShot = useOneShot();

watch(drag.armedZone, (zone, previous) => {
  if (zone !== null) {
    lastArmedZone.value = zone;
  }
  // Only a circuit/pool crossing ticks; lift, release, and the forge
  // boundary are not crossings.
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

// The armed region gets no class and simply stays at full luminance.
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
    // A different circuit is a fresh screen: reset everything keyed to
    // the old circuit's ids, and reload() flips status to loading
    // before the old content can take a stale tap.
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

// Blank while loading: a placeholder would flash for a frame before
// the real name lands. The fallback covers the missing/error states.
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

// While a lifted circuit card is over the circuit it leaves the list
// and a landing gap opens at the insertion point; a lifted pool card
// is not in the list, so the same gap previews its insertion. The gap
// index counts non-dragged rows only, matching measureSlotMidpoints.
// rackIndex is the row's committed position and the gap wears the
// index it previews, so mid-drag a number can duplicate a neighbor's.
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

function rackBadge(index: number): string {
  return String(index).padStart(2, '0');
}

// Measured from offsetTop, never getBoundingClientRect: rects include
// the in-flight FLIP transforms, so measuring mid-animation feeds
// animating positions back into the insertion test and the gap flaps.
// Measured on the rack wrappers, not the cards inside: the wrappers
// carry the FLIP transform, offsetTop only ignores the measured
// element's own transform, and a transformed ancestor becomes its
// descendants' offsetParent, so a card inside a sliding wrapper
// measures ~0.
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

// The drag session tracks exercise ids; persistence wants item ids.
function applyReorder(draggedExerciseId: string, insertAt: number): void {
  const dragged = slots.value.find((slot) => slot.exerciseId === draggedExerciseId);
  if (!dragged) {
    return;
  }
  const orderedIds = slots.value.map((slot) => slot.id);
  void workbench.reorderSlots(orderAfterDrop(orderedIds, dragged.id, insertAt));
}

// An exercise renders in exactly one zone, so one lookup finds it.
// jsdom lacks scrollIntoView, hence the feature check.
function revealCard(exerciseId: string): void {
  const card = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (card && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// Opening a fold can push the editor below a scrolling zone's fold, so
// every open scrolls the card back into view.
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

// Waits out the re-render after the caller closed any open fold: drag
// measurements must describe settled geometry. The finger keeps moving
// during the tick with no session listening yet, so the freshest move
// is carried across (beginning from the original event painted the
// ghost frames behind the finger). A release during the tick returns
// null: the flick ended before the drag could begin, and starting
// anyway would leave the ghost stuck.
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
  // Lifting closes every open fold: one live interaction at a time,
  // and the measurements need closed-card geometry.
  openCardId.value = null;
  dropCommitted = false;
  const liveEvent = await settleGeometry(event);
  const card = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (!liveEvent || !card) {
    return;
  }
  drag.begin(origin, exerciseId, liveEvent, card.getBoundingClientRect());
}

// One content lookup serves the drag ghost, the berth test, and the
// exit choreography.
const draggedContent = computed<TransientCard | null>(() =>
  drag.state.draggingId !== null ? cardContent(drag.state.draggingId) : null,
);

// The pool's landing preview: while the pool is armed a berth opens
// where releasing sends the card. A lifted pool card's own row becomes
// the berth; a circuit-origin card docks at the top of the stock (a
// fixed spot stays visible where the true sorted position could open
// below the scroll; the stock reloads sorted after the drop). An
// elsewhere-origin card returns to its own group and opens no berth.
type PoolRow = { kind: 'card'; entry: PoolAvailableEntry } | { kind: 'berth' };

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

// A pool scrolled down would open the top berth out of view, so snap
// the list to the top.
watch(topBerthOpen, (open) => {
  if (open && poolListEl.value) {
    poolListEl.value.scrollTop = 0;
  }
});

// Toggling through null re-arms the flash when the same card flashes
// twice in a row, and un-sticks one whose animationend never fired.
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

// The verdict renders on the card that asked; a success flows back
// down as the new name prop.
async function handleRename(exerciseId: string, name: string): Promise<void> {
  const target = props.id;
  renameNotice.value = null;
  const outcome = await workbench.renameWorkout(exerciseId, name);
  if (target !== props.id) {
    // The screen moved to another circuit while the write was in
    // flight; the verdict belongs to the old one.
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

// Add or steal follows from where the exercise lives right now.
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

// Create stays in the pool (no auto-add) and never silently steals. A
// failed write must say so: the entry already folded and took the
// typed name with it.
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
      <ScreenHeader :title="headerTitle">
        <template #eyebrow>{{ eyebrowText }}</template>
      </ScreenHeader>

      <template v-if="status === 'ready'">
        <!-- The zones own only the space below the header, so
             --zone-circuit splits exactly what the eye sees. The drag
             ghost and transients must never be a filtered region's
             descendant: a filter becomes the containing block for
             their position: fixed. -->
        <div class="workbench__zones">
          <div
            ref="circuitZoneEl"
            class="workbench__circuit-zone scrolly"
            :class="regionClasses('circuit')"
          >
            <!-- Exists to be measured: a scroll container's own box
                 never resizes when content changes, so useOverflow
                 watches the content for the change and the container
                 for the answer. -->
            <div ref="circuitContentEl">
              <p v-if="displayRows.length === 0" class="workbench__empty-hint">
                Tap a workout below to open it // drag it up to place
              </p>
              <!-- Move transitions run only while dragging: releasing
                   means "keep what I see", so the drop renders under a
                   name with no move transition and snaps. -->
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
            <!-- Flashes the seam the finger just crossed. -->
            <span
              v-if="seamTickCount > 0"
              :key="seamTickCount"
              class="workbench__seam-tick"
              aria-hidden="true"
            ></span>
            <div class="workbench__pool-stock" :class="regionClasses('pool')">
              <p class="workbench__pool-label">Workouts</p>
              <!-- AVAILABLE docks outside the scroll: it names the
                   default group and stays put while the cards scroll.
                   IN OTHER CIRCUITS marks a boundary inside the
                   scrolled content, so it scrolls with it. -->
              <PoolGroupHeader
                class="workbench__pool-available"
                label="Available"
                variant="available"
              />
              <div ref="poolListEl" class="workbench__pool-list scrolly">
                <!-- Exists to be measured, like the circuit zone's
                     wrapper. -->
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
            <!-- Docked outside the pool's scroll: always in view and
                 always laid out, so the drag can measure its
                 boundary. -->
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

    <!-- Positioned by transform, never left/top: the ghost follows
         every pointermove, and left/top would re-run layout and paint
         per move. -->
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
        <p v-if="draggedContent.kind === 'elsewhere'" class="workbench__ghost-from">
          From {{ draggedContent.owner }}
        </p>
      </div>
    </div>

    <!-- The trashed card collapses to a line that darts into the
         forge. Position rides in the --cg-* props because the
         keyframes own transform. Pure paint: the delete has already
         landed. -->
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

    <!-- A put-back flies the card home to its row. -->
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

    <template #action>
      <!-- The slot content sits outside .workbench--lifted's descendant
           selectors, so the mid-drag inert rule reaches it only through
           this class. -->
      <NavUpRow :class="{ 'workbench__up--inert': drag.state.draggingId !== null }" />
    </template>
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

/* The zone pair only; the header is deliberately outside so
   --zone-circuit splits just the zone area. */
.workbench__zones {
  /* Designer knob: the circuit zone's share of the zone area, in parts
     of 100. Expressed as grow ratios over a zero basis: a flex-basis
     percentage measures against the screen including the header, so
     the drawn split drifts from what the number says. */
  --zone-circuit: 55;

  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* While a card is lifted every region steps one grade down in hard
   steps except the armed one, which stays at full luminance. On the
   exit the receded regions step back up, late on a consume so the
   impact plays first; the region armed at release is already lit and
   plays nothing. */
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

/* Every committed row is a numbered socket. */
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
   to the lifted card. Neutral on purpose: the lifted card alone
   carries the accent. */
.workbench__rack-slot--gap .workbench__rack-index {
  color: var(--text-dim);
  border-style: dashed;
}

.workbench__rack-vacant {
  flex: 1 1 auto;
  border: var(--hairline) dashed var(--border-strong);
  border-left: none;
}

/* Rows slide to make room while a card is lifted. */
.slot-shift-move {
  transition: transform var(--motion-slide) ease;
}

/* Leaving rows must vacate the flow immediately: TransitionGroup keeps
   a removed element in the DOM for ~2 frames even with no leave
   animation declared, and in flow that phantom inflates the zone by
   one row. Absolute + transparent is the documented move-transitions
   pattern:
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

/* The pool's filter region covers the stock only: the forge is its own
   region, and the snackbar outside both never dims. */
.workbench__pool-stock {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* One flash on the pool's top border, the seam the finger just
   crossed. */
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

/* Matches the list's gap so the header keeps the in-list rhythm. */
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

/* Headers get extra air above so the groups read as sections. */
.workbench__pool-items .pool-group {
  margin-top: var(--space-1);
}

.workbench__pool-items .pool-group:first-child {
  margin-top: 0;
}

/* The pool's landing preview: an open slot at stock-row height,
   unnumbered because loose stock is unordered. */
.workbench__berth {
  min-height: var(--tap-min);
  border: var(--hairline) dashed var(--supply);
}

/* Stock rows slide to make room for the berth; same leave-active trick
   as the rack above. */
.pool-shift-move {
  transition: transform var(--motion-slide) ease;
}

.pool-shift-leave-active,
.pool-settle-leave-active {
  position: absolute;
  opacity: 0;
}

/* Only the dock; the slot's face and keyframes are ForgeSlot's. */
.workbench__forge-dock {
  flex: none;
  margin: var(--space-2) 0 var(--space-3);
}

/* Only the dock; the snackbar owns its dress and entrance. */
.workbench__snack-dock {
  position: absolute;
  right: 0;
  bottom: var(--space-3);
  left: 0;
  z-index: var(--z-float);
}

/* While a card is lifted the tap surfaces go inert: a second finger
   focusing the create row would pop the keyboard, resize the viewport,
   and invalidate the frozen zone boundaries. The up row joins through
   its own class because the #action slot renders outside .workbench's
   tree, out of reach of a descendant selector. */
.workbench--lifted .workbench__circuit-zone,
.workbench--lifted .workbench__pool-stock,
.workbench--lifted .workbench__forge-dock,
.workbench--lifted .workbench__snack-dock,
.workbench__up--inert {
  pointer-events: none;
}

/* The wrapper only positions the real card and adds the lifted glow.
   will-change promotes it to its own layer at mount, so the first
   frames do not repaint mid-gesture. */
.workbench__drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  opacity: 0.94;
  will-change: transform;

  /* A stepped micro-flicker on lift, then held one grade bright. */
  filter: brightness(1.05);
  animation: ghost-lift calc(var(--motion-morph) * 0.7) steps(3, end);
}

/* Over the armed forge the card yields: desaturated and slightly
   small. The scale rides the inner wrapper because the outer
   transform is the pointer-follow. */
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

/* The FROM <owner> strip under a lifted elsewhere row. */
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

/* The card collapses to a bright line like a switched-off tube. The
   keyframes own transform, so position rides in the --cg-* props. */
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

/* The collapsed line darting into the forge. */
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

/* A put-back flies the card home; the fade keeps it from
   double-exposing over the real row it lands on. */
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

/* Reduced motion: transients appear and disappear, and the receded
   state applies statically. */
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
