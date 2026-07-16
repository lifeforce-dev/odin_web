<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import CircuitCard from '@/components/CircuitCard.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import TotalTime from '@/components/TotalTime.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import type { WorkoutStart } from '@/domain/workout';
import { getWorkoutStart } from '@/domain/workout';

// The workout start page: the up-next circuit's name as the screen
// title (the circuit is auto-selected, so the title IS the header) and
// the exercise-select grid. Progress on the tiles is session-scoped
// and derived on every load; the docked total-time readout runs off
// the in-flight session's persisted start.

const router = useRouter();
const db = useDb();

const start = ref<WorkoutStart | null>(null);
const hasLoaded = ref(false);
const loadFailed = ref(false);

async function refresh(): Promise<void> {
  if (!db) {
    return;
  }
  try {
    start.value = await getWorkoutStart(db);
    hasLoaded.value = true;
    loadFailed.value = false;
  } catch (error) {
    // A failed read must fail on the glass, not only in the log.
    console.error('[odin] workout start load failed', error);
    loadFailed.value = true;
  }
}

onMounted(() => {
  void refresh();
});

function openExercise(exerciseId: string): void {
  void router.push({ name: 'workout-set', params: { exerciseId } });
}
</script>

<template>
  <AppShell>
    <div class="workout-start">
      <ScreenHeader :title="start?.circuit.name ?? 'Workout'" :back-to="{ name: 'home' }" />
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
