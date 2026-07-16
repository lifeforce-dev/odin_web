<script setup lang="ts">
import PoolElsewhereRow from '@/components/PoolElsewhereRow.vue';
import WorkoutCard from '@/components/WorkoutCard.vue';
import type { TransientCard } from '@/composables/useForgeChoreography';

// The one face every workbench transient wears: the REAL row component
// for whichever kind the lifted workout is, so a ghost is exactly the
// row being moved (drag ghost, consume tv-off, and put-back fly used to
// hand-copy this branch four times). Content only - the wrapper that
// positions and animates a transient stays with its owner.

defineProps<{
  content: TransientCard;
}>();
</script>

<template>
  <PoolElsewhereRow
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
