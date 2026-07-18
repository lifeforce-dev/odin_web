import type { Router } from 'vue-router';

import { useNotificationPrimer } from '@/composables/useNotificationPermission';
import { onHardwareBackButton } from '@/native';

import { goUp } from './up';

// The Android hardware back button follows the same structural map as
// every on-screen up affordance - canGoBack is ignored outright, since
// history semantics are dead and the map is the only authority.
export async function installHardwareBack(router: Router): Promise<void> {
  const { visible: primerVisible } = useNotificationPrimer();
  await onHardwareBackButton(() => {
    // A visible global modal owns the back gesture. The permission primer
    // requires an explicit Enable/Not now choice - its scrim deliberately
    // never dismisses - so back is a no-op while it is up rather than
    // running the screen's up handler, which on the rest screen is a
    // DESTRUCTIVE rollback sitting behind the still-visible primer. (Today
    // the primer is the app's only global modal; a second one would
    // generalize this into a modal-stack check.)
    if (primerVisible.value) {
      return;
    }
    goUp(router);
  });
}
