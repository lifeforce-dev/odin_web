<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

import StepperField from '@/components/StepperField.vue';
import { useOneShot } from '@/composables/useOneShot';

// Auto-log editor for the just-finished set: reps + weight, each a
// StepperField riding its shared pads/hold-to-ramp, with a
// contenteditable well swapped in for the plain display (the Bebas
// Neue line-box gotcha rules out <input>). Write-behind: every pad tap
// or keystroke updates local state instantly and the parent commits on
// a settle window, so a tap-tap-tap burst or a fast typed correction
// coalesces into the row's last value instead of a write per keystroke.
//
// Focus invariant: a prop change (a fresh arrival, or a post-failure
// DB-truth resync) skips the local + DOM rewrite while that well is
// document.activeElement - an active edit wins, and its own blur flush
// re-commits it because local then differs from lastCommitted. A pad
// tap always rewrites local + DOM, focused or not (an explicit user
// action, never an echo), re-placing the caret at the end when
// focused. lastCommitted tracks the last value actually emitted
// (seeded from props, updated on every emit AND by both prop watches
// even when they skip the rewrite), so a flush with nothing pending -
// an action tap, an untouched blur, teardown - emits nothing instead
// of a no-op write.

const props = defineProps<{
  reps: number;
  weight: number;
  weightUnit: 'lb' | 'kg';
}>();

const emit = defineEmits<{
  commit: [{ reps: number; weight: number }];
}>();

const COMMIT_DEBOUNCE_MS = 300;
const REPS_STEP = 1;
const WEIGHT_STEP = 5;

const NAV_KEYS = new Set(['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End']);

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function normalizeReps(value: number): number {
  return Math.max(0, Math.trunc(value));
}

function normalizeWeight(value: number): number {
  return Math.max(0, roundToHalf(value));
}

// Strips a pasted string down to the field's legal characters, keeping
// at most one decimal point - the same shape onKeydown enforces one
// keystroke at a time.
function sanitizeNumericText(raw: string, allowDecimal: boolean): string {
  let seenDot = false;
  let result = '';
  for (const char of raw) {
    if (char === '.' && allowDecimal) {
      if (seenDot) {
        continue;
      }
      seenDot = true;
      result += char;
      continue;
    }
    if (/[0-9]/.test(char)) {
      result += char;
    }
  }
  return result;
}

interface NumericWellConfig {
  el: Ref<HTMLElement | null>;
  initial: number;
  allowDecimal: boolean;
  parse: (raw: string) => number;
  normalize: (value: number) => number;
  onChange: () => void;
  onBlurCommit: () => void;
}

// One shared implementation of sync/adjust/input/blur/paste/focus-guard
// for a contenteditable numeric well; reps and weight differ only in
// their config (integer vs 0.5-stepped decimal).
function makeNumericWell(config: NumericWellConfig) {
  const value = ref(config.initial);

  function isFocused(): boolean {
    return config.el.value !== null && config.el.value === document.activeElement;
  }

  function render(): void {
    if (config.el.value) {
      config.el.value.textContent = String(value.value);
    }
  }

  function placeCaretAtEnd(): void {
    const el = config.el.value;
    if (!el) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function resyncFromProp(next: number): void {
    if (isFocused()) {
      return;
    }
    value.value = next;
    render();
  }

  function adjust(delta: number): void {
    value.value = config.normalize(value.value + delta);
    render();
    if (isFocused()) {
      placeCaretAtEnd();
    }
    config.onChange();
  }

  function onInput(): void {
    const raw = config.el.value?.textContent ?? '';
    value.value = config.parse(raw);
    config.onChange();
  }

  function onBlur(): void {
    value.value = config.normalize(value.value);
    render();
    config.onBlurCommit();
  }

  function onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const el = config.el.value;
    if (!el) {
      return;
    }
    const raw = event.clipboardData?.getData('text/plain') ?? '';
    const sanitized = sanitizeNumericText(raw, config.allowDecimal);
    const selection = window.getSelection();
    let range: Range;
    if (
      selection &&
      selection.rangeCount > 0 &&
      el.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
    }
    range.deleteContents();
    range.insertNode(document.createTextNode(sanitized));
    range.collapse(false);
    onInput();
  }

  // Digits (plus a single dot when allowDecimal) only; Enter commits via
  // blur. A nicety only: Android soft keyboards report 'Unidentified'
  // for every key, which never matches these patterns, so onInput's
  // parse-on-input is the guard that actually blocks bad input.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLElement).blur();
      return;
    }
    if (NAV_KEYS.has(event.key) || event.metaKey || event.ctrlKey) {
      return;
    }
    if (event.key === '.' && config.allowDecimal) {
      const current = (event.target as HTMLElement).textContent ?? '';
      if (current.includes('.')) {
        event.preventDefault();
      }
      return;
    }
    const pattern = config.allowDecimal ? /[0-9.]/ : /[0-9]/;
    if (event.key.length === 1 && !pattern.test(event.key)) {
      event.preventDefault();
    }
  }

  return { value, render, resyncFromProp, adjust, onInput, onBlur, onPaste, onKeydown };
}

const settle = useOneShot();
let lastCommitted = { reps: props.reps, weight: props.weight };

const repsEl = ref<HTMLElement | null>(null);
const weightEl = ref<HTMLElement | null>(null);

function scheduleCommit(): void {
  settle.set(flushCommit, COMMIT_DEBOUNCE_MS);
}

// Cancels the settle shot and normalizes at the boundary; a flush that
// lands on the same value already committed (an action tap with
// nothing pending, an untouched blur, teardown) emits nothing.
function flushCommit(): void {
  settle.cancel();
  const normalized = {
    reps: normalizeReps(repsWell.value.value),
    weight: normalizeWeight(weightWell.value.value),
  };
  if (normalized.reps === lastCommitted.reps && normalized.weight === lastCommitted.weight) {
    return;
  }
  lastCommitted = normalized;
  emit('commit', normalized);
}

const repsWell = makeNumericWell({
  el: repsEl,
  initial: props.reps,
  allowDecimal: false,
  parse: (raw) => Math.max(0, Number.parseInt(raw, 10) || 0),
  normalize: normalizeReps,
  onChange: scheduleCommit,
  onBlurCommit: flushCommit,
});

const weightWell = makeNumericWell({
  el: weightEl,
  initial: props.weight,
  allowDecimal: true,
  parse: (raw) => {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  },
  normalize: normalizeWeight,
  onChange: scheduleCommit,
  onBlurCommit: flushCommit,
});

onMounted(() => {
  repsWell.render();
  weightWell.render();
});

// A prop change means a fresh arrival or a post-failure re-derive
// (the DB wins) - never a keystroke echoing back, since typing stays
// local until commit. lastCommitted updates even when the well itself
// is focused and skips the rewrite (see the focus invariant above).
watch(
  () => props.reps,
  (value) => {
    lastCommitted = { ...lastCommitted, reps: value };
    repsWell.resyncFromProp(value);
  },
);
watch(
  () => props.weight,
  (value) => {
    lastCommitted = { ...lastCommitted, weight: value };
    weightWell.resyncFromProp(value);
  },
);

defineExpose({ flush: flushCommit });

// The parent's write chain outlives this component, so flushing here
// lands an edit still pending inside the settle window (a Skip/back
// navigation, or an unmount from advancing) instead of dropping it.
onBeforeUnmount(flushCommit);
</script>

<template>
  <div class="log-set-control">
    <StepperField
      label="Rep Count"
      :dec-label="'\u2212'"
      inc-label="+"
      :step="REPS_STEP"
      @adjust="repsWell.adjust"
    >
      <template #value>
        <div
          ref="repsEl"
          class="log-set-control__well"
          contenteditable="true"
          inputmode="numeric"
          role="textbox"
          aria-label="Reps"
          @keydown="repsWell.onKeydown"
          @input="repsWell.onInput"
          @blur="repsWell.onBlur"
          @paste="repsWell.onPaste"
        ></div>
        <span class="log-set-control__unit">reps</span>
      </template>
    </StepperField>
    <StepperField
      :label="`Weight (${weightUnit})`"
      :dec-label="'\u2212'"
      inc-label="+"
      :step="WEIGHT_STEP"
      @adjust="weightWell.adjust"
    >
      <template #value>
        <div
          ref="weightEl"
          class="log-set-control__well"
          contenteditable="true"
          inputmode="decimal"
          role="textbox"
          aria-label="Weight"
          @keydown="weightWell.onKeydown"
          @input="weightWell.onInput"
          @blur="weightWell.onBlur"
          @paste="weightWell.onPaste"
        ></div>
        <span class="log-set-control__unit">{{ weightUnit }}</span>
      </template>
    </StepperField>
  </div>
</template>

<style scoped>
.log-set-control {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.log-set-control__well {
  min-width: 1ch;
  text-align: center;
  caret-color: var(--warning);
  outline: none;
}

.log-set-control__unit {
  margin-top: var(--space-1);
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}
</style>
