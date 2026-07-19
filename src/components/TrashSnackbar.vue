<script setup lang="ts">
// The delete snackbar: the one recovery path for a gesture that
// deliberately has no confirm. Snaps in after the delete target's face
// finishes hiding (the --motion-settle beat keeps the entrance in step with
// the JS phase reset); the parent owns docking and dismissal. `undoable`
// drops the button when the undo cannot deliver (the message then carries
// the failure notice instead).

defineProps<{
  message: string;
  undoable: boolean;
}>();

const emit = defineEmits<{
  undo: [];
}>();
</script>

<template>
  <div class="trash-snackbar" role="status">
    <p class="trash-snackbar__msg">{{ message }}</p>
    <button v-if="undoable" type="button" class="trash-snackbar__undo" @click="emit('undo')">
      Undo
    </button>
  </div>
</template>

<style scoped>
.trash-snackbar {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: 0 var(--space-2) 0 var(--space-3);
  background: var(--surface-raise);
  border: var(--hairline) solid var(--border-strong);
  animation: snack-in calc(var(--motion-delete) * 0.28) steps(2, end)
    calc(var(--motion-delete) + var(--motion-settle)) both;
}

.trash-snackbar__msg {
  flex: 1;
  margin: 0;
  padding: var(--space-3) 0;
  color: var(--text-soft);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

/* Accent-ghost recipe family with NavUpRow - these move together;
   extract at a third copy. 800 here vs the row's 700 is deliberate
   (see NavUpRow.vue). */
.trash-snackbar__undo {
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
  cursor: pointer;
  background: none;
  border: none;
}

@keyframes snack-in {
  from {
    opacity: 0;
    transform: translateY(var(--space-2));
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .trash-snackbar {
    animation: none;
  }
}
</style>
