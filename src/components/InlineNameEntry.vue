<script setup lang="ts">
import { onMounted, ref } from 'vue';

// The inline name-entry machine, shared by the pool's create row and
// the card rename. A contenteditable seeded imperatively: Vue must
// never patch a contenteditable's children, so nothing binds into it.
// Enter or the check commits, Escape cancels, and focus leaving the
// entry cancels too - but focus moving WITHIN it (the confirm button
// on desktop) must not, and the confirm commits on pointerdown,
// beating the blur. The parent owns open/closed state and the verdict
// on the committed text; dress differences stay at the call site.

const props = withDefaults(
  defineProps<{
    // Seeded into the entry when it opens: the current name for a
    // rename, empty for a fresh create.
    seed?: string;
    placeholder?: string;
    // Screen-reader names for the entry and its check ('aria-label'
    // itself would bind as a plain attribute, never reaching a prop).
    entryLabel: string;
    confirmLabel: string;
    // 'data' wears the card-name size (rename swaps in for the name in
    // place); 'body' matches row body text (the create row); 'display'
    // mirrors ScreenHeader's title (the circuit workbench's rename).
    size?: 'body' | 'data' | 'display';
  }>(),
  { seed: '', placeholder: undefined, size: 'body' },
);

const emit = defineEmits<{
  // The trimmed text, blank included: the parent decides what a blank
  // or unchanged commit means.
  commit: [text: string];
  cancel: [];
}>();

const rootEl = ref<HTMLElement | null>(null);
const entryEl = ref<HTMLElement | null>(null);

onMounted(() => {
  if (!entryEl.value) {
    return;
  }
  entryEl.value.textContent = props.seed;
  entryEl.value.focus();
  // Focus alone parks the caret at the HEAD of the seeded text; a
  // rename should pick up typing from the end of the current name.
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(entryEl.value);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

function commit(): void {
  emit('commit', entryEl.value?.textContent?.trim() ?? '');
}

function onFocusOut(event: FocusEvent): void {
  const stillInside =
    event.relatedTarget instanceof Node && rootEl.value?.contains(event.relatedTarget);
  if (!stillInside) {
    emit('cancel');
  }
}
</script>

<template>
  <div
    ref="rootEl"
    class="name-entry"
    :class="{ 'name-entry--data': size === 'data', 'name-entry--display': size === 'display' }"
    @focusout="onFocusOut"
  >
    <span
      ref="entryEl"
      class="name-entry__entry"
      contenteditable="true"
      role="textbox"
      :aria-label="entryLabel"
      :data-placeholder="placeholder"
      @keydown.enter.prevent="commit"
      @keydown.esc="emit('cancel')"
    ></span>
    <button
      type="button"
      class="name-entry__confirm"
      :aria-label="confirmLabel"
      @pointerdown.prevent="commit"
      @click="commit"
    >
      &check;
    </button>
  </div>
</template>

<style scoped>
.name-entry {
  display: flex;
  flex: 1 1 auto;
  align-items: stretch;
  min-width: 0;
  min-height: var(--tap-min);
}

/* Block host, centered via align-self - the contenteditable must not
   be its own flex container: Chrome anchors the empty-state caret to
   a flex container's top-left instead of the line box, so the caret
   floats above the placeholder. The :empty placeholder ::before keeps
   a line box alive (attr() falls back to '') so the caret stays on
   the centered line even with no placeholder text. */
.name-entry__entry {
  display: block;
  flex: 1;
  align-self: center;
  min-width: 1ch;
  padding: 0 var(--space-3);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: var(--type-body);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
  caret-color: var(--warning);
  outline: none;
}

.name-entry--data .name-entry__entry {
  font-size: var(--type-data);
}

/* Mirrors .screen-header__title (weight included): the workbench's
   rename swaps the header for this entry, so the caret and typed name
   land at the same scale and weight the title reads at.
   --leading-display-title also binds CircuitsView's active-name. */
.name-entry--display .name-entry__entry {
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: var(--leading-display-title);
  letter-spacing: var(--tracking-2);
}

.name-entry__entry:empty::before {
  content: attr(data-placeholder);
  color: var(--text-dim);
}

.name-entry__confirm {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: var(--tap-min);
  color: var(--lock);
  font-size: var(--type-data-lg);
  font-weight: 800;
  cursor: pointer;
  background: none;
  border: none;
}
</style>
