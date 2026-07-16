<script setup lang="ts">
// The workbench pool's group labels, per
// design_reference/components/pool-group-header.html. The two variants
// must separate AT A GLANCE, not by reading: available is bright with a
// glowing accent square and an accent-fade rule; elsewhere is dim with a
// hollow square and a plain rule. The marker is a small SQUARE status
// chip - deliberately not the tall left rail used on rows, so a header
// never reads as a movable item. No counts: how many is not
// decision-relevant here.

defineProps<{
  label: string;
  variant: 'available' | 'elsewhere';
}>();
</script>

<template>
  <div class="pool-group" :class="`pool-group--${variant}`">
    <span class="pool-group__mark" aria-hidden="true"></span>
    <span class="pool-group__label">{{ label }}</span>
    <span class="pool-group__rule" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
.pool-group {
  /* The square status chip; a knob so the two variants and the glow
     always share one size. */
  --group-mark: 7px;

  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-1) 0;
}

.pool-group__mark {
  flex: none;
  width: var(--group-mark);
  height: var(--group-mark);
}

.pool-group__label {
  font-size: var(--type-label);
  font-weight: 800;
  letter-spacing: var(--tracking-2);
  text-transform: uppercase;
}

.pool-group__rule {
  flex: 1;
  height: var(--hairline);
}

.pool-group--available .pool-group__mark {
  background: var(--accent);
  box-shadow: var(--glow-group-mark);
}

.pool-group--available .pool-group__label {
  color: var(--text);
}

.pool-group--available .pool-group__rule {
  background: linear-gradient(90deg, var(--accent-glow), transparent);
}

.pool-group--elsewhere .pool-group__mark {
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
}

.pool-group--elsewhere .pool-group__label {
  color: var(--text-dim);
}

.pool-group--elsewhere .pool-group__rule {
  background: var(--border);
}
</style>
