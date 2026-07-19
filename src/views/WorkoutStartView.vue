<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import CircuitCard from '@/components/CircuitCard.vue';
import NavUpRow from '@/components/NavUpRow.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TotalTime from '@/components/TotalTime.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { useScreenLoad } from '@/composables/useScreenLoad';
import type { WorkoutStart } from '@/domain/workout';
import { getWorkoutStart, reconcileWorkoutCompletion } from '@/domain/workout';

// The workout start page: the up-next circuit's name as the screen
// title (the circuit is auto-selected, so the title IS the header) and
// the exercise-select grid. Progress on the tiles is session-scoped
// and derived on every load; the docked total-time readout runs off
// the in-flight session's persisted start. Arrival is also the
// completion reconcile point: an in-flight session whose remaining
// sets hit zero through workbench edits has no FINISH affordance left
// anywhere, so the grid acknowledges the facts - ends it and routes to
// home (a congrats splash later) - instead of rendering
// an all-done grid that strands the session in flight.

const router = useRouter();
const db = useDb();

const start = ref<WorkoutStart | null>(null);

const { hasLoaded, loadFailed, refresh } = useScreenLoad('workout start', async () => {
  if (!db) {
    return;
  }
  // This write rides the mount load OFF any serialized chain (the
  // screen has none): a back-tap racing a still-open transaction
  // (startRest's commit) rejects this BEGIN and lands on Retry - an
  // accepted, self-healing failure mode, arriveAtRest's precedent.
  const completed = await reconcileWorkoutCompletion(db);
  if (completed) {
    // Awaited so hasLoaded stays false until the navigation lands;
    // otherwise the nothing-to-start note flashes over a
    // just-completed workout while home's lazy chunk loads.
    await router.replace({ name: 'home' });
    return;
  }
  start.value = await getWorkoutStart(db);
});

function openExercise(exerciseId: string): void {
  void router.push({ name: 'workout-set', params: { exerciseId } });
}
</script>

<template>
  <AppShell>
    <div class="workout-start">
      <ScreenHeader :title="start?.circuit.name ?? 'Workout'" />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote v-else-if="loadFailed" action="Retry" @action="() => void refresh()">
        Couldn't load the workout
      </ScreenNote>
      <template v-else>
        <div v-if="start" class="workout-start__grid">
          <CircuitCard
            v-for="tile in start.exercises"
            :key="tile.exerciseId"
            :name="tile.name"
            :sets="tile.sets"
            :logged-sets="tile.loggedSets"
            :progress="tile.progress"
            @select="openExercise(tile.exerciseId)"
          />
        </div>
        <ScreenNote v-if="hasLoaded && !start">
          Nothing to start // add workouts to a circuit
        </ScreenNote>
      </template>
    </div>
    <template #action>
      <NavUpRow />
      <div class="workout-start__footer">
        <TotalTime :started-at="start?.session?.startedAt ?? null" />
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.workout-start {
  padding: var(--space-6) var(--space-4) 0;
}

/* Moves together with the gallery's .board-card-grid, which renders
   the tiles at this shipped shape on the component board. */
.workout-start__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  margin-top: var(--space-6);
}

.workout-start__footer {
  padding: 0 var(--space-4);
}
</style>
