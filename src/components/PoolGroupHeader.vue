<script setup lang="ts">
// The workbench pool's group labels. The two variants must separate AT
// A GLANCE, not by reading: available wears the steel supply mark with
// a supply-fade rule (loaded-rack, 2026-07-15: red means membership
// now, so supply does not spend it - and does not glow); elsewhere is
// dim with a hollow square and a plain rule. The marker is a small
// SQUARE status chip - deliberately not the tall left rail used on
// rows, so a header never reads as a movable item. No counts: how many
// is not decision-relevant here. (The ref file keeps the older glowing
// accent mark; refs are visual spec only.)

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
  background: var(--supply);
}

.pool-group--available .pool-group__label {
  color: var(--text-soft);
}

.pool-group--available .pool-group__rule {
  background: linear-gradient(90deg, var(--supply-soft), transparent);
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
