<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import AppShell from '@/components/AppShell.vue';
import OdinMark from '@/components/OdinMark.vue';
import { useTheme } from '@/composables/useTheme';
import { CONTRACT_COLOR_TOKENS, type ThemeName } from '@/styles/contract';

// The living component gallery + token board (epic 01 task 5): every
// token rendered live so a theme can be judged on one screen, on device
// (task 01-06 checks this board on glass). Component states get added
// here as real components land in later epics.

const { theme, themes, setTheme } = useTheme();

const selectedTheme = computed({
  get: () => theme.value,
  set: (name: ThemeName) => {
    void setTheme(name);
  },
});

// The color board renders straight from the contract, so a token added
// there appears here automatically. Fonts/textures/glows each need a
// bespoke sample (a glow is not a swatch) and geometry tokens have no TS
// source, so those lists are curated here; completeness of the contract
// itself is check:themes' job.
const colorTokens = CONTRACT_COLOR_TOKENS;

const monoTypeTokens = [
  '--type-micro',
  '--type-label',
  '--type-body',
  '--type-data',
  '--type-data-lg',
  '--type-data-xl',
];

const displayTypeTokens = ['--type-display-title', '--type-display-wordmark'];

const trackingTokens = ['--tracking-1', '--tracking-2', '--tracking-3'];

const spacingTokens = [
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-6',
  '--space-8',
  '--space-12',
];

const borderTokens = ['--hairline', '--rule', '--stamp'];

// env() values only resolve when applied to a property, so each token is
// measured through a hidden probe element.
const safeAreaReadout = ref<Array<{ token: string; resolved: string }>>([]);

onMounted(() => {
  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.append(probe);
  safeAreaReadout.value = ['--safe-top', '--safe-bottom', '--safe-left', '--safe-right'].map(
    (token) => {
      probe.style.width = `var(${token})`;
      return { token, resolved: getComputedStyle(probe).width };
    },
  );
  probe.remove();
});
</script>

<template>
  <AppShell>
    <template #header>
      <div class="gallery-header">
        <h1 class="gallery-title">Gallery</h1>
        <label class="theme-picker">
          <span class="theme-picker__label">Theme</span>
          <select v-model="selectedTheme" class="theme-picker__select">
            <option v-for="name in themes" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
      </div>
    </template>

    <div class="board">
      <section class="board-section">
        <h2 class="board-eyebrow">Brand mark</h2>
        <div class="brand-sample">
          <OdinMark class="brand-sample__mark" />
          <h3 class="brand-sample__word">ODIN</h3>
        </div>
        <div class="brand-scales">
          <OdinMark class="brand-scales__mark brand-scales__mark--nav" />
          <OdinMark class="brand-scales__mark brand-scales__mark--solo" />
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Color roles</h2>
        <div class="swatch-grid">
          <div v-for="token in colorTokens" :key="token" class="swatch">
            <div class="swatch__fill" :style="{ background: `var(${token})` }"></div>
            <span class="swatch__name">{{ token }}</span>
          </div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Type / mono tier</h2>
        <p
          v-for="token in monoTypeTokens"
          :key="token"
          class="type-sample"
          :style="{ fontSize: `var(${token})` }"
        >
          {{ token }} // REDLINE HUD 0123456789
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Type / display tier</h2>
        <p
          v-for="token in displayTypeTokens"
          :key="token"
          class="type-sample type-sample--display"
          :style="{ fontSize: `var(${token})` }"
        >
          ODIN
        </p>
        <p class="board-note">--type-display-hero (countdown scale):</p>
        <p class="type-sample type-sample--display type-sample--hero">1:32</p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Tracking ramp</h2>
        <p
          v-for="token in trackingTokens"
          :key="token"
          class="type-sample"
          :style="{ letterSpacing: `var(${token})` }"
        >
          {{ token }} // REDLINE HUD
        </p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Spacing scale</h2>
        <div v-for="token in spacingTokens" :key="token" class="spacing-row">
          <span class="spacing-row__name">{{ token }}</span>
          <div class="spacing-row__bar" :style="{ width: `var(${token})` }"></div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Border weights</h2>
        <div v-for="token in borderTokens" :key="token" class="border-row">
          <span class="border-row__name">{{ token }}</span>
          <div class="border-row__line" :style="{ borderTopWidth: `var(${token})` }"></div>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Tap target floor</h2>
        <div class="tap-target">
          <span class="tap-target__label">--tap-min</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Textures</h2>
        <div class="texture-sample texture-sample--grain">
          <span class="texture-sample__name">--texture-grain @ --texture-grain-size</span>
        </div>
        <div class="texture-sample texture-sample--scanline">
          <span class="texture-sample__name">--texture-scanline</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Glow recipes</h2>
        <div class="glow-cta-sample">--glow-cta</div>
        <p class="glow-display-sample">--glow-display-accent</p>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Safe areas (live)</h2>
        <div v-for="entry in safeAreaReadout" :key="entry.token" class="safe-row">
          <span class="safe-row__name">{{ entry.token }}</span>
          <span class="safe-row__value">{{ entry.resolved }}</span>
        </div>
      </section>

      <section class="board-section">
        <h2 class="board-eyebrow">Components</h2>
        <p class="board-note">
          Component states appear here as real components land (epic 02 onward).
        </p>
      </section>
    </div>

    <template #action>
      <div class="gallery-action">
        <button type="button" class="gallery-cta">Primary CTA</button>
      </div>
    </template>
  </AppShell>
</template>

<style scoped>
.gallery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  border-bottom: var(--hairline) solid var(--border);
}

.gallery-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-display-title);
  font-weight: 400;
  line-height: 1;
  letter-spacing: var(--tracking-2);
  color: var(--text);
  text-transform: uppercase;
}

.theme-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.theme-picker__label {
  font-size: var(--type-label);
  letter-spacing: var(--tracking-3);
  color: var(--text-dim);
  text-transform: uppercase;
}

.theme-picker__select {
  min-height: var(--tap-min);
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-mono);
  font-size: var(--type-body);
  color: var(--text);
  background: var(--surface);
  border: var(--rule) solid var(--border);
}

.board {
  display: grid;
  gap: var(--space-8);
  padding: var(--space-4);
}

.board-section {
  display: grid;
  gap: var(--space-3);
}

.board-eyebrow {
  margin: 0;
  font-size: var(--type-label);
  font-weight: 700;
  letter-spacing: var(--tracking-3);
  color: var(--text-dim);
  text-transform: uppercase;
}

.board-note {
  margin: 0;
  font-size: var(--type-body);
  color: var(--text-soft);
}

.brand-sample {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.brand-sample__mark {
  flex: none;
  width: var(--type-display-wordmark);
  height: var(--type-display-wordmark);
}

.brand-sample__word {
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

.brand-scales {
  display: flex;
  align-items: center;
  gap: var(--space-6);
}

.brand-scales__mark {
  flex: none;
}

.brand-scales__mark--nav {
  width: var(--space-8);
  height: var(--space-8);
}

.brand-scales__mark--solo {
  width: var(--space-12);
  height: var(--space-12);
}

.swatch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: var(--space-2);
}

.swatch {
  display: grid;
  gap: var(--space-1);
}

.swatch__fill {
  height: var(--space-12);
  border: var(--hairline) solid var(--border);
}

.swatch__name {
  font-size: var(--type-micro);
  color: var(--text-soft);
  word-break: break-all;
}

.type-sample {
  margin: 0;
  color: var(--text);
  overflow-wrap: anywhere;
}

.type-sample--display {
  font-family: var(--font-display);
  line-height: 1;
  letter-spacing: var(--tracking-2);
}

.type-sample--hero {
  font-size: var(--type-display-hero);
  font-variant-numeric: tabular-nums;
}

.spacing-row,
.border-row,
.safe-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.spacing-row__name,
.border-row__name,
.safe-row__name {
  flex: none;
  width: var(--space-12);
  min-width: fit-content;
  font-size: var(--type-micro);
  color: var(--text-soft);
}

.spacing-row__bar {
  height: var(--space-2);
  background: var(--accent);
}

.border-row__line {
  flex: 1;
  border-top: 0 solid var(--border-strong);
}

.tap-target {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-min);
  height: var(--tap-min);
  border: var(--hairline) dashed var(--border-strong);
}

.tap-target__label {
  font-size: var(--type-micro);
  color: var(--text-dim);
}

.texture-sample {
  display: flex;
  align-items: flex-end;
  height: var(--space-12);
  padding: var(--space-1);
  background-color: var(--surface);
  border: var(--hairline) solid var(--border);
}

.texture-sample--grain {
  background-image: var(--texture-grain);
  background-size: var(--texture-grain-size);
}

.texture-sample--scanline {
  background-image: var(--texture-scanline);
}

.texture-sample__name {
  font-size: var(--type-micro);
  color: var(--text-soft);
}

.glow-cta-sample {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap-min);
  font-size: var(--type-data);
  letter-spacing: var(--tracking-2);
  color: var(--accent);
  text-transform: uppercase;
  background: var(--accent-soft);
  border: var(--rule) solid var(--accent);
  box-shadow: var(--glow-cta);
}

.glow-display-sample {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--type-display-wordmark);
  line-height: 1;
  color: var(--accent);
  text-shadow: var(--glow-display-accent);
  text-transform: uppercase;
}

.safe-row__value {
  font-size: var(--type-body);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.gallery-action {
  padding: var(--space-3) var(--space-4);
  border-top: var(--hairline) solid var(--border);
}

/* The STYLEGUIDE section 5 primary CTA recipe (game-UI interaction reset
   comes from base.css button wiring). */
.gallery-cta {
  width: 100%;
  min-height: var(--tap-min);
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-mono);
  font-size: var(--type-data-lg);
  font-weight: 700;
  letter-spacing: var(--tracking-2);
  color: var(--accent);
  text-transform: uppercase;
  cursor: pointer;
  background: var(--accent-soft);
  border: var(--rule) solid var(--accent);
  box-shadow: var(--glow-cta);
}

.gallery-cta:active {
  color: var(--accent-deep);
  border-color: var(--accent-deep);
}
</style>
