<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import MenuButton from '@/components/MenuButton.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';
import type { CircuitRow } from '@/db/schema';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  listActiveCircuits,
} from '@/domain/builder';

// The rotation list, minimally real (task 02-04): actual circuits from
// the domain so the workbench opens real persisted data on device. The
// full circuits screen per design_reference/circuits.html (circuit-row
// components, rotation reorder, + ADD CIRCUIT) is later epic-02 work;
// until the pool zone (02-05) provides the add path, dev builds get a
// seed row so the workbench's drag/editor pass is exercisable at all.

const router = useRouter();
const db = useDb();

const circuits = ref<CircuitRow[]>([]);
const hasLoaded = ref(false);
const loadFailed = ref(false);

// The canonical ref's demo circuit (circuit-workbench.html seeds), so the
// on-device pass sees the same rows as the design reference.
const DEMO_CIRCUIT_NAME = 'Legs';
const DEMO_WORKOUTS = [
  { name: 'Lat Pulldown', prescription: { sets: 4, restSeconds: 90 } },
  { name: 'Cable Row', prescription: { sets: 3, restSeconds: 60 } },
  { name: 'Cable Face Pull', prescription: { sets: 3, restSeconds: 45 } },
];

async function refresh(): Promise<void> {
  if (!db) {
    return;
  }
  try {
    circuits.value = await listActiveCircuits(db, 'workout');
    hasLoaded.value = true;
    loadFailed.value = false;
  } catch (error) {
    // A failed read must fail on the glass, not only in logcat.
    console.error('[odin] circuits load failed', error);
    loadFailed.value = true;
  }
}

onMounted(() => {
  void refresh();
});

// Dev-only and only while the rotation is empty: seeding twice would
// create a duplicate circuit whose adds then fail on the exclusivity
// constraint. Emptied the demo circuit mid-testing? Clear app data.
const showSeedRow = computed(
  () => import.meta.env.DEV && db !== null && hasLoaded.value && circuits.value.length === 0,
);

async function seedDemoCircuit(): Promise<void> {
  if (!db) {
    return;
  }
  try {
    const circuit = await createCircuit(db, { kind: 'workout', name: DEMO_CIRCUIT_NAME });
    for (const workout of DEMO_WORKOUTS) {
      const exercise = await findOrCreateExercise(db, 'workout', workout.name);
      await addExerciseToCircuit(db, circuit.id, exercise.id, workout.prescription);
    }
  } catch (error) {
    console.error('[odin] demo seed failed', error);
  }
  await refresh();
}

function openWorkbench(id: string): void {
  void router.push({ name: 'circuit-workbench', params: { id } });
}
</script>

<template>
  <AppShell>
    <div class="circuits">
      <ScreenHeader title="Circuits" eyebrow="Rotation // Order" :back-to="{ name: 'home' }" />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote v-else-if="loadFailed" action="Retry" @action="() => void refresh()">
        Couldn't load the rotation
      </ScreenNote>
      <template v-else>
        <div class="circuits__list">
          <MenuButton
            v-for="circuit in circuits"
            :key="circuit.id"
            @click="openWorkbench(circuit.id)"
          >
            {{ circuit.name }}
          </MenuButton>
          <MenuButton v-if="showSeedRow" @click="() => void seedDemoCircuit()">
            Seed demo circuit (dev)
          </MenuButton>
        </div>
        <ScreenNote v-if="hasLoaded && circuits.length === 0 && !showSeedRow">
          No circuits yet
        </ScreenNote>
      </template>
    </div>
  </AppShell>
</template>

<style scoped>
.circuits {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--space-6) var(--space-4);
}

.circuits__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
