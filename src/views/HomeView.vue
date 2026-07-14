<script setup lang="ts">
import { useRouter } from 'vue-router';

import AppShell from '@/components/AppShell.vue';
import MenuButton from '@/components/MenuButton.vue';
import OdinMark from '@/components/OdinMark.vue';

// Home screen. The lockup is exploration v3 direction 01 "Instrument
// Lockup" (task 01-08): the mark sits left of the ODIN wordmark on one
// axis, a hairline rule between them like a machined insignia plate.
// Red stays on the wordmark alone. Each flow epic adds its own menu
// button as its flow becomes walkable (BUILD CIRCUIT landed with task
// 02-02). AppShell owns background, grain, and scanlines.

const router = useRouter();

function openCircuits(): void {
  void router.push({ name: 'circuits' });
}
</script>

<template>
  <AppShell>
    <div class="home">
      <div class="home__brand">
        <div class="home__lockup">
          <OdinMark class="home__mark" />
          <h1 class="home__wordmark">ODIN</h1>
        </div>
        <p class="home__tagline">Workout Tracker // v0.1.0</p>
      </div>
      <nav class="home__menu">
        <MenuButton @click="openCircuits">Build Circuit</MenuButton>
      </nav>
    </div>
  </AppShell>
</template>

<style scoped>
.home {
  padding: var(--space-6) var(--space-4);
}

.home__brand {
  margin-top: var(--space-12);
}

.home__lockup {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

/* Square mark sized to the wordmark so the pair reads as one lockup and
   they scale together. */
.home__mark {
  flex: none;
  width: var(--type-display-wordmark);
  height: var(--type-display-wordmark);
}

.home__wordmark {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--accent);
  font-family: var(--font-display);
  font-size: var(--type-display-wordmark);
  line-height: 0.82;
  letter-spacing: var(--tracking-3);
  text-shadow: var(--glow-display-accent);
  border-left: var(--hairline) solid var(--border-strong);
}

.home__tagline {
  margin: var(--space-3) 0 0;
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-3);
  text-transform: uppercase;
}

/* Ref rhythm: roomy brand-to-menu gap, tight 8px stack between rows. */
.home__menu {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-12);
}
</style>
