<script setup lang="ts">
// The inline fold-open confirm, generalizing PoolElsewhereRow's steal
// strip grammar (accent-soft plate, a consequence line, two actions) to
// any state-changing action the circuits screen fires: shown every
// time, never a modal. detailValue is composed AFTER detail here
// (`detail // VALUE`), never string-interpolated by the caller - the
// same rule ScreenHeader's eyebrowValue follows, so a future i18n pass
// can key off the static copy alone.

withDefaults(
  defineProps<{
    message: string;
    detail?: string;
    detailValue?: string;
    confirmLabel: string;
    cancelLabel?: string;
  }>(),
  { detail: undefined, detailValue: undefined, cancelLabel: 'Keep it' },
);

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<template>
  <div class="confirm-strip">
    <p class="confirm-strip__message">{{ message }}</p>
    <p v-if="detail" class="confirm-strip__detail">
      {{ detail }}<template v-if="detailValue !== undefined"> // {{ detailValue }}</template>
    </p>
    <div class="confirm-strip__actions">
      <button type="button" class="confirm-strip__cancel" @click="emit('cancel')">
        {{ cancelLabel }}
      </button>
      <button type="button" class="confirm-strip__confirm red-ghost-btn" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.confirm-strip {
  padding: var(--space-3) var(--space-4);
  background: var(--accent-soft);
  border: var(--hairline) solid var(--accent);
  animation: confirm-strip-in var(--motion-press) ease-out;
}

@keyframes confirm-strip-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.confirm-strip__message {
  margin: 0;
  color: var(--text);
  font-size: var(--type-body);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.confirm-strip__detail {
  margin: var(--space-1) 0 0;
  color: var(--text-soft);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.confirm-strip__actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.confirm-strip__cancel,
.confirm-strip__confirm {
  flex: 1;
  min-height: var(--tap-min);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-15);
  text-transform: uppercase;
  cursor: pointer;
  transition: background var(--motion-press);
}

.confirm-strip__cancel {
  color: var(--text-dim);
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
}

@media (prefers-reduced-motion: reduce) {
  .confirm-strip {
    animation: none;
  }
}
</style>
