<script setup lang="ts">
import { formatRemaining } from '@/domain/rest-timer';

// The rest screen's hero countdown: solid crisp amber fill, one glow
// layer only, M:SS derived straight from the remaining seconds. At
// 0:00 the digits calm to --text-soft with no glow so only the docked
// action (which fills solid at the same moment) still emits.

const props = defineProps<{
  remaining: number;
}>();
</script>

<template>
  <p class="rest-digits" :class="{ 'rest-digits--timeup': props.remaining === 0 }">
    {{ formatRemaining(props.remaining) }}
  </p>
</template>

<style scoped>
.rest-digits {
  margin: 0;
  color: var(--warning);
  font-family: var(--font-display);
  font-size: var(--type-display-hero);
  line-height: 0.82;
  letter-spacing: var(--tracking-1);
  font-variant-numeric: tabular-nums;
  text-shadow: var(--glow-rest-value);
  transition: color var(--motion-press);
}

.rest-digits--timeup {
  color: var(--text-soft);
  text-shadow: none;
}
</style>
