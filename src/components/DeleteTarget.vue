<script setup lang="ts">
import { ref } from 'vue';

// The delete target: the create row docked below the library doubles as the
// drop-to-delete slot. When a drag begins, a sweep line reveals the
// "x DELETE" face top-to-bottom over the still-painted create row (the
// half-revealed face mid-sweep is the cue). A card held over it arms the
// accent border and glow; releasing over it deletes, releasing elsewhere
// cancels. This component owns the face, the sweep line, and every
// keyframe; the screen owns placement, the region luminance classes, and
// what sits in the slot. Dropping here deletes the workout entirely, from
// either zone. Always laid out, so its top edge is measurable at drag
// start - the screen reads `rootEl` for exactly that.

defineProps<{
  // The exit animation phase (useCardExitAnimation): 'delete' plays the
  // flash then hides the face, 'cancel' just hides it.
  fx: 'idle' | 'delete' | 'cancel';
  // A card is lifted somewhere: the DELETE face reveals, unarmed.
  lifted: boolean;
  // A card is held over the target: accent border and glow.
  armed: boolean;
}>();

const rootEl = ref<HTMLElement | null>(null);

defineExpose({ rootEl });
</script>

<template>
  <div
    ref="rootEl"
    class="delete-target"
    :class="{
      'delete-target--lifted': lifted,
      'delete-target--deleting': fx === 'delete',
      'delete-target--cancel': fx === 'cancel',
    }"
  >
    <slot />
    <p
      class="delete-target__face"
      :class="{ 'delete-target__face--armed': armed }"
      aria-hidden="true"
    >
      <span class="delete-target__x">x</span> DELETE
    </p>
    <span class="delete-target__sweep-line" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
/* Relative so the face can paint over whatever rides in the slot;
   placement (docking, margins, region filters) is the screen's job. */
.delete-target {
  position: relative;
}

/* The DELETE face at rest. No red: dashes and dim ink (dashes already mean
   "a row can land here", and red is reserved for the pending action); the x
   sits one step brighter as a colorless aiming point. Opaque bg plate: the
   reveal shows this face over the still-painted create row, and the
   half-revealed face mid-sweep is the cue. Never interactive: drops resolve
   by coordinates, not events. */
.delete-target__face {
  position: absolute;
  inset: 0;
  z-index: var(--z-float);
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin: 0;
  padding: var(--space-3) var(--space-4);
  color: var(--text-dim);
  font-size: var(--type-body);
  font-weight: 800;
  letter-spacing: var(--tracking-1);
  pointer-events: none;
  background: var(--bg);
  border: var(--rule) dashed var(--border-strong);
  opacity: 0;
}

.delete-target__x {
  color: var(--text-soft);
}

/* REVEAL: a drag begins and the sweep line reveals the face top-to-bottom
   once - above the line the DELETE face shows, below it the create row
   still shows. */
.delete-target--lifted .delete-target__face {
  opacity: 1;
  animation: delete-face-reveal calc(var(--motion-morph) * 0.7) linear
    calc(var(--motion-morph) * 0.1) both;
}

/* ARMED: a card is over the target - solid accent border plus an inner
   accent outline (nothing else in the app wears both), an accent tint over
   the alarm plate, and the label at full accent with widened tracking (flex
   layout, so no geometry shift). The glow pulses shallowly at the
   --motion-flash cadence via the overlay below - a live destructive state. */
.delete-target__face--armed,
.delete-target--deleting .delete-target__face {
  color: var(--accent);
  letter-spacing: var(--tracking-15);
  background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--surface-alarm);
  border-style: solid;
  border-color: var(--accent);
  outline: var(--hairline) solid var(--accent);
  outline-offset: calc(-1 * (var(--space-1) + var(--rule)));
}

.delete-target__face--armed .delete-target__x,
.delete-target--deleting .delete-target__x {
  color: inherit;
}

.delete-target__face--armed::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: var(--glow-delete-armed);
  animation: delete-armed-pulse var(--motion-flash) ease-in-out infinite;
}

/* DELETE: release while armed. The face keeps the armed look, flashes white
   when the collapsing card's line lands (delete-flash), then the sweep hides
   the face bottom-to-top and the create row shows again. */
.delete-target--deleting .delete-target__face {
  opacity: 1;
  box-shadow: var(--glow-delete-armed);
  animation:
    delete-flash calc(var(--motion-delete) / 6) linear calc(var(--motion-delete) * 0.55) both,
    delete-face-hide calc(var(--motion-delete) * 0.39) linear calc(var(--motion-delete) * 0.61) both;
}

/* CANCEL: any other release - just the hide sweep, no flash, no flicker.
   The same reveal-and-hide sweep covers every exit. */
.delete-target--cancel .delete-target__face {
  opacity: 1;
  animation: delete-face-hide calc(var(--motion-morph) * 0.7) linear both;
}

/* The sweep line. Only a delete earns the white glow (--glow-sweep-line): a
   delete is the one moment worth a flash. Sits after the face in the DOM, so
   it paints above at the same z. */
.delete-target__sweep-line {
  position: absolute;
  right: 0;
  left: 0;
  z-index: var(--z-float);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--glow-sweep-line);
  opacity: 0;
}

/* REVEAL and CANCEL sweep with a quiet edge instead: dim, no glow. A lift is
   a routine gesture, and a bright line at the screen's bottom edge would
   steal the eye from the card being dragged; the sweep itself still shows
   the reveal. */
.delete-target--lifted .delete-target__sweep-line,
.delete-target--cancel .delete-target__sweep-line {
  background: var(--text-dim);
  box-shadow: none;
}

.delete-target--lifted .delete-target__sweep-line {
  animation: sweep-down calc(var(--motion-morph) * 0.7) linear calc(var(--motion-morph) * 0.1) both;
}

.delete-target--deleting .delete-target__sweep-line {
  animation: sweep-up calc(var(--motion-delete) * 0.39) linear calc(var(--motion-delete) * 0.61)
    both;
}

.delete-target--cancel .delete-target__sweep-line {
  animation: sweep-up calc(var(--motion-morph) * 0.7) linear both;
}

@keyframes delete-face-reveal {
  from {
    clip-path: inset(0 0 100% 0);
  }

  to {
    clip-path: inset(0 0 0 0);
  }
}

@keyframes delete-face-hide {
  from {
    clip-path: inset(0 0 0 0);
  }

  to {
    clip-path: inset(0 0 100% 0);
  }
}

@keyframes sweep-down {
  0% {
    top: 0;
    opacity: 1;
  }

  95% {
    opacity: 1;
  }

  100% {
    top: calc(100% - var(--rule));
    opacity: 0;
  }
}

@keyframes sweep-up {
  0% {
    top: calc(100% - var(--rule));
    opacity: 1;
  }

  95% {
    opacity: 1;
  }

  100% {
    top: 0;
    opacity: 0;
  }
}

@keyframes delete-armed-pulse {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.62;
  }
}

@keyframes delete-flash {
  0% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-delete-armed);
  }

  35% {
    color: var(--text);
    border-color: var(--text);
    box-shadow: var(--glow-sweep-line);
  }

  100% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-flash);
  }
}

/* Reduced motion: the face jumps between states, the sweeps and the armed
   pulse hold still. */
@media (prefers-reduced-motion: reduce) {
  .delete-target--lifted .delete-target__face,
  .delete-target--deleting .delete-target__face,
  .delete-target--cancel .delete-target__face,
  .delete-target__sweep-line,
  .delete-target__face--armed::after {
    animation: none;
  }

  .delete-target--deleting .delete-target__face,
  .delete-target--cancel .delete-target__face {
    opacity: 0;
  }
}
</style>
