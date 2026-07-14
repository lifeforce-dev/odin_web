<script setup lang="ts">
import AppShell from '@/components/AppShell.vue';
import ScreenHeader from '@/components/ScreenHeader.vue';

// Route-stub screen (task 02-02): establishes /circuits/:id and proves
// the param plumbing on glass. The real one-screen workbench per
// design_reference/circuit-workbench.html (slots zone + workout pool)
// lands with tasks 02-04 and 02-05 on top of 02-03's domain layer.

defineProps<{
  id: string;
}>();
</script>

<template>
  <AppShell>
    <div class="workbench">
      <ScreenHeader
        title="Workbench"
        :eyebrow="`Circuit // ${id}`"
        back-label="Circuits"
        :back-to="{ name: 'circuits' }"
      />
      <p class="workbench__note">The slots + pool workbench lands with tasks 02-04 / 02-05.</p>
    </div>
  </AppShell>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  padding: var(--space-6) var(--space-4);
}

.workbench__note {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-body);
}
</style>
