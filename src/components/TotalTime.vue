<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { formatHms, secondsElapsed } from '@/domain/timer';

// The total-time widget: label + running HH:MM:SS on a hairline top
// rule. Every tick re-derives the value from the persisted session
// start and the wall clock; the interval is only display cadence, so
// a frozen background webview resumes onto the right digits. Null
// startedAt (no session in flight) parks the readout at 00:00:00.

const props = defineProps<{
  startedAt: string | null;
}>();

const now = ref(new Date());
let intervalHandle: number | undefined;

onMounted(() => {
  intervalHandle = window.setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onBeforeUnmount(() => {
  window.clearInterval(intervalHandle);
});

const readout = computed(() =>
  formatHms(props.startedAt === null ? 0 : secondsElapsed(props.startedAt, now.value)),
);
</script>

<template>
  <div class="total-time">
    <span class="total-time__label">Total Time</span>
    <span class="total-time__value">{{ readout }}</span>
  </div>
</template>

<style scoped>
.total-time {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) 0 var(--space-1);
  border-top: var(--hairline) solid var(--border);
}

.total-time__label {
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.total-time__value {
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-readout);
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--tracking-2);
}
</style>
