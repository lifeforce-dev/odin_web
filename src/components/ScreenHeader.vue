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
    // Opt-in dim pencil after the title (the workbench's rename path).
    // Default stays exactly today's render for every other screen.
    editable?: boolean;
  }>(),
  {
    eyebrow: undefined,
    eyebrowValue: undefined,
    editable: false,
  },
);

const emit = defineEmits<{
  edit: [];
}>();

defineSlots<{
  eyebrow?: () => unknown;
}>();
</script>

<template>
  <header class="screen-header">
    <div v-if="editable" class="screen-header__title-row">
      <h1 class="screen-header__title">{{ title }}</h1>
      <button type="button" class="screen-header__pencil" aria-label="Rename" @click="emit('edit')">
        &#9998;
      </button>
    </div>
    <h1 v-else class="screen-header__title">{{ title }}</h1>
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

.screen-header__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

/* Titles are identity and stay white: red is reserved for state and
   action, never identity. --leading-display-title also binds
   InlineNameEntry's display size and CircuitsView's active-name. */
.screen-header__title {
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: var(--leading-display-title);
  letter-spacing: var(--tracking-2);
}

/* The rename affordance: dim ink, never accent - the pencil edits
   identity, it does not act on it. */
.screen-header__pencil {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--text-dim);
  font-size: var(--type-data-lg);
  cursor: pointer;
  background: none;
  border: none;
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
