<script setup lang="ts">
// A screen-level status note (unavailable / missing / loading / error):
// quiet body type in place of the screen's content, never a layout
// feature. The optional action prop renders a ghost button under the
// note (red = the action, per the color roles) and emits on tap.

defineProps<{
  action?: string;
}>();

defineSlots<{
  default: () => unknown;
}>();

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="screen-note">
    <p class="screen-note__text"><slot /></p>
    <button v-if="action" type="button" class="screen-note__action" @click="emit('action')">
      {{ action }}
    </button>
  </div>
</template>

<style scoped>
.screen-note {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

.screen-note__text {
  margin: 0;
  color: var(--text-soft);
  font-size: var(--type-body);
}

.screen-note__action {
  min-height: var(--tap-min);
  padding: var(--space-2) var(--space-4);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  cursor: pointer;
  background: transparent;
  border: var(--hairline) solid var(--accent);
  transition: background var(--motion-press);
}

.screen-note__action:active {
  background: var(--accent-soft);
}
</style>
