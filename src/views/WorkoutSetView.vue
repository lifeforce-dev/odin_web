<script setup lang="ts">
import { onMounted, ref } from 'vue';

import AppShell from '@/components/AppShell.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import { getExerciseById } from '@/db/exercises';

// Placeholder for the lift (workout-set) screen: holds the route
// contract the start grid navigates against - an exerciseId param
// resolved against the pool - until the real three-zone screen
// replaces the body.

const props = defineProps<{
  exerciseId: string;
}>();

const db = useDb();
const exerciseName = ref<string | null>(null);

onMounted(async () => {
  if (!db) {
    return;
  }
  try {
    exerciseName.value = (await getExerciseById(db, props.exerciseId))?.name ?? null;
  } catch (error) {
    console.error('[odin] workout set load failed', error);
  }
});
</script>

<template>
  <AppShell>
    <div class="workout-set">
      <ScreenHeader :title="exerciseName ?? 'Workout Set'" :back-to="{ name: 'workout-start' }" />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote v-else>Lift screen // under construction</ScreenNote>
    </div>
  </AppShell>
</template>

<style scoped>
.workout-set {
  padding: var(--space-6) var(--space-4);
}
</style>
