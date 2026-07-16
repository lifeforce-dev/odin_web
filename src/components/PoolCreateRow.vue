<script setup lang="ts">
import { nextTick, ref } from 'vue';

// The pool's inline create affordance, per the canonical workbench page
// (design_reference/circuit-workbench.html): a red-outline ghost row in
// the + ADD CIRCUIT language. Tapping it swaps in a contenteditable name
// entry (the repo's established pattern for tight number/name entry -
// see the log-set gotcha) with a confirm check; Enter or the check
// commits, while a blank commit, Escape, or tapping off the row folds
// back to the idle row. The created workout lands in the AVAILABLE group
// and stays there (02-07: no auto-add); the parent handles name
// collisions (the `notice` prop renders its verdict when a name is
// rejected).

defineProps<{
  notice?: string | null;
}>();

const emit = defineEmits<{
  create: [name: string];
}>();

const entering = ref(false);
const entryEl = ref<HTMLElement | null>(null);
const entryRowEl = ref<HTMLElement | null>(null);

async function startEntry(): Promise<void> {
  entering.value = true;
  await nextTick();
  entryEl.value?.focus();
}

function commit(): void {
  const name = entryEl.value?.textContent?.trim() ?? '';
  entering.value = false;
  if (name.length > 0) {
    emit('create', name);
  }
}

function cancel(): void {
  entering.value = false;
}

// Tapping anywhere off the row abandons the entry (typed text and all) -
// commit is only ever the explicit check or Enter. Focus moving WITHIN
// the row (the confirm button on desktop) must not cancel; the confirm
// itself commits on pointerdown, before any focus can leave the entry.
function onEntryFocusOut(event: FocusEvent): void {
  const stillInside =
    event.relatedTarget instanceof Node && entryRowEl.value?.contains(event.relatedTarget);
  if (!stillInside) {
    cancel();
  }
}
</script>

<template>
  <div class="pool-create">
    <button
      v-if="!entering"
      type="button"
      class="pool-create__row"
      @click="() => void startEntry()"
    >
      <span class="pool-create__label">+ New workout</span>
    </button>
    <div
      v-else
      ref="entryRowEl"
      class="pool-create__row pool-create__row--entering"
      @focusout="onEntryFocusOut"
    >
      <span
        ref="entryEl"
        class="pool-create__entry"
        contenteditable="true"
        role="textbox"
        aria-label="New workout name"
        data-placeholder="Name"
        @keydown.enter.prevent="commit"
        @keydown.esc="cancel"
      ></span>
      <button
        type="button"
        class="pool-create__confirm"
        aria-label="Create workout"
        @pointerdown.prevent="commit"
        @click="commit"
      >
        &check;
      </button>
    </div>
    <p v-if="notice" class="pool-create__notice">{{ notice }}</p>
  </div>
</template>

<style scoped>
.pool-create__row {
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

.pool-create__row--entering {
  padding-right: 0;
  cursor: text;
}

.pool-create__label {
  flex: 1;
  color: var(--accent);
  font-size: var(--type-body);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}

.pool-create__entry {
  flex: 1;
  min-width: 1ch;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-body);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
  caret-color: var(--warning);
  outline: none;
}

.pool-create__entry:empty::before {
  content: attr(data-placeholder);
  color: var(--text-dim);
}

.pool-create__confirm {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  min-width: var(--tap-min);
  color: var(--lock);
  font-size: var(--type-data-lg);
  font-weight: 800;
  cursor: pointer;
  background: none;
  border: none;
}

/* The parent's verdict on a rejected name (e.g. it already exists as
   the other kind); cleared on the next commit. */
.pool-create__notice {
  margin: var(--space-1) 0 0;
  color: var(--accent);
  font-size: var(--type-micro);
  line-height: 1.7;
  letter-spacing: var(--tracking-1);
  text-transform: uppercase;
}
</style>
