<script setup lang="ts">
// Shared flow-screen header: title + eyebrow. The back affordance lives
// in NavUpRow / the structural up-map (src/router/up.ts) instead - this
// component draws identity only.

// eyebrowValue is a separate prop, never string-interpolated into eyebrow
// by the caller: keeps the static copy and the dynamic value apart at the
// call site so a future i18n pass can key off "eyebrow" alone instead of
// unpicking baked-in data from every screen's template. Screens whose
// eyebrow is fully computed copy (the workbench's "N Workouts") pass the
// eyebrow slot instead.
withDefaults(
  defineProps<{
    title: string;
    eyebrow?: string;
    eyebrowValue?: string | number;
  }>(),
  {
    eyebrow: undefined,
    eyebrowValue: undefined,
  },
);

defineSlots<{
  eyebrow?: () => unknown;
}>();
</script>

<template>
  <header class="screen-header">
    <h1 class="screen-header__title">{{ title }}</h1>
    <p v-if="eyebrow || $slots.eyebrow" class="screen-header__eyebrow">
      <slot name="eyebrow">
        {{ eyebrow }}<template v-if="eyebrowValue !== undefined"> // {{ eyebrowValue }}</template>
      </slot>
    </p>
  </header>
</template>

<style scoped>
.screen-header {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

/* Titles are identity and stay white: red is reserved for state and
   action, never identity. */
.screen-header__title {
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: 0.9;
  letter-spacing: var(--tracking-2);
}

.screen-header__eyebrow {
  margin: var(--space-3) 0 var(--space-6);
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-3);
  text-transform: uppercase;
}
</style>
