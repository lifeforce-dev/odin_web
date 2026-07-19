<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import AppShell from '@/components/AppShell.vue';
import DeleteTarget from '@/components/DeleteTarget.vue';
import InlineNameEntry from '@/components/InlineNameEntry.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import LibraryCreateRow from '@/components/LibraryCreateRow.vue';
import LibraryElsewhereRow from '@/components/LibraryElsewhereRow.vue';
import LibraryGroupHeader from '@/components/LibraryGroupHeader.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TransientCardGhost from '@/components/TransientCardGhost.vue';
import TrashSnackbar from '@/components/TrashSnackbar.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import { measureRowMidpoints } from '@/composables/measure-midpoints';
import { badgeNumber } from '@/composables/badge-number';
import { settlePointer } from '@/composables/settle-pointer';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useCardExitAnimation } from '@/composables/useCardExitAnimation';
import type { TransientCard } from '@/composables/useCardExitAnimation';
import { useOneShot } from '@/composables/useOneShot';
import { useOverflow } from '@/composables/useOverflow';
import { orderAfterDrop, useWorkbenchDrag } from '@/composables/useWorkbenchDrag';
import type { WorkbenchDragZone } from '@/composables/useWorkbenchDrag';
import { useWorkbench } from '@/composables/useWorkbench';
import type { PrescriptionField } from '@/composables/useWorkbench';
import type { CircuitSlot, LibraryAvailableEntry } from '@/domain/builder';
import { MOTION_TICK_MS } from '@/styles/motion';

// The circuit workbench: the circuit's ordered cards on top, the
// workout library below. The docked create row doubles as the delete target
// while a card is lifted; its face and exit animations live in DeleteTarget
// and useCardExitAnimation. This screen
// owns the drag session, zone layout, and persistence wiring.

const props = defineProps<{
  id: string;
}>();

const db = useDb();
const workbench = useWorkbench(db, () => props.id);
const { status, circuitName, slots, library } = workbench;

// One fold open at a time across both zones: a card's editor or an
// elsewhere row's steal strip, keyed by exercise id.
const openCardId = ref<string | null>(null);
const flashExerciseId = ref<string | null>(null);
const createNotice = ref<string | null>(null);
const renameNotice = ref<{ exerciseId: string; message: string } | null>(null);

// The title pencil's rename state: the header swaps for an inline
// entry seeded with the current name until it commits or cancels.
const renamingCircuit = ref(false);
const circuitRenameNotice = ref<string | null>(null);

const workbenchEl = ref<HTMLElement | null>(null);
const circuitZoneEl = ref<HTMLElement | null>(null);
const circuitContentEl = ref<HTMLElement | null>(null);
const libraryEl = ref<HTMLElement | null>(null);
const libraryListEl = ref<HTMLElement | null>(null);
const libraryContentEl = ref<HTMLElement | null>(null);
const deleteTargetRef = ref<InstanceType<typeof DeleteTarget> | null>(null);

// A zone that scrolls needs the swipe gesture, so its cards drag by
// the grip alone; a zone whose content fits lets the whole card drag.
const circuitScrolls = useOverflow(circuitZoneEl, circuitContentEl);
const libraryScrolls = useOverflow(libraryListEl, libraryContentEl);

// True when the release committed a change; the exit animation uses it to
// tell a commit from a cancelled drag. Reset when a lift begins.
let dropCommitted = false;

const drag = useWorkbenchDrag({
  measureSlotMidpoints,
  measureLibraryTop: () => libraryEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  // The delete target is always laid out outside the library's scroll, so its
  // top edge is measurable when the drag begins.
  measureDeleteTop: () =>
    deleteTargetRef.value?.rootEl?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
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
    applyLibraryDrop(exerciseId, insertAt);
  },
  onTrash: onDeleteDrop,
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
  const free = library.value.available.find((entry) => entry.exerciseId === exerciseId);
  if (free) {
    return {
      kind: 'card',
      name: free.name,
      sets: free.sets,
      restSeconds: free.restSeconds,
      variant: 'library',
    };
  }
  const held = library.value.heldElsewhere.find((entry) => entry.exerciseId === exerciseId);
  return held ? { kind: 'elsewhere', name: held.name, owner: held.ownerCircuitName } : null;
}

const cardExit = useCardExitAnimation({
  dragState: drag.state,
  cardContent,
  findRowEl: (exerciseId) =>
    workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`) ?? null,
  measureDeleteTargetY: () => deleteTargetRef.value?.rootEl?.getBoundingClientRect().top ?? null,
  wasDropCommitted: () => dropCommitted,
  trashWorkout: workbench.trashWorkout,
  undoTrash: workbench.undoTrash,
});
const { exitFx, deleteGhost, returnGhost, trashToast, undoTrashTapped } = cardExit;

function onDeleteDrop(exerciseId: string): void {
  dropCommitted = true;
  cardExit.onTrashDrop(exerciseId);
}

// While a card is lifted every region (circuit zone, library list, delete
// target) steps down one luminance grade except the one the drop would
// land in. Relighting is the absence of the dim class, so there is
// no lit style to drift out of sync.

// The zone armed when the drag ended: the exit restore skips it, since
// region-restore animates from the dimmed grade and would flash the
// already-lit region dark.
const lastArmedZone = ref<WorkbenchDragZone | null>(null);

// The boundary tick renders while > 0; the count keys the element so a
// recross mid-flash remounts and restarts the flash.
const boundaryTickCount = ref(0);
const boundaryTickShot = useOneShot();

watch(drag.armedZone, (zone, previous) => {
  if (zone !== null) {
    lastArmedZone.value = zone;
  }
  // Only a circuit/library crossing ticks; lift, release, and the delete
  // target boundary are not crossings.
  const crossed =
    (zone === 'library' && previous === 'circuit') ||
    (zone === 'circuit' && previous === 'library');
  if (!crossed) {
    return;
  }
  boundaryTickCount.value += 1;
  boundaryTickShot.set(() => {
    boundaryTickCount.value = 0;
  }, MOTION_TICK_MS);
});

// The armed region gets no class and simply stays at full luminance.
function regionClasses(region: WorkbenchDragZone): Record<string, boolean> {
  const lifted = drag.state.draggingId !== null;
  const restoring = !lifted && exitFx.value !== 'idle' && lastArmedZone.value !== region;
  return {
    'workbench__region--dimmed': lifted && drag.armedZone.value !== region,
    'workbench__region--restoring': restoring,
    'workbench__region--restoring-late': restoring && exitFx.value === 'delete',
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
    renamingCircuit.value = false;
    circuitRenameNotice.value = null;
    cardExit.reset();
    boundaryTickShot.cancel();
    boundaryTickCount.value = 0;
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
// and a landing gap opens at the insertion point; a lifted library card
// is not in the list, so the same gap previews its insertion. The gap
// index counts non-dragged rows only, matching measureSlotMidpoints.
// slotNumber is the row's committed 1-based position and the gap wears
// the number it previews, so mid-drag a number can duplicate a neighbor's.
type SlotListRow =
  { kind: 'slot'; slot: CircuitSlot; slotNumber: number } | { kind: 'gap'; slotNumber: number };

const displayRows = computed<SlotListRow[]>(() => {
  const draggedId = drag.state.draggingId;
  const gapAt = drag.state.gapIndex;
  const reordering = draggedId !== null && gapAt !== null;
  const rows: SlotListRow[] = slots.value
    .map((slot, index) => ({ kind: 'slot' as const, slot, slotNumber: index + 1 }))
    .filter((row) => !(reordering && row.slot.exerciseId === draggedId));
  if (reordering) {
    rows.splice(Math.min(gapAt, rows.length), 0, { kind: 'gap', slotNumber: gapAt + 1 });
  }
  return rows;
});

// The offsetTop formula and its offsetParent invariant live in
// measureRowMidpoints; the zone's position: relative satisfies it.
function measureSlotMidpoints(draggedId: string): number[] {
  const zone = circuitZoneEl.value;
  return zone ? measureRowMidpoints(zone, 'slotId', draggedId) : [];
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

async function startCardDrag(
  origin: 'circuit' | 'library',
  exerciseId: string,
  event: PointerEvent,
): Promise<void> {
  // Lifting closes every open fold: one live interaction at a time,
  // and the measurements need closed-card geometry.
  openCardId.value = null;
  dropCommitted = false;
  const liveEvent = await settlePointer(event);
  const card = workbenchEl.value?.querySelector<HTMLElement>(`[data-card-id="${exerciseId}"]`);
  if (!liveEvent || !card) {
    return;
  }
  drag.begin(origin, exerciseId, liveEvent, card.getBoundingClientRect());
}

// One content lookup serves the drag ghost, the landing-gap test, and the
// exit animation.
const draggedContent = computed<TransientCard | null>(() =>
  drag.state.draggingId !== null ? cardContent(drag.state.draggingId) : null,
);

// The library's landing preview: while the library is armed a gap opens
// where releasing sends the card. A lifted library card's own row becomes
// the gap; a circuit-origin card docks at the top of the list (a fixed spot
// stays visible where the true sorted position could open below the scroll;
// the list reloads sorted after the drop). An elsewhere-origin card returns
// to its own group and opens no gap.
type LibraryRow = { kind: 'card'; entry: LibraryAvailableEntry } | { kind: 'gap' };

const topGapOpen = computed(
  () =>
    drag.state.libraryArmed &&
    draggedContent.value?.kind === 'card' &&
    !library.value.available.some((entry) => entry.exerciseId === drag.state.draggingId),
);

const libraryRows = computed<LibraryRow[]>(() => {
  const rows: LibraryRow[] = library.value.available.map((entry) => ({ kind: 'card', entry }));
  const draggedId = drag.state.draggingId;
  if (!drag.state.libraryArmed || draggedId === null) {
    return rows;
  }
  const ownIndex = library.value.available.findIndex((entry) => entry.exerciseId === draggedId);
  if (ownIndex !== -1) {
    rows.splice(ownIndex, 1, { kind: 'gap' });
    return rows;
  }
  if (topGapOpen.value) {
    rows.unshift({ kind: 'gap' });
  }
  return rows;
});

// A library scrolled down would open the top gap out of view, so snap
// the list to the top.
watch(topGapOpen, (open) => {
  if (open && libraryListEl.value) {
    libraryListEl.value.scrollTop = 0;
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
  if (await workbench.addFromLibrary(exerciseId)) {
    await flashCard(exerciseId);
  }
}

async function confirmSteal(exerciseId: string): Promise<void> {
  openCardId.value = null;
  if (await workbench.stealFromLibrary(exerciseId)) {
    await flashCard(exerciseId);
  }
}

// The notice renders on the card that asked; a success flows back
// down as the new name prop.
async function handleRename(exerciseId: string, name: string): Promise<void> {
  const target = props.id;
  renameNotice.value = null;
  const outcome = await workbench.renameWorkout(exerciseId, name);
  if (target !== props.id) {
    // The screen moved to another circuit while the write was in
    // flight; the notice belongs to the old one.
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

function openCircuitRename(): void {
  circuitRenameNotice.value = null;
  renamingCircuit.value = true;
}

// A blank or unchanged commit means cancel - the parent decides, per
// InlineNameEntry's contract. Either way the entry closes; a notice
// only shows when a real rename attempt failed.
async function handleCircuitRenameCommit(name: string): Promise<void> {
  renamingCircuit.value = false;
  if (name.length === 0 || name === circuitName.value) {
    return;
  }
  const target = props.id;
  const outcome = await workbench.renameCircuit(name);
  if (target !== props.id) {
    return;
  }
  if (outcome.kind === 'rejected') {
    circuitRenameNotice.value = outcome.message;
  } else if (outcome.kind === 'failed') {
    circuitRenameNotice.value = "Couldn't save // try again";
  }
}

// Add or steal follows from where the exercise lives right now.
function applyLibraryDrop(exerciseId: string, insertAt: number): void {
  const stolen = library.value.heldElsewhere.some((entry) => entry.exerciseId === exerciseId);
  const landing = stolen
    ? workbench.stealFromLibrary(exerciseId, insertAt)
    : workbench.addFromLibrary(exerciseId, insertAt);
  void landing.then((itemId) => {
    if (itemId) {
      void flashCard(exerciseId);
    }
  });
}

// Create stays in the library (no auto-add) and never silently steals. A
// failed write must say so: the entry already folded and took the
// typed name with it.
async function handleCreate(name: string): Promise<void> {
  const target = props.id;
  createNotice.value = null;
  const outcome = await workbench.createWorkout(name);
  if (target !== props.id) {
    return;
  }
  if (outcome.kind === 'in-library') {
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
      <ScreenHeader
        v-if="!renamingCircuit"
        :title="headerTitle"
        :editable="status === 'ready'"
        @edit="openCircuitRename"
      >
        <template #eyebrow>{{ eyebrowText }}</template>
      </ScreenHeader>
      <!-- The current name is the PLACEHOLDER, not the seed: a created
           circuit lands as "New Circuit", so opening rename on an empty
           entry lets the user type straight over it instead of clearing
           the default first. A blank commit means keep the current name
           (handleCircuitRenameCommit). This is the create-then-name
           flow's ergonomics; the workout card rename stays seeded (there
           the name is real and usually tweaked, not replaced). -->
      <InlineNameEntry
        v-else
        class="workbench__circuit-rename"
        size="display"
        :placeholder="circuitName"
        entry-label="Circuit name"
        confirm-label="Rename circuit"
        @commit="(name) => void handleCircuitRenameCommit(name)"
        @cancel="renamingCircuit = false"
      />
      <p v-if="circuitRenameNotice" class="workbench__circuit-notice">{{ circuitRenameNotice }}</p>

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
                    class="workbench__slot workbench__slot--gap"
                    :style="{ height: `${drag.state.ghostHeight}px` }"
                  >
                    <span class="workbench__slot-number">{{ badgeNumber(row.slotNumber) }}</span>
                    <div class="workbench__slot-vacant"></div>
                  </div>
                  <div v-else class="workbench__slot" :data-slot-id="row.slot.exerciseId">
                    <span class="workbench__slot-number">{{ badgeNumber(row.slotNumber) }}</span>
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

          <div ref="libraryEl" class="workbench__library">
            <!-- Flashes the boundary the finger just crossed. -->
            <span
              v-if="boundaryTickCount > 0"
              :key="boundaryTickCount"
              class="workbench__boundary-tick"
              aria-hidden="true"
            ></span>
            <div class="workbench__library-region" :class="regionClasses('library')">
              <p class="workbench__library-label">Workouts</p>
              <!-- AVAILABLE docks outside the scroll: it names the
                   default group and stays put while the cards scroll.
                   IN OTHER CIRCUITS marks a boundary inside the
                   scrolled content, so it scrolls with it. -->
              <LibraryGroupHeader
                class="workbench__library-available"
                label="Available"
                variant="available"
              />
              <div ref="libraryListEl" class="workbench__library-list scrolly">
                <!-- Exists to be measured, like the circuit zone's
                     wrapper. -->
                <div ref="libraryContentEl">
                  <TransitionGroup
                    tag="div"
                    :name="drag.state.draggingId ? 'library-shift' : 'library-settle'"
                    class="workbench__library-items"
                  >
                    <template
                      v-for="row in libraryRows"
                      :key="row.kind === 'card' ? row.entry.exerciseId : 'library-gap'"
                    >
                      <div v-if="row.kind === 'gap'" class="workbench__library-gap"></div>
                      <WorkoutCard
                        v-else
                        :data-card-id="row.entry.exerciseId"
                        :name="row.entry.name"
                        :sets="row.entry.sets"
                        :rest-seconds="row.entry.restSeconds"
                        variant="library"
                        addable
                        :drag-anywhere="!libraryScrolls"
                        :open="openCardId === row.entry.exerciseId"
                        :dragging="drag.state.draggingId === row.entry.exerciseId"
                        :notice="noticeFor(row.entry.exerciseId)"
                        @toggle="toggleCard(row.entry.exerciseId)"
                        @adjust="(field, delta) => adjust(row.entry.exerciseId, field, delta)"
                        @add="() => void addTapped(row.entry.exerciseId)"
                        @rename="(name) => void handleRename(row.entry.exerciseId, name)"
                        @drag-start="
                          (event) => void startCardDrag('library', row.entry.exerciseId, event)
                        "
                      />
                    </template>
                    <LibraryGroupHeader
                      v-if="library.heldElsewhere.length > 0"
                      key="elsewhere-header"
                      label="In Other Circuits"
                      variant="elsewhere"
                    />
                    <LibraryElsewhereRow
                      v-for="entry in library.heldElsewhere"
                      :key="entry.exerciseId"
                      :data-card-id="entry.exerciseId"
                      :name="entry.name"
                      :owner="entry.ownerCircuitName"
                      :drag-anywhere="!libraryScrolls"
                      :open="openCardId === entry.exerciseId"
                      @toggle="toggleCard(entry.exerciseId)"
                      @close="openCardId = null"
                      @steal="() => void confirmSteal(entry.exerciseId)"
                      @drag-start="
                        (event) => void startCardDrag('library', entry.exerciseId, event)
                      "
                    />
                  </TransitionGroup>
                </div>
              </div>
            </div>
            <!-- Docked outside the library's scroll: always in view and
                 always laid out, so the drag can measure its
                 boundary. -->
            <DeleteTarget
              ref="deleteTargetRef"
              class="workbench__delete-dock"
              :class="regionClasses('delete')"
              :fx="exitFx"
              :lifted="drag.state.draggingId !== null"
              :armed="drag.state.deleteArmed"
            >
              <LibraryCreateRow
                :notice="createNotice"
                @create="(name) => void handleCreate(name)"
              />
            </DeleteTarget>
            <TrashSnackbar
              v-if="trashToast"
              class="workbench__snack-dock"
              :message="trashToast.notice ?? `${trashToast.name} deleted`"
              :undoable="trashToast.notice === null"
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
      :class="{ 'workbench__drag-ghost--yield': drag.state.deleteArmed }"
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

    <!-- The deleted card collapses to a line that flies into the delete
         target. Position rides in the --delete-ghost-* props because the
         keyframes own transform. Pure paint: the delete has already
         landed. -->
    <div
      v-if="deleteGhost"
      class="workbench__delete-ghost"
      :style="{
        '--delete-ghost-x': `${deleteGhost.x}px`,
        '--delete-ghost-y': `${deleteGhost.y}px`,
        width: `${deleteGhost.width}px`,
      }"
      aria-hidden="true"
    >
      <TransientCardGhost :content="deleteGhost.content" />
    </div>
    <span
      v-if="deleteGhost"
      class="workbench__delete-line"
      :style="{
        left: `${deleteGhost.x}px`,
        width: `${deleteGhost.width}px`,
        '--line-from': `${deleteGhost.y + deleteGhost.height / 2}px`,
        '--line-to': `${deleteGhost.targetY}px`,
      }"
      aria-hidden="true"
    ></span>

    <!-- A cancelled drag returns the card to its row. -->
    <div
      v-if="returnGhost"
      class="workbench__return-ghost"
      :style="{
        '--return-from-x': `${returnGhost.x}px`,
        '--return-from-y': `${returnGhost.y}px`,
        '--return-to-x': `${returnGhost.toX}px`,
        '--return-to-y': `${returnGhost.toY}px`,
        width: `${returnGhost.width}px`,
      }"
      aria-hidden="true"
    >
      <TransientCardGhost :content="returnGhost.content" />
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

/* Sits where ScreenHeader's title row would; the eyebrow disappears
   for the duration of the rename. flex: none is load-bearing: the
   entry's root is flex: 1 1 auto for its row call sites, and in this
   column it would grow into the screen's free height and render as a
   giant panel instead of editing in place. */
.workbench__circuit-rename {
  flex: none;
  margin-bottom: var(--space-6);
  border: var(--hairline) solid var(--border-strong);
}

/* Same recipe as workout-card__notice / library-create__notice - these
   move together. */
.workbench__circuit-notice {
  margin: 0 0 var(--space-4);
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
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
   exit the dimmed regions step back up, late on a delete so the
   flash plays first; the region armed at release is already lit and
   plays nothing. */
.workbench__region--dimmed {
  animation: region-dim calc(var(--motion-morph) * 0.6) steps(2, end) forwards;
}

.workbench__region--restoring {
  animation: region-restore calc(var(--motion-morph) * 0.5) steps(2, end) both;
}

.workbench__region--restoring-late {
  animation-duration: calc(var(--motion-delete) * 0.28);
  animation-delay: calc(var(--motion-delete) * 0.72);
}

@keyframes region-dim {
  to {
    filter: var(--lift-dim);
  }
}

@keyframes region-restore {
  from {
    filter: var(--lift-dim);
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
.workbench__slot {
  display: flex;
  align-items: stretch;
}

/* Badge-cell recipe (shared with .circuit-row__order and
   .circuits__gap-index): this one owns its own --bg plate and a full
   border because it sits beside card surfaces in a slot, not a
   row's own surface. */
.workbench__slot-number {
  display: flex;
  flex: 0 0 var(--badge-cell-width);
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

.workbench__slot .workout-card {
  flex: 1 1 auto;
  min-width: 0;
}

/* The landing gap: an open socket wearing the index it previews, sized
   to the lifted card. Neutral on purpose: the lifted card alone
   carries the accent. */
.workbench__slot--gap .workbench__slot-number {
  color: var(--text-dim);
  border-style: dashed;
}

.workbench__slot-vacant {
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
  .library-shift-move {
    transition: none;
  }
}

.workbench__library {
  position: relative;
  display: flex;
  flex: calc(100 - var(--zone-circuit)) 1 0;
  flex-direction: column;
  min-height: 0;
  margin-top: var(--space-2);
  border-top: var(--rule) solid var(--border-strong);
}

/* The library's filter region covers the list only: the delete target is its
   own region, and the snackbar outside both never dims. */
.workbench__library-region {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* One flash on the library's top border, the boundary the finger just
   crossed. */
.workbench__boundary-tick {
  position: absolute;
  top: calc(-1 * var(--rule));
  right: 0;
  left: 0;
  z-index: var(--z-float);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--glow-sweep-line);
  animation: boundary-tick var(--motion-tick) steps(3, end) both;
}

@keyframes boundary-tick {
  from {
    opacity: 1;
  }

  to {
    opacity: 0;
  }
}

.workbench__library-label {
  margin: 0;
  padding: var(--space-2) 0 var(--space-1);
  color: var(--text-soft);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

/* Matches the list's gap so the header keeps the in-list rhythm. */
.workbench__library-available {
  flex: none;
  margin-bottom: var(--space-2);
}

.workbench__library-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.workbench__library-items {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
}

/* Headers get extra air above so the groups read as sections. */
.workbench__library-items .library-group {
  margin-top: var(--space-1);
}

.workbench__library-items .library-group:first-child {
  margin-top: 0;
}

/* The library's landing preview: an open slot at library-row height,
   unnumbered because the library is unordered. */
.workbench__library-gap {
  min-height: var(--tap-min);
  border: var(--hairline) dashed var(--supply);
}

/* Library rows slide to make room for the gap; same leave-active trick
   as the slot list above. */
.library-shift-move {
  transition: transform var(--motion-slide) ease;
}

.library-shift-leave-active,
.library-settle-leave-active {
  position: absolute;
  opacity: 0;
}

/* Only the dock; the slot's face and keyframes are DeleteTarget's. */
.workbench__delete-dock {
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
   tree, out of reach of a descendant selector. Unlike the circuits
   screen's mid-drag rule (which blankets its whole root), this one
   enumerates each tap surface - two scoping strategies, kept
   deliberately unmerged for now. */
.workbench--lifted .workbench__circuit-zone,
.workbench--lifted .workbench__library-region,
.workbench--lifted .workbench__delete-dock,
.workbench--lifted .workbench__snack-dock,
.workbench__up--inert {
  pointer-events: none;
}

/* The wrapper only positions the real card and adds the lifted glow.
   will-change promotes it to its own layer at mount, so the first
   frames do not repaint mid-gesture. --dim-drag-ghost also binds the
   circuits screen's drag ghost. */
.workbench__drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  opacity: var(--dim-drag-ghost);
  will-change: transform;

  /* A stepped micro-flicker on lift, then held one grade bright. */
  filter: brightness(1.05);
  animation: ghost-lift calc(var(--motion-morph) * 0.7) steps(3, end);
}

/* Over the armed delete target the card yields: desaturated and slightly
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
    opacity: var(--dim-drag-ghost);
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

/* The card collapses to a bright line. The keyframes own transform, so
   position rides in the --delete-ghost-* props. */
.workbench__delete-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  animation: card-collapse calc(var(--motion-delete) / 3) steps(4, end) forwards;
  will-change: transform;
}

@keyframes card-collapse {
  0% {
    transform: translate3d(var(--delete-ghost-x), var(--delete-ghost-y), 0);
    opacity: 0.9;
    filter: grayscale(0.65);
  }

  60% {
    filter: grayscale(0.8) brightness(1.3);
  }

  100% {
    transform: translate3d(var(--delete-ghost-x), var(--delete-ghost-y), 0) scaleX(1.01)
      scaleY(0.04);
    opacity: 0;
    filter: grayscale(1) brightness(1.5);
  }
}

/* The collapsed line flying into the delete target. */
.workbench__delete-line {
  position: fixed;
  top: var(--line-from);
  z-index: var(--z-ghost);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--glow-sweep-line);
  opacity: 0;
  animation: line-into-target calc(var(--motion-delete) * 0.22) linear
    calc(var(--motion-delete) / 3) both;
}

@keyframes line-into-target {
  0% {
    top: var(--line-from);
    opacity: 1;
  }

  90% {
    opacity: 1;
  }

  100% {
    top: var(--line-to);
    opacity: 0;
  }
}

/* A cancelled drag returns the card to its row; the fade keeps it from
   double-exposing over the real row it lands on. */
.workbench__return-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  animation: return-to-row var(--motion-slide) ease-out forwards;
  will-change: transform;
}

@keyframes return-to-row {
  from {
    transform: translate3d(var(--return-from-x), var(--return-from-y), 0);
    opacity: var(--dim-drag-ghost);
  }

  to {
    transform: translate3d(var(--return-to-x), var(--return-to-y), 0);
    opacity: 0;
  }
}

/* Reduced motion: transients appear and disappear, and the dimmed
   state applies statically. */
@media (prefers-reduced-motion: reduce) {
  .workbench__region--dimmed,
  .workbench__region--restoring,
  .workbench__drag-ghost,
  .workbench__ghost-card,
  .workbench__return-ghost {
    transition: none;
    animation: none;
  }

  .workbench__region--dimmed {
    filter: var(--lift-dim);
  }

  .workbench__boundary-tick {
    display: none;
  }

  .workbench__delete-ghost,
  .workbench__delete-line {
    display: none;
  }
}
</style>
