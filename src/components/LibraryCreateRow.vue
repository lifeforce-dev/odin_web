<script setup lang="ts">
import { ref } from 'vue';

import InlineNameEntry from '@/components/InlineNameEntry.vue';

// The library's inline create affordance: a red-outline ghost row.
// Tapping it swaps in the shared InlineNameEntry (which owns the
// contenteditable machine); a blank commit, Escape, or tapping off the
// row folds back to the idle row. The created workout lands in the
// AVAILABLE group and stays there - no auto-add; the parent handles
// name collisions (the `notice` prop renders its verdict).

defineProps<{
  notice?: string | null;
}>();

const emit = defineEmits<{
  create: [name: string];
}>();

const entering = ref(false);

// A blank commit is a cancel: commit stays explicit, and an empty name
// is nothing to create.
function onCommit(name: string): void {
  entering.value = false;
  if (name.length > 0) {
    emit('create', name);
  }
}
</script>

<template>
  <div class="library-create">
    <button v-if="!entering" type="button" class="library-create__row" @click="entering = true">
      <span class="library-create__label">+ New workout</span>
    </button>
    <div v-else class="library-create__row library-create__row--entering">
      <InlineNameEntry
        placeholder="Name"
        entry-label="New workout name"
        confirm-label="Create workout"
        @commit="onCommit"
        @cancel="entering = false"
      />
    </div>
    <p v-if="notice" class="library-create__notice">{{ notice }}</p>
  </div>
</template>

<style scoped>
.library-create__row {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-3) var(--space-4);
  font: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: var(--rule) solid var(--accent);
}

/* The entry carries its own interior padding (space-1 here + the
   entry's space-3 lands the caret at the idle label's inset). */
.library-create__row--entering {
  padding: 0 0 0 var(--space-1);
  cursor: text;
}

.library-create__label {
  flex: 1;
  color: var(--accent);
  font-size: var(--type-body);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

/* The parent's verdict on a rejected name (e.g. it already exists as
   the other kind); cleared on the next commit. Same recipe as
   WorkoutCard's .workout-card__notice - these move together (only the
   padding differs). */
.library-create__notice {
  margin: var(--space-1) 0 0;
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: var(--leading-notice);
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}
</style>
