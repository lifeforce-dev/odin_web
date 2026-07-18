<script setup lang="ts">
// The permission primer: a first-time, once-ever dialog that makes the
// value case in the app's own voice before the OS permission surface
// (owner decision, 2026-07-13). Purely presentational - copy in, two
// intents out - so the same dialog serves rest today and the stretch
// flow later, and the gallery can board it against every theme. The
// scrim never dismisses: a stray tap would permanently suppress the one
// education pass, so both choices are explicit.
//
// aria-modal="true" is honoured for real (this is the app's first modal,
// so it sets the precedent): focus moves into the card on open, Tab is
// trapped to the two actions, and focus is restored to the trigger on
// close. There is no Escape/back dismissal on purpose - the same explicit-
// choice rule as the non-dismissing scrim.
import { onMounted, onUnmounted, ref } from 'vue';

defineProps<{
  headline: string;
  body: string;
}>();

const emit = defineEmits<{
  enable: [];
  dismiss: [];
}>();

const cardEl = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  cardEl.value?.focus();
});

onUnmounted(() => {
  // Only restore if the trigger is still in the document (a route change
  // could have removed it); focusing a detached node is a no-op anyway.
  if (previouslyFocused?.isConnected) {
    previouslyFocused.focus();
  }
});

// Wrap Tab within the card's focusable elements. With focus parked on the
// card itself, forward Tab reaches the buttons natively; this only closes
// the two wrap-around seams so focus never escapes to the inert screen.
function trapTab(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !cardEl.value) {
    return;
  }
  const focusables = [...cardEl.value.querySelectorAll<HTMLElement>('button')];
  if (focusables.length === 0) {
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === cardEl.value)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div class="notification-primer" @keydown="trapTab">
    <div
      ref="cardEl"
      class="notification-primer__card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notification-primer-headline"
      tabindex="-1"
    >
      <p class="notification-primer__eyebrow">Notifications</p>
      <h2 id="notification-primer-headline" class="notification-primer__headline">
        {{ headline }}
      </h2>
      <p class="notification-primer__body">{{ body }}</p>
      <div class="notification-primer__actions">
        <button type="button" class="notification-primer__dismiss" @click="emit('dismiss')">
          Not now
        </button>
        <button
          type="button"
          class="notification-primer__enable red-ghost-btn"
          @click="emit('enable')"
        >
          Enable
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notification-primer {
  position: fixed;
  inset: 0;
  z-index: var(--z-float);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--scrim);
  animation: notification-primer-in var(--motion-press) ease-out;
}

.notification-primer__card {
  width: 100%;
  padding: var(--space-6) var(--space-4) var(--space-4);
  background: var(--surface-raise);
  border: var(--rule) solid var(--border-strong);

  /* Programmatic focus receiver only (tabindex="-1"); the buttons carry
     the visible focus, so the container itself shows no ring. */
  outline: none;
}

.notification-primer__eyebrow {
  margin: 0 0 var(--space-3);
  color: var(--text-dim);
  font-size: var(--type-micro);
  letter-spacing: var(--tracking-4);
  text-transform: uppercase;
}

.notification-primer__headline {
  margin: 0 0 var(--space-3);
  color: var(--text);
  font-size: var(--type-data);
  font-weight: 700;
  letter-spacing: var(--tracking-05);
  text-transform: uppercase;
}

.notification-primer__body {
  margin: 0 0 var(--space-6);
  color: var(--text-soft);
  font-size: var(--type-body);
  line-height: var(--leading-notice);
}

.notification-primer__actions {
  display: flex;
  gap: var(--space-2);
}

.notification-primer__dismiss,
.notification-primer__enable {
  flex: 1;
  min-height: var(--tap-min);
  font-family: var(--font-mono);
  font-size: var(--type-micro);
  font-weight: 800;
  letter-spacing: var(--tracking-15);
  text-transform: uppercase;
  cursor: pointer;
}

.notification-primer__dismiss {
  color: var(--text-dim);
  background: transparent;
  border: var(--hairline) solid var(--border-strong);
  transition: color var(--motion-press);
}

/* Press feedback matching the accent Enable sibling (which flashes its
   background): the neutral dismiss brightens its label instead. */
.notification-primer__dismiss:active {
  color: var(--text);
}

@keyframes notification-primer-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-primer {
    animation: none;
  }
}
</style>
