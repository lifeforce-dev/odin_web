<script setup lang="ts">
import AppShell from '@/components/AppShell.vue';

// Bare home screen (epic 01 capstone): brand block only, per
// design_reference/home.html. Menu buttons arrive with their flows in
// later epics. AppShell owns background, grain, and scanlines.
</script>

<template>
  <AppShell>
    <div class="home">
      <div class="home__brand">
        <h1 class="home__wordmark">ODIN</h1>
        <p class="home__tagline">Workout Tracker // v0.1.0</p>
      </div>
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

.home__wordmark {
  margin: 0;
  color: var(--accent);
  font-family: var(--font-display);
  font-size: var(--type-display-wordmark);
  line-height: 0.88;
  letter-spacing: 3px;
  text-shadow: var(--glow-display-accent);
}

.home__tagline {
  margin: var(--space-3) 0 0;
  color: var(--text-dim);
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}
</style>
