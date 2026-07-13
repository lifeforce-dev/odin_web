import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
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
