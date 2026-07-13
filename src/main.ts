import { createPinia } from 'pinia';
import { createApp } from 'vue';

// Fonts are bundled (offline-first: no runtime Google Fonts). Latin
// subsets only; the weights match what the design refs request.
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
import { initDatabase, isNative } from './native';
import router from './router';

async function bootstrap(): Promise<void> {
  if (isNative) {
    // Migrations must complete before any screen can query. A failure here
    // is fatal and must be loud: a silent black screen on device cost hours
    // during 01-02. Loud means on the glass too, not just in logcat - the
    // person holding the phone has no console.
    try {
      await initDatabase();
    } catch (error) {
      console.error('[odin] database init failed; the app cannot start', error);
      renderFatalError(error);
      throw error;
    }
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

  createApp(App).use(createPinia()).use(router).mount('#app');
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
