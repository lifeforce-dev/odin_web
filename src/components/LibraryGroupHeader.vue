<script setup lang="ts">
// The workbench library's group labels. The two variants must separate
// at a glance, not by reading: available wears the steel supply mark
// with a supply-fade rule (red means membership, so supply spends
// neither red nor glow); elsewhere is dim with a hollow square and a
// plain rule. The marker is a small square status chip - deliberately
// not the tall left rail used on rows, so a header never reads as a
// movable item. No counts: how many is not decision-relevant here.

defineProps<{
  label: string;
  variant: 'available' | 'elsewhere';
}>();
</script>

<template>
  <div class="library-group" :class="`library-group--${variant}`">
    <span class="library-group__mark" aria-hidden="true"></span>
    <span class="library-group__label">{{ label }}</span>
    <span class="library-group__rule" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.library-group {
  /* The square status chip; a knob so the two variants and the glow
     always share one size. */
  --group-mark: 7px;

  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-1) 0;
}

.library-group__mark {
  flex: none;
  width: var(--group-mark);
  height: var(--group-mark);
}

.library-group__label {
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.library-group__rule {
  flex: 1;
  height: var(--hairline);
}

.library-group--available .library-group__mark {
  background: var(--supply);
}

.library-group--available .library-group__label {
  color: var(--text-soft);
}

.library-group--available .library-group__rule {
  background: linear-gradient(90deg, var(--supply-soft), transparent);
}

.library-group--elsewhere .library-group__mark {
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
}

.library-group--elsewhere .library-group__label {
  color: var(--text-dim);
}

.library-group--elsewhere .library-group__rule {
  background: var(--border);
}
</style>
