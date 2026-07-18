import { createPinia } from 'pinia';
import { createApp } from 'vue';

// Fonts are bundled (offline-first: no runtime Google Fonts). Latin
// subsets only, in exactly the weights the UI uses.
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/jetbrains-mono/latin-800.css';

import './styles/structure.css';
import './styles/base.css';
import './styles/themes/odin-dark.css';

import App from './App.vue';
import { initTheme } from './composables/useTheme';
import { ensureNotificationChannel, initDatabase, isNative } from './native';
import router from './router';
import { installHardwareBack } from './router/hardware-back';
import { restoreWhereLeftOff } from './router/restore';

async function bootstrap(): Promise<void> {
  if (isNative) {
    // Migrations must complete before any screen can query. A failure
    // here is fatal and must be loud on the glass, not just in the
    // log: the person holding the phone has no console.
    try {
      await initDatabase();
    } catch (error) {
      console.error('[odin] database init failed; the app cannot start', error);
      renderFatalError(error);
      throw error;
    }
    // The heads-up channel for timer alerts (Android 8+; no-op on iOS).
    // Non-fatal: a missing channel only downgrades the rest/stretch alert
    // to a silent status-bar entry, so it must never block startup.
    await ensureNotificationChannel().catch((error: unknown) => {
      console.error('[odin] notification channel setup failed', error);
    });
  } else {
    console.warn(
      '[odin] browser dev mode: on-device SQLite is unavailable; data features are disabled',
    );
  }
  // initTheme never rejects (a failed preference read keeps the static
  // default from index.html). Awaiting it is a deliberate tradeoff: a
  // persisted non-default theme renders without a flash, at the cost of
  // mount waiting on one KV read.
  await initTheme();

  const app = createApp(App).use(createPinia()).use(router);

  // Open-where-left (src/router/restore.ts) runs BEFORE the first paint:
  // router.isReady() resolves the initial '/' navigation, then restore
  // replaces to an in-flight session's implied screen (the rest screen
  // mid-rest), so the app opens directly there instead of flashing home
  // first. Still an enhancement, never a boot blocker - awaited under a
  // catch so a failed or slow restore just leaves the app at home, which
  // is always a safe landing.
  await router.isReady();
  await restoreWhereLeftOff(router).catch((error: unknown) => {
    console.error('[odin] session restore failed', error);
  });

  app.mount('#app');

  // Android hardware back: follow the structural up-map, minimize at
  // the root (src/router/hardware-back.ts). An enhancement, not a boot
  // dependency - a registration failure must never block mount, so it
  // is not awaited.
  void installHardwareBack(router).catch((error: unknown) => {
    console.error('[odin] hardware back registration failed', error);
  });
}

// Plain DOM on purpose: this runs when startup already failed, so it must
// not depend on Vue mounting or on any stylesheet having loaded.
function renderFatalError(error: unknown): void {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  const container = document.createElement('div');
  container.style.cssText = 'padding:24px;font-family:monospace;color:#ff5050;background:#090909;';

  const title = document.createElement('h1');
  title.style.cssText = 'font-size:18px;margin:0 0 12px;';
  title.textContent = 'ODIN failed to start';

  const detail = document.createElement('pre');
  detail.style.cssText = 'white-space:pre-wrap;font-size:12px;color:#e8e8e8;margin:0;';
  detail.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  container.append(title, detail);
  root.replaceChildren(container);
}

void bootstrap();
