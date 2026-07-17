import type { Router } from 'vue-router';

import { onHardwareBackButton } from '@/native';

import { goUp } from './up';

// The Android hardware back button follows the same structural map as
// every on-screen up affordance - canGoBack is ignored outright, since
// history semantics are dead and the map is the only authority.
export async function installHardwareBack(router: Router): Promise<void> {
  await onHardwareBackButton(() => {
    goUp(router);
  });
}
