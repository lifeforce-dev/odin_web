<script setup lang="ts">
import AppShell from '@/components/AppShell.vue';
import NavUpRow from '@/components/NavUpRow.vue';
</script>

<template>
  <AppShell>
    <div>
      <h1>Not found</h1>
    </div>
    <template #action>
      <NavUpRow />
    </template>
  </AppShell>
</template>
