<script setup lang="ts">
// The docked full-width action bar: one geometry, three color
// variants. 'amber' is the lift-page's START REST/FINISH; 'ghost'/
// 'filled' are the rest screen's NEXT SET/FINISH before and at
// time-up (pulsing is a ghost-only modifier). THE docked CTA: every
// screen and the gallery board import this component rather than
// drawing their own copy.

withDefaults(
  defineProps<{
    variant: 'amber' | 'ghost' | 'filled';
    label: string;
    pulsing?: boolean;
  }>(),
  { pulsing: false },
);

const emit = defineEmits<{
  press: [];
}>();
</script>

<template>
  <button
    type="button"
    class="docked-action"
    :class="[
      `docked-action--${variant}`,
      { 'docked-action--pulsing': variant === 'ghost' && pulsing },
    ]"
    @click="emit('press')"
  >
    {{ label }}
  </button>
</template>

<style scoped>
.docked-action {
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--type-data);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  text-align: center;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    transform var(--motion-press),
    background var(--motion-press),
    color var(--motion-press),
    border-color var(--motion-press);
}

.docked-action:active {
  transform: scale(0.98);
}

/* Amber: the lift page's rest channel - "go rest" never wears the
   lifting red. */
.docked-action--amber {
  color: var(--bg);
  background: var(--warning);
  border: none;
}

.docked-action--amber:active {
  background: var(--warning-deep);
}

/* Ghost: the vermilion-outline doorway back to the act-state. */
.docked-action--ghost {
  color: var(--accent);
  background: transparent;
  border: var(--rule) solid var(--accent);
}

.docked-action--pulsing {
  animation: docked-action-pulse var(--motion-pulse) ease-in-out infinite;
}

@keyframes docked-action-pulse {
  0%,
  100% {
    background: transparent;
  }

  50% {
    background: var(--accent-soft);
  }
}

/* Filled: time-up (or final mode) - the loudest thing on the screen. */
.docked-action--filled {
  color: var(--text);
  background: var(--accent);
  border: var(--rule) solid var(--accent);
  box-shadow: var(--glow-cta);
}

@media (prefers-reduced-motion: reduce) {
  .docked-action {
    transition: none;
  }

  .docked-action--pulsing {
    animation: none;
  }
}
</style>
