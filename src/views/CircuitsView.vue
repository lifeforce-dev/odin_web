<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import CircuitRow from '@/components/CircuitRow.vue';
import ConfirmStrip from '@/components/ConfirmStrip.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import { measureRowMidpoints } from '@/composables/measure-midpoints';
import { badgeNumber } from '@/composables/badge-number';
import { settlePointer } from '@/composables/settle-pointer';
import { useCircuitManager } from '@/composables/useCircuitManager';
import { useCoalescedWrite } from '@/composables/useCoalescedWrite';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useOverflow } from '@/composables/useOverflow';
import { useQueueDrag } from '@/composables/useQueueDrag';
import { orderAfterDrop } from '@/composables/useWorkbenchDrag';
import type { RotationQueueRow } from '@/domain/workout';

// The circuits screen: the live rotation queue, the active-session
// controls (swap / abandon), and circuit authoring (+ ADD CIRCUIT,
// delete; rename lives on the workbench's title pencil). Reads and
// mutations ride useCircuitManager; this screen stays render + emit,
// the same split the workbench uses.

const router = useRouter();
const db = useDb();
const manager = useCircuitManager(db);
const { status, queue, active } = manager;

onMounted(() => {
  void manager.reload();
});

// One open strip at a time (a row's delete confirm, a row's swap
// confirm, or the active box's abandon confirm) - a sentinel id covers
// the box, which has no circuit id of its own to key on.
const ACTIVE_BOX_STRIP_ID = '__active-box__';
const openStripId = ref<string | null>(null);
const swapMode = ref(false);
const addNotice = ref<string | null>(null);

const activeCircuitName = computed(() => {
  const state = active.value;
  if (!state) {
    return '';
  }
  return queue.value.find((row) => row.id === state.circuitId)?.name ?? '';
});

// ACTIVE wins outright; otherwise the first startable (non-empty) row
// wears NEXT - the same startable-front rule the domain's rotation
// uses. An empty circuit never wears a tag either way.
const tagByCircuitId = computed<Map<string, 'next' | 'active'>>(() => {
  const map = new Map<string, 'next' | 'active'>();
  const state = active.value;
  if (state) {
    map.set(state.circuitId, 'active');
  } else {
    const next = queue.value.find((row) => row.workoutCount > 0);
    if (next) {
      map.set(next.id, 'next');
    }
  }
  return map;
});

// The active box can vanish out from under swap mode (the session ends
// behind the screen's back - abandon elsewhere, an orphan cleanup, the
// circuit deleted). Closing the strip alongside is load-bearing: a swap pick
// strip open on row X shares openStripId with row X's delete strip, so
// leaving it set would morph one into the other the instant swapMode
// drops.
watch(active, (value) => {
  if (value === null) {
    swapMode.value = false;
    openStripId.value = null;
  }
});

function isDimmed(row: RotationQueueRow): boolean {
  if (!swapMode.value) {
    return false;
  }
  return row.id === active.value?.circuitId || row.workoutCount === 0;
}

function openWorkbench(id: string): void {
  void router.push({ name: 'circuit-workbench', params: { id } });
}

// In swap mode a tap picks the row (dimmed - ineligible - rows never
// reach here: they carry pointer-events: none); otherwise it navigates.
function onRowOpen(circuitId: string): void {
  if (swapMode.value) {
    openStripId.value = circuitId;
    return;
  }
  openWorkbench(circuitId);
}

function toggleDeleteStrip(circuitId: string): void {
  if (swapMode.value) {
    return;
  }
  openStripId.value = openStripId.value === circuitId ? null : circuitId;
}

async function confirmDelete(circuitId: string): Promise<void> {
  openStripId.value = null;
  await manager.remove(circuitId);
}

function enterSwapMode(): void {
  swapMode.value = true;
  openStripId.value = null;
}

function cancelSwap(): void {
  swapMode.value = false;
  openStripId.value = null;
}

function openAbandonStrip(): void {
  openStripId.value = ACTIVE_BOX_STRIP_ID;
}

async function confirmAbandon(): Promise<void> {
  const sessionId = active.value?.sessionId;
  if (!sessionId) {
    openStripId.value = null;
    return;
  }
  await manager.abandon(sessionId);
  openStripId.value = null;
}

// The strip and swap mode close only once the write settles: a false
// (stale target) just repaints truth, same as a success.
async function confirmSwap(circuitId: string): Promise<void> {
  const sessionId = active.value?.sessionId;
  if (!sessionId) {
    openStripId.value = null;
    swapMode.value = false;
    return;
  }
  await manager.swap(sessionId, circuitId);
  openStripId.value = null;
  swapMode.value = false;
}

// A re-tap while the create is in flight JOINS the pending write
// instead of creating a second circuit: re-taps ride the in-flight write
// rather than each starting a new one.
const { run: handleAddCircuit } = useCoalescedWrite('add circuit', async () => {
  addNotice.value = null;
  const id = await manager.createAndOpen();
  if (id === null) {
    addNotice.value = "Couldn't create // try again";
    return null;
  }
  await router.push({ name: 'circuit-workbench', params: { id } });
  return id;
});

// --- Queue drag ---------------------------------------------------------

const queueZoneEl = ref<HTMLElement | null>(null);
const queueContentEl = ref<HTMLElement | null>(null);
const queueScrolls = useOverflow(queueZoneEl, queueContentEl);

function measureQueueMidpoints(draggedId: string): number[] {
  const zone = queueZoneEl.value;
  return zone ? measureRowMidpoints(zone, 'queueId', draggedId) : [];
}

const drag = useQueueDrag({
  measureMidpoints: measureQueueMidpoints,
  onDrop: (draggedId, insertAt) => {
    const orderedIds = queue.value.map((row) => row.id);
    void manager.reorder(orderAfterDrop(orderedIds, draggedId, insertAt));
  },
});

async function startRowDrag(circuitId: string, event: PointerEvent): Promise<void> {
  // Lifting closes any open strip: one live interaction at a time, and
  // the measurements need closed-strip geometry (an open strip inflates
  // its wrapper's rect and skews every midpoint below it).
  openStripId.value = null;
  const liveEvent = await settlePointer(event);
  const wrapper = queueZoneEl.value?.querySelector<HTMLElement>(`[data-queue-id="${circuitId}"]`);
  if (!liveEvent || !wrapper) {
    return;
  }
  drag.begin(circuitId, liveEvent, wrapper.getBoundingClientRect());
}

// gapIndex counts non-dragged rows only, matching measureQueueMidpoints;
// queuePosition is the row's committed (or previewed) 1-based badge, so
// mid-drag a number can duplicate a neighbor's - same rule as the
// workbench slot numbers.
type QueueListRow =
  | { kind: 'row'; row: RotationQueueRow; queuePosition: number }
  | { kind: 'gap'; queuePosition: number };

const displayRows = computed<QueueListRow[]>(() => {
  const draggedId = drag.state.draggingId;
  const gapAt = drag.state.gapIndex;
  const reordering = draggedId !== null && gapAt !== null;
  const rows: QueueListRow[] = queue.value
    .map((row, index) => ({ kind: 'row' as const, row, queuePosition: index + 1 }))
    .filter((entry) => !(reordering && entry.row.id === draggedId));
  if (reordering) {
    rows.splice(Math.min(gapAt, rows.length), 0, { kind: 'gap', queuePosition: gapAt + 1 });
  }
  return rows;
});

function gapBadge(n: number): string {
  return badgeNumber(n);
}

const draggedQueueRow = computed(() => {
  const id = drag.state.draggingId;
  if (id === null) {
    return null;
  }
  return queue.value.find((row) => row.id === id) ?? null;
});

const draggedQueueOrder = computed(() => {
  const row = draggedQueueRow.value;
  if (!row) {
    return 0;
  }
  return queue.value.findIndex((entry) => entry.id === row.id) + 1;
});

// Only affirm emptiness once the load has settled, never during it: a
// hint shown over a still-loading queue would flash then vanish.
const showEmptyHint = computed(() => status.value === 'ready' && queue.value.length === 0);
</script>

<template>
  <AppShell>
    <div class="circuits" :class="{ 'circuits--lifted': drag.state.draggingId !== null }">
      <ScreenHeader title="Circuits" eyebrow="Rotation // Order" />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote
        v-else-if="status === 'error'"
        action="Retry"
        @action="() => void manager.reload()"
      >
        Couldn't load the rotation
      </ScreenNote>
      <template v-else>
        <div v-if="active !== null" class="circuits__active">
          <p class="circuits__active-eyebrow">Active session</p>
          <h2 class="circuits__active-name">{{ activeCircuitName }}</h2>
          <template v-if="!swapMode">
            <div class="circuits__active-actions">
              <button
                type="button"
                class="circuits__ghost-btn red-ghost-btn"
                @click="enterSwapMode"
              >
                Swap
              </button>
              <button
                type="button"
                class="circuits__ghost-btn red-ghost-btn"
                @click="openAbandonStrip"
              >
                Abandon
              </button>
            </div>
            <ConfirmStrip
              v-if="openStripId === ACTIVE_BOX_STRIP_ID"
              message="End this workout?"
              detail="Your logged sets are kept"
              confirm-label="Abandon session"
              @confirm="() => void confirmAbandon()"
              @cancel="openStripId = null"
            />
          </template>
          <template v-else>
            <p class="circuits__active-hint">Pick a circuit below</p>
            <div class="circuits__active-actions">
              <button type="button" class="circuits__ghost-btn red-ghost-btn" @click="cancelSwap">
                Cancel
              </button>
            </div>
          </template>
        </div>

        <div ref="queueZoneEl" class="circuits__queue scrolly">
          <!-- Exists to be measured: a scroll container's own box never
               resizes when content changes (see useOverflow). -->
          <div ref="queueContentEl">
            <p v-if="showEmptyHint" class="circuits__empty-hint">
              No circuits yet // add one below
            </p>
            <TransitionGroup
              tag="div"
              :name="drag.state.draggingId ? 'queue-shift' : 'queue-settle'"
              class="circuits__queue-list"
            >
              <template
                v-for="entry in displayRows"
                :key="entry.kind === 'row' ? entry.row.id : 'landing-gap'"
              >
                <div
                  v-if="entry.kind === 'gap'"
                  class="circuits__gap"
                  :style="{ height: `${drag.state.ghostHeight}px` }"
                >
                  <span class="circuits__gap-index">{{ gapBadge(entry.queuePosition) }}</span>
                  <div class="circuits__gap-vacant"></div>
                </div>
                <div v-else class="circuits__row-wrap" :data-queue-id="entry.row.id">
                  <CircuitRow
                    :name="entry.row.name"
                    :order="entry.queuePosition"
                    :workout-count="entry.row.workoutCount"
                    :tag="tagByCircuitId.get(entry.row.id) ?? null"
                    :dimmed="isDimmed(entry.row)"
                    :drag-anywhere="!queueScrolls"
                    @open="onRowOpen(entry.row.id)"
                    @delete="toggleDeleteStrip(entry.row.id)"
                    @drag-start="(event) => void startRowDrag(entry.row.id, event)"
                  />
                  <ConfirmStrip
                    v-if="!swapMode && openStripId === entry.row.id"
                    message="Delete this circuit?"
                    detail="Its workouts and their history are kept"
                    confirm-label="Delete circuit"
                    @confirm="() => void confirmDelete(entry.row.id)"
                    @cancel="openStripId = null"
                  />
                  <ConfirmStrip
                    v-if="swapMode && openStripId === entry.row.id"
                    message="Your logged sets are recorded"
                    detail="Start Workout will start"
                    :detail-value="entry.row.name"
                    confirm-label="Swap to front"
                    @confirm="() => void confirmSwap(entry.row.id)"
                    @cancel="openStripId = null"
                  />
                </div>
              </template>
            </TransitionGroup>
          </div>
        </div>

        <div class="circuits__footer">
          <p v-if="addNotice" class="circuits__add-notice">{{ addNotice }}</p>
          <button
            type="button"
            class="circuits__add-btn red-ghost-btn"
            @click="() => void handleAddCircuit()"
          >
            + Add Circuit
          </button>
        </div>
      </template>
    </div>

    <!-- Positioned by transform, never left/top: the ghost follows every
         pointermove without re-running layout per move. -->
    <div
      v-if="draggedQueueRow"
      class="circuits__drag-ghost"
      :style="{
        transform: `translate3d(${drag.state.ghostX}px, ${drag.state.ghostY}px, 0)`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <CircuitRow
        :name="draggedQueueRow.name"
        :order="draggedQueueOrder"
        :workout-count="draggedQueueRow.workoutCount"
        :tag="tagByCircuitId.get(draggedQueueRow.id) ?? null"
      />
    </div>

    <template #action>
      <!-- The slot content sits outside .circuits--lifted's descendant
           selectors, so the mid-drag inert rule reaches it only through
           this class (the workbench's exact pattern). -->
      <NavUpRow :class="{ 'circuits__up--inert': drag.state.draggingId !== null }" />
    </template>
  </AppShell>
</template>

<style scoped>
.circuits {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-6) var(--space-4) var(--space-3);

  /* The page never scrolls; the queue scrolls inside itself. */
  overflow: hidden;
}

.circuits__active {
  flex: none;
  padding: var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--surface-alarm);
  border: var(--rule) solid var(--accent);
}

.circuits__active-eyebrow {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-3);
  text-transform: uppercase;
}

/* --leading-display-title also binds ScreenHeader's title and
   InlineNameEntry's display size. */
.circuits__active-name {
  margin: var(--space-1) 0 var(--space-3);
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: var(--leading-display-title);
  letter-spacing: var(--tracking-2);
}

.circuits__active-hint {
  margin: 0 0 var(--space-3);
  color: var(--text-soft);
  font-size: var(--type-body);
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.circuits__active-actions {
  display: flex;
  gap: var(--space-2);
}

.circuits__ghost-btn {
  flex: 1;
}

.circuits__queue {
  /* Relative so the row wrappers offset against this zone - the drag's
     midpoint measurement depends on it (see measureRowMidpoints). */
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  padding: var(--space-1);
  overflow-y: auto;
}

/* Same dashed empty-state recipe as .workbench__empty-hint - these move
   together (an empty zone reads the same on both authoring screens). */
.circuits__empty-hint {
  margin: 0;
  padding: var(--space-6) var(--space-4);
  color: var(--text-dim);
  font-size: var(--type-label);
  letter-spacing: var(--tracking-1);
  text-align: center;
  text-transform: uppercase;
  border: var(--hairline) dashed var(--border-strong);
}

.circuits__queue-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.circuits__row-wrap {
  display: flex;
  flex-direction: column;
}

/* The landing gap: an open socket wearing the index it previews, sized
   to the lifted row. Neutral on purpose - the lifted row alone carries
   the accent. */
.circuits__gap {
  display: flex;
  align-items: stretch;
}

/* Badge-cell recipe (shared with .workbench__slot-number and
   .circuit-row__order): shares the gap's dashed empty-state styling
   instead of either badge's solid dress. */
.circuits__gap-index {
  display: flex;
  flex: 0 0 var(--badge-cell-width);
  align-items: center;
  justify-content: center;
  color: var(--text-dim);
  font-family: var(--font-display);
  font-size: var(--type-display-badge);
  letter-spacing: var(--tracking-1);
  border: var(--hairline) dashed var(--border-strong);
  border-right: none;
}

.circuits__gap-vacant {
  flex: 1 1 auto;
  border: var(--hairline) dashed var(--border-strong);
  border-left: none;
}

/* Rows slide to make room while one is lifted; the leave-active
   absolute trick keeps the removed row from inflating the list for the
   couple of frames TransitionGroup keeps it mounted with no leave
   animation declared. */
.queue-shift-move {
  transition: transform var(--motion-slide) ease;
}

.queue-shift-leave-active,
.queue-settle-leave-active {
  position: absolute;
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .queue-shift-move {
    transition: none;
  }
}

.circuits__footer {
  flex: none;
  margin-top: auto;
  padding-top: var(--space-4);
}

.circuits__add-notice {
  margin: 0 0 var(--space-2);
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.circuits__add-btn {
  width: 100%;
  padding: var(--space-4);
  font-size: var(--type-body);
  border-width: var(--rule);
}

/* --dim-drag-ghost also binds the workbench's drag ghost. */
.circuits__drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: var(--z-ghost);
  pointer-events: none;
  opacity: var(--dim-drag-ghost);
  will-change: transform;
  box-shadow: var(--glow-drag-ghost);
}

/* While a row is lifted the rest of the screen goes inert: a second
   finger elsewhere must not fire a tap mid-gesture. Unlike the
   workbench's mid-drag rule (which enumerates each tap surface), this
   screen blankets its whole root - two scoping strategies, kept
   deliberately unmerged for now. */
.circuits--lifted {
  pointer-events: none;
}

.circuits__up--inert {
  pointer-events: none;
}
</style>
