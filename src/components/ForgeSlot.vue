<script setup lang="ts">
import { ref } from 'vue';

// The forge (02-07): the create row docked below the pool doubles as
// the delete target. Its face is a SIGNAL (signal-rewrite, 2026-07-15
// pick): a drag begins and a raster line REWRITES it top-to-bottom to
// the dormant x DELETE (the create row stays painted beneath - the
// split face mid-sweep is the tell); the ghost on it arms the energized
// double rail; release plays the reverse rewrite (consume adds the
// tv-off impact first). This component owns the face, the raster line,
// and every forge keyframe; the SCREEN owns placement, the region
// luminance classes, and what rides in the slot (the create row and its
// wiring). Dropping here deletes the workout entirely, from either
// zone. Always laid out, so the boundary is measurable at drag start -
// the screen reads `rootEl` for exactly that.

defineProps<{
  // The exit transient phase (useForgeChoreography): consume plays the
  // impact + reverse rewrite, abort the bare reverse rewrite.
  fx: 'idle' | 'consume' | 'abort';
  // A card is lifted somewhere: the face rewrites in, dormant.
  lifted: boolean;
  // The ghost is over the forge: the energized double rail.
  armed: boolean;
}>();

const rootEl = ref<HTMLElement | null>(null);

defineExpose({ rootEl });
</script>

<template>
  <div
    ref="rootEl"
    class="forge-slot"
    :class="{
      'forge-slot--lifted': lifted,
      'forge-slot--consume': fx === 'consume',
      'forge-slot--abort': fx === 'abort',
    }"
  >
    <slot />
    <p class="forge-slot__face" :class="{ 'forge-slot__face--armed': armed }" aria-hidden="true">
      <span class="forge-slot__x">x</span> DELETE
    </p>
    <span class="forge-slot__raster" aria-hidden="true"></span>
  </div>
</template>

<style scoped>
/* Relative so the face can paint over whatever rides in the slot;
   placement (docking, margins, region filters) is the screen's job. */
.forge-slot {
  position: relative;
}

/* The delete face - DORMANT dress. No red: dashes and dim ink (dashes
   already mean "a row can land here", and red is reserved for the
   pending action); the x rides one step brighter as a colorless aiming
   point. Opaque bg plate: the rewrite reveals this face over the
   still-painted create row, and the split face mid-sweep is the tell.
   Never interactive: drops resolve by coordinates, not events. */
.forge-slot__face {
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

.forge-slot__x {
  color: var(--text-soft);
}

/* MORPH: the drag begins and the raster line rewrites the signal
   top-to-bottom once - above the line the delete face is already
   painted, below it create still shows. */
.forge-slot--lifted .forge-slot__face {
  opacity: 1;
  animation: forge-rewrite calc(var(--motion-morph) * 0.7) linear calc(var(--motion-morph) * 0.1)
    both;
}

/* ARMED: the energized double rail - solid accent border PLUS an inner
   accent rail (two live wires, a signature no other zone wears), charge
   tint over the alarm plate, label at full accent with widened tracking
   (flex layout: no geometry shift). The glow pulses shallowly at the
   --motion-flash cadence via the overlay below - a functional loop on a
   live destructive state, sanctioned with the dnd-03 pick. */
.forge-slot__face--armed,
.forge-slot--consume .forge-slot__face {
  color: var(--accent);
  letter-spacing: var(--tracking-15);
  background: linear-gradient(var(--accent-soft), var(--accent-soft)), var(--surface-alarm);
  border-style: solid;
  border-color: var(--accent);
  outline: var(--hairline) solid var(--accent);
  outline-offset: calc(-1 * (var(--space-1) + var(--rule)));
}

.forge-slot__face--armed .forge-slot__x,
.forge-slot--consume .forge-slot__x {
  color: inherit;
}

.forge-slot__face--armed::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  box-shadow: var(--glow-forge-armed);
  animation: forge-charge var(--motion-flash) ease-in-out infinite;
}

/* CONSUME: release while armed. The face holds the armed dress, takes
   the white-hot impact when the tv-off line lands, then the reverse
   sweep rewrites create back bottom-to-top. */
.forge-slot--consume .forge-slot__face {
  opacity: 1;
  box-shadow: var(--glow-forge-armed);
  animation:
    forge-impact calc(var(--motion-consume) / 6) linear calc(var(--motion-consume) * 0.55) both,
    forge-unwrite calc(var(--motion-consume) * 0.39) linear calc(var(--motion-consume) * 0.61) both;
}

/* ABORT: any other release - the bare reverse sweep, no impact, no
   flicker. The rewrite grammar covers every exit. */
.forge-slot--abort .forge-slot__face {
  opacity: 1;
  animation: forge-unwrite calc(var(--motion-morph) * 0.7) linear both;
}

/* The raster line. Base dress is the white EVENT beam (--raster glow) -
   but only the CONSUME earns it now: a delete is the one moment worth a
   flash. Sits after the face in the DOM, so it paints above at the
   same z. */
.forge-slot__raster {
  position: absolute;
  right: 0;
  left: 0;
  z-index: var(--z-float);
  height: var(--rule);
  pointer-events: none;
  background: var(--text);
  box-shadow: var(--raster);
  opacity: 0;
}

/* MORPH and ABORT sweep with a QUIET edge instead: dim steel, no glow
   (owner feedback 2026-07-16 - a lift is a routine ~200ms gesture, and
   the bright beam at the screen's bottom edge kept stealing the eye
   from the card being dragged; it even read as a stray flash of light.
   The wipe itself still states the rewrite). */
.forge-slot--lifted .forge-slot__raster,
.forge-slot--abort .forge-slot__raster {
  background: var(--text-dim);
  box-shadow: none;
}

.forge-slot--lifted .forge-slot__raster {
  animation: raster-down calc(var(--motion-morph) * 0.7) linear calc(var(--motion-morph) * 0.1) both;
}

.forge-slot--consume .forge-slot__raster {
  animation: raster-up calc(var(--motion-consume) * 0.39) linear calc(var(--motion-consume) * 0.61)
    both;
}

.forge-slot--abort .forge-slot__raster {
  animation: raster-up calc(var(--motion-morph) * 0.7) linear both;
}

@keyframes forge-rewrite {
  from {
    clip-path: inset(0 0 100% 0);
  }

  to {
    clip-path: inset(0 0 0 0);
  }
}

@keyframes forge-unwrite {
  from {
    clip-path: inset(0 0 0 0);
  }

  to {
    clip-path: inset(0 0 100% 0);
  }
}

@keyframes raster-down {
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

@keyframes raster-up {
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

@keyframes forge-charge {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.62;
  }
}

@keyframes forge-impact {
  0% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-forge-armed);
  }

  35% {
    color: var(--text);
    border-color: var(--text);
    box-shadow: var(--raster);
  }

  100% {
    color: var(--accent);
    border-color: var(--accent);
    box-shadow: var(--glow-flash);
  }
}

/* Reduced motion: the face jumps between states, the sweeps and the
   charge pulse hold still. */
@media (prefers-reduced-motion: reduce) {
  .forge-slot--lifted .forge-slot__face,
  .forge-slot--consume .forge-slot__face,
  .forge-slot--abort .forge-slot__face,
  .forge-slot__raster,
  .forge-slot__face--armed::after {
    animation: none;
  }

  .forge-slot--consume .forge-slot__face,
  .forge-slot--abort .forge-slot__face {
    opacity: 0;
  }
}
</style>
