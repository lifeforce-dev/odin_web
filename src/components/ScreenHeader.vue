<script setup lang="ts">
import { useRouter } from 'vue-router';
import type { RouteLocationRaw } from 'vue-router';

// Shared flow-screen header: back affordance + title + eyebrow.
//
// Back matches hardware back wherever the stack has somewhere to pop.
// At the history bottom (dev reload straight onto the route, WebView
// state restore, a deep link) hardware back minimizes the app, so the
// on-screen affordance replaces to the screen's declared parent
// instead of silently doing nothing (a bare router.back() is a no-op
// there).

// eyebrowValue is a separate prop, never string-interpolated into eyebrow
// by the caller: keeps the static copy and the dynamic value apart at the
// call site so a future i18n pass can key off "eyebrow" alone instead of
// unpicking baked-in data from every screen's template. Screens whose
// eyebrow is fully computed copy (the workbench's "N Workouts") pass the
// eyebrow slot instead.
const props = withDefaults(
  defineProps<{
    title: string;
    backTo: RouteLocationRaw;
    eyebrow?: string;
    eyebrowValue?: string | number;
    backLabel?: string;
  }>(),
  {
    eyebrow: undefined,
    eyebrowValue: undefined,
    backLabel: 'Back',
  },
);

defineSlots<{
  eyebrow?: () => unknown;
}>();

const router = useRouter();

function goBack(): void {
  // vue-router writes back: null into history.state at the stack bottom.
  if (router.options.history.state.back == null) {
    void router.replace(props.backTo);
    return;
  }
  router.back();
}
</script>

<template>
  <header class="screen-header">
    <button type="button" class="screen-header__back" @click="goBack">
      &#8592; {{ backLabel }}
    </button>
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

/* Small type, but the transparent button box carries the full tap-min
   hit area. */
.screen-header__back {
  display: flex;
  align-items: center;
  align-self: flex-start;
  min-height: var(--tap-min);
  padding: 0;
  color: var(--text-soft);
  font-family: var(--font-mono);
  font-size: var(--type-body);
  font-weight: 700;
  letter-spacing: var(--tracking-1);
  cursor: pointer;
  background: none;
  border: none;
}

.screen-header__back:active {
  color: var(--text);
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
