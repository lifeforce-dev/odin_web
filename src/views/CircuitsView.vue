<script setup lang="ts">
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import MenuButton from '@/components/MenuButton.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';

// Route-stub screen (task 02-02): establishes /circuits and the back
// stack. The real rotation list per design_reference/circuits.html
// (circuit-row components, reorder, + ADD CIRCUIT) lands with tasks
// 02-03..02-05; until the domain layer exists there are no circuits to
// list, so one placeholder row keeps the workbench route walkable.

const router = useRouter();

function openWorkbench(): void {
  void router.push({ name: 'circuit-workbench', params: { id: 'placeholder' } });
}
</script>

<template>
  <AppShell>
    <div class="circuits">
      <ScreenHeader title="Circuits" eyebrow="Rotation // Order" :back-to="{ name: 'home' }" />
      <MenuButton @click="openWorkbench">Placeholder Circuit</MenuButton>
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
</style>
