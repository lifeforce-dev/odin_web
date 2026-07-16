<script setup lang="ts">
// Home menu row: a full-width surface row whose red chevron is the tap
// affordance (a touch app has no hover, so the resting accent carries
// the whole "you can press me" message). Render-only: the screen owns
// navigation and placement; clicks reach the parent via attribute
// fallthrough on the root button. Primary marks the one action a user
// wants ~95% of the time (red border, accent wash, resting glow).

defineProps<{
  disabled?: boolean;
  primary?: boolean;
}>();

defineSlots<{
  default: () => unknown;
}>();
</script>

<template>
  <button
    type="button"
    class="menu-button"
    :class="{ 'menu-button--primary': primary }"
    :disabled="disabled"
  >
    <span class="menu-button__label"><slot /></span>
    <span class="menu-button__arrow" aria-hidden="true">&#8594;</span>
  </button>
</template>

<style scoped>
.menu-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-6);
  font-family: var(--font-mono);
  font-size: var(--type-data-xl);
  font-weight: 700;
  text-align: left;
  color: var(--text);
  cursor: pointer;
  background: var(--surface);
  border: var(--hairline) solid var(--border);
  transition: transform var(--motion-press);
}

.menu-button:active {
  transform: scale(0.985);
}

/* A disabled primary drops the dress with the affordance: a glowing
   red row that cannot be pressed would be a lie. */
.menu-button--primary:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
  box-shadow: var(--glow-cta);
}

.menu-button__arrow {
  color: var(--accent);
  font-size: var(--type-data-lg);
}

/* Disabled rows drop the accent to the dim tier: no affordance, no lie. */
.menu-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.menu-button:disabled .menu-button__arrow {
  color: var(--text-dim);
}
</style>
