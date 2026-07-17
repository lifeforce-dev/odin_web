<script setup lang="ts">
import AppShell from '@/components/AppShell.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';
import ScreenNote from '@/components/ScreenNote.vue';
import { DEVICE_ONLY_NOTE, useDb } from '@/composables/useDb';

// Placeholder for the rest screen: holds the route contract the lift
// screen's START REST / FINISH navigates against - exerciseId plus the
// setIndex its arrival will auto-log - until 03-03 builds the timer
// and log control. Deliberately no reads here; the real screen adopts
// useScreenLoad.

const props = defineProps<{
  exerciseId: string;
  setIndex: number;
}>();

const db = useDb();
</script>

<template>
  <AppShell>
    <div class="rest">
      <ScreenHeader
        title="Rest"
        :back-to="{ name: 'workout-set', params: { exerciseId: props.exerciseId } }"
        eyebrow="Set"
        :eyebrow-value="setIndex"
      />
      <ScreenNote v-if="!db">{{ DEVICE_ONLY_NOTE }}</ScreenNote>
      <ScreenNote v-else>Rest screen // under construction</ScreenNote>
    </div>
  </AppShell>
</template>

<style scoped>
.rest {
  padding: var(--space-6) var(--space-4);
}
</style>
