<script setup lang="ts">
import LibraryElsewhereRow from '@/components/LibraryElsewhereRow.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import type { TransientCard } from '@/composables/useCardExitAnimation';

// The one face every workbench transient wears: the real row component
// for whichever kind the lifted workout is, so a ghost is exactly the
// row being moved. Content only - the wrapper that positions and
// animates a transient stays with its owner.

defineProps<{
  content: TransientCard;
}>();
</script>

<template>
  <LibraryElsewhereRow
    v-if="content.kind === 'elsewhere'"
    :name="content.name"
    :owner="content.owner"
  />
  <WorkoutCard
    v-else
    :name="content.name"
    :sets="content.sets"
    :rest-seconds="content.restSeconds"
    :variant="content.variant"
  />
</template>
