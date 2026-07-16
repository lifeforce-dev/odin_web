import type { Router } from 'vue-router';

import { minimizeApp, onHardwareBackButton } from '@/native';

// The Android hardware back button pops router history (workbench ->
// circuits -> home); at the root there is nothing left to pop, so the
// app minimizes instead of exiting dead.
export async function installHardwareBack(router: Router): Promise<void> {
  await onHardwareBackButton((canGoBack) => {
    if (canGoBack) {
      router.back();
      return;
    }
    minimizeApp().catch((error: unknown) => console.error('[odin] minimize failed', error));
  });
}
