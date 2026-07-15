<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import AppShell from '@/components/AppShell.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import WorkbenchSlot from '@/components/WorkbenchSlot.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { orderAfterDrop, useSlotDrag } from '@/composables/useSlotDrag';
import { useWorkbench } from '@/composables/useWorkbench';
import type { PrescriptionField } from '@/composables/useWorkbench';
import type { CircuitSlot } from '@/domain/builder';

// The circuit workbench (design_reference/circuit-workbench.html), upper
// half (task 02-04): the circuit's slots with the inline prescription
// editor, drag reorder, and drag-onto-the-pool removal. The pool zone
// below is rendered as the layout anchor and drop-to-remove target only;
// its groups, add, steal, and inline create land with task 02-05.

const props = defineProps<{
  id: string;
}>();

const db = useDb();
const workbench = useWorkbench(db, () => props.id);
const { status, circuitName, slots } = workbench;

const openSlotId = ref<string | null>(null);
const flashSlotId = ref<string | null>(null);

const circuitZoneEl = ref<HTMLElement | null>(null);
const poolEl = ref<HTMLElement | null>(null);

const drag = useSlotDrag({
  measureSlotMidpoints,
  measurePoolTop: () => poolEl.value?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  onReorder: applyReorder,
  onRemove: (slotId) => {
    void workbench.removeSlot(slotId);
  },
});

onMounted(() => {
  void workbench.load();
});
watch(
  () => props.id,
  () => {
    // A different circuit is a fresh screen: per-circuit UI state must
    // not leak across (an open editor or running flash keyed to the old
    // circuit's slot ids).
    openSlotId.value = null;
    flashSlotId.value = null;
    void workbench.load();
  },
);

const eyebrowText = computed(() => {
  if (status.value !== 'ready') {
    return 'Circuit';
  }
  if (slots.value.length === 0) {
    return 'Empty // add a workout below';
  }
  return slots.value.length === 1 ? '1 Workout' : `${slots.value.length} Workouts`;
});

// Standard reorder model: while the lifted card is over the circuit it
// LEAVES the list (it never appears twice) and a landing gap opens at the
// insertion point - rows slide to make room, and the gap is the drop
// preview. Over the pool the gap closes and the origin row returns,
// dimmed; the remove flag owns the message there. The gap index counts
// non-dragged rows only, matching what measureSlotMidpoints reports.
type SlotListRow = { kind: 'slot'; slot: CircuitSlot } | { kind: 'gap' };

const displayRows = computed<SlotListRow[]>(() => {
  const draggedId = drag.state.draggingId;
  const gapAt = drag.state.gapIndex;
  const reordering = draggedId !== null && gapAt !== null;
  const rows: SlotListRow[] = slots.value
    .filter((slot) => !(reordering && slot.id === draggedId))
    .map((slot) => ({ kind: 'slot', slot }));
  if (reordering) {
    rows.splice(Math.min(gapAt, rows.length), 0, { kind: 'gap' });
  }
  return rows;
});

function measureSlotMidpoints(draggedId: string): number[] {
  const zone = circuitZoneEl.value;
  if (!zone) {
    return [];
  }
  return [...zone.querySelectorAll<HTMLElement>('[data-slot-id]')]
    .filter((element) => element.dataset.slotId !== draggedId)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
}

// The gap-to-permutation math is orderAfterDrop (pure, pinned in Node);
// same-order drops write nothing (the composable's guard).
function applyReorder(draggedId: string, insertAt: number): void {
  const orderedIds = slots.value.map((slot) => slot.id);
  void workbench.reorderSlots(orderAfterDrop(orderedIds, draggedId, insertAt));
}

function toggleEditor(slotId: string): void {
  openSlotId.value = openSlotId.value === slotId ? null : slotId;
}

function adjust(slotId: string, field: PrescriptionField, delta: number): void {
  void workbench.adjustPrescription(slotId, field, delta);
}

function removeSlot(slotId: string): void {
  openSlotId.value = null;
  void workbench.removeSlot(slotId);
}

async function startDrag(slot: CircuitSlot, event: PointerEvent): Promise<void> {
  // Close any open editor FIRST and measure only after the re-render:
  // every drag measurement (gap height, ghost size, the frozen pool
  // boundary) must describe closed-card geometry, or the drag states
  // disagree about heights and the zone seam turns into an oscillation
  // band. A pointerup during that one tick means the flick ended before
  // the drag could begin - without the guard the ghost would stick. The
  // guard listens on document, so it must ignore other fingers lifting.
  openSlotId.value = null;
  let released = false;
  const onEarlyRelease = (releaseEvent: PointerEvent): void => {
    if (releaseEvent.pointerId === event.pointerId) {
      released = true;
    }
  };
  document.addEventListener('pointerup', onEarlyRelease);
  document.addEventListener('pointercancel', onEarlyRelease);
  await nextTick();
  document.removeEventListener('pointerup', onEarlyRelease);
  document.removeEventListener('pointercancel', onEarlyRelease);
  const card = circuitZoneEl.value?.querySelector<HTMLElement>(`[data-slot-id="${slot.id}"]`);
  if (released || !card) {
    return;
  }
  drag.begin(slot.id, event, card.getBoundingClientRect());
}

// The lifted card: the REAL slot component rendered full-size under the
// thumb (grab-point anchored), so the ghost is exactly the row being
// moved. The ref's small label-chip ghost was rejected as unintuitive.
const draggedSlot = computed(
  () => slots.value.find((slot) => slot.id === drag.state.draggingId) ?? null,
);
</script>

<template>
  <AppShell>
    <div class="workbench">
      <ScreenHeader
        :title="circuitName || 'Workbench'"
        back-label="Circuits"
        :back-to="{ name: 'circuits' }"
      >
        <template #eyebrow>{{ eyebrowText }}</template>
      </ScreenHeader>

      <template v-if="status === 'ready'">
        <div
          ref="circuitZoneEl"
          class="workbench__circuit-zone scrolly"
          :class="{ 'workbench__circuit-zone--armed': drag.state.circuitArmed }"
        >
          <p v-if="slots.length === 0" class="workbench__empty-hint">
            Tap a workout below to add it // drag to place
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
              :key="row.kind === 'slot' ? row.slot.id : 'landing-gap'"
            >
              <div
                v-if="row.kind === 'gap'"
                class="workbench__slot-gap"
                :style="{ height: `${drag.state.ghostHeight}px` }"
              ></div>
              <WorkbenchSlot
                v-else
                :data-slot-id="row.slot.id"
                :name="row.slot.exerciseName"
                :sets="row.slot.sets"
                :rest-seconds="row.slot.restSeconds"
                :open="openSlotId === row.slot.id"
                :dragging="drag.state.draggingId === row.slot.id"
                :flash="flashSlotId === row.slot.id"
                @toggle="toggleEditor(row.slot.id)"
                @adjust="(field, delta) => adjust(row.slot.id, field, delta)"
                @remove="removeSlot(row.slot.id)"
                @drag-start="(event) => void startDrag(row.slot, event)"
                @flash-end="flashSlotId = null"
              />
            </template>
          </TransitionGroup>
        </div>

        <div
          ref="poolEl"
          class="workbench__pool"
          :class="{ 'workbench__pool--armed': drag.state.poolArmed }"
        >
          <p class="workbench__pool-label">Workouts</p>
          <!-- AVAILABLE / IN OTHER CIRCUITS groups, add, steal, and inline
               create land with task 02-05. -->
          <div class="workbench__pool-list scrolly"></div>
          <p
            class="workbench__remove-flag"
            :class="{ 'workbench__remove-flag--armed': drag.state.poolArmed }"
          >
            Release to remove
          </p>
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

    <div
      v-if="draggedSlot"
      class="workbench__drag-ghost"
      :style="{
        left: `${drag.state.ghostX}px`,
        top: `${drag.state.ghostY}px`,
        width: `${drag.state.ghostWidth}px`,
      }"
    >
      <WorkbenchSlot
        :name="draggedSlot.exerciseName"
        :sets="draggedSlot.sets"
        :rest-seconds="draggedSlot.restSeconds"
      />
    </div>
  </AppShell>
</template>

<style scoped>
.workbench {
  /* Designer knobs (screen-level layout, STYLEGUIDE section 10): how far
     the circuit zone may grow before it scrolls internally, and the floor
     it never shrinks under. */
  --zone-circuit-max: 42%;
  --zone-circuit-min: 92px;

  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--space-6) var(--space-4) 0;

  /* The page never scrolls; each zone scrolls inside itself. */
  overflow: hidden;
}

.workbench__circuit-zone {
  position: relative;
  flex: 0 1 auto;
  min-height: var(--zone-circuit-min);
  max-height: var(--zone-circuit-max);

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

@media (prefers-reduced-motion: reduce) {
  .slot-shift-move {
    transition: none;
  }
}

.workbench__pool {
  position: relative;
  display: flex;
  flex: 1 1 auto;
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

.workbench__pool-list {
  flex: 1;
  overflow-y: auto;
}

/* Removal is a centered floating flag, never layout-shifting text
   (STYLEGUIDE drop-zone rule). Transform centers it; only opacity
   animates. */
.workbench__remove-flag {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: var(--z-float);
  margin: 0;
  padding: var(--space-2) var(--space-4);
  color: var(--accent);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  white-space: nowrap;
  pointer-events: none;
  background: var(--surface-alarm);
  border: var(--hairline) solid var(--accent);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition: opacity var(--motion-press);
}

.workbench__remove-flag--armed {
  opacity: 1;
}

/* The in-flight card: content is the real WorkbenchSlot (its own chrome),
   this wrapper only positions it and adds the lifted glow. */
.workbench__drag-ghost {
  position: fixed;
  z-index: var(--z-ghost);
  pointer-events: none;
  box-shadow: var(--glow-drag-ghost);
  opacity: 0.94;
}
</style>
