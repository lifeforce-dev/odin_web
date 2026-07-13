<script setup lang="ts">
// The one component that owns the viewport (STYLEGUIDE.md section 10):
// safe-area tokens, 100dvh, and the fixed-header / scrollable-middle /
// docked-action layout primitive. Screens render inside it and never
// touch viewport units or safe areas themselves. This file and styles/
// are the only carve-outs from the stylelint token wall.

defineSlots<{
  header?: () => unknown;
  default: () => unknown;
  action?: () => unknown;
}>();
</script>

<template>
  <div class="app-shell">
    <header v-if="$slots.header" class="app-shell__header">
      <slot name="header" />
    </header>
    <main class="app-shell__body">
      <slot />
    </main>
    <!-- Always rendered: its bottom padding keeps content and any docked
         action off the home-indicator area even when the slot is empty. -->
    <footer class="app-shell__action">
      <slot name="action" />
    </footer>
    <div class="app-shell__scanlines" aria-hidden="true"></div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding-top: var(--safe-top);
  padding-right: var(--safe-right);
  padding-left: var(--safe-left);
  background-color: var(--bg);
  background-image: var(--texture-grain);
  background-size: var(--texture-grain-size);
}

.app-shell__header {
  flex: none;
}

/* Scroll-by-default: no screen is designed to exactly fit a height. */
.app-shell__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.app-shell__action {
  flex: none;
  z-index: var(--z-docked);
  padding-bottom: var(--safe-bottom);
}

.app-shell__scanlines {
  position: fixed;
  inset: 0;
  z-index: var(--z-scanline);
  pointer-events: none;
  background: var(--texture-scanline);
}
</style>
