<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { hasSystemBack } from '@/native';
import { goUp } from '@/router/up';

// The quiet vermilion-ghost up affordance: self-wired from route meta
// so every screen drops it in with zero per-view policy. Android never
// renders it - the system back drives the same structural map through
// goUp.

const props = defineProps<{
  label?: string;
}>();

const route = useRoute();
const router = useRouter();

const label = computed(() => props.label ?? route.meta.upLabel);

// Renders only where there is no system back AND a destination exists:
// either the label prop overrides (the gallery board's exercised case)
// or the route meta carries both a label and an upTo to resolve.
const visible = computed(
  () =>
    !hasSystemBack &&
    (props.label !== undefined || (Boolean(route.meta.upLabel) && route.meta.upTo !== undefined)),
);

function handlePress(): void {
  goUp(router);
}
</script>

<template>
  <button v-if="visible" type="button" class="nav-up-row" @click="handlePress">
    &#8592; {{ label }}
  </button>
</template>

<style scoped>
/* Accent-ghost recipe family with TrashSnackbar's undo button (mono
   label type, accent ink, transparent, tap-min) - these move together;
   extract at a third copy. The weight split is deliberate: 700 here
   because the full-width row reads heavier than the compact undo chip
   at equal weight. */
.nav-up-row {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: var(--tap-min);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  cursor: pointer;
  background: none;
  border: none;
}

.nav-up-row:active {
  background: var(--accent-soft);
}
</style>
