import { ref } from 'vue';
import type { Ref } from 'vue';

import {
  checkNotificationPermission,
  getPreference,
  isNative,
  requestNotificationPermission,
  setPreference,
} from '@/native';

// The notification-permission gate and its in-app primer, singleton
// across the app (the App shell renders the one dialog). Feature-
// agnostic on purpose: the rest flow drives it with rest copy today,
// the stretch flow drives the same dialog with its own copy later. The
// contract: educate in our own voice ONCE, before the OS surface, and
// never nag - a dismissal or an OS denial is final.
export interface NotificationPrimerCopy {
  headline: string;
  body: string;
}

const PRIMER_SEEN_KEY = 'odin.notifications.primer-seen';

const visible = ref(false);
const copy = ref<NotificationPrimerCopy>({ headline: '', body: '' });

// Called on the first relevant user action (starting a rest). Shows the
// primer only when the OS will still ask AND the user has not already
// passed on it once.
export async function ensureNotificationPermission(
  primerCopy: NotificationPrimerCopy,
): Promise<void> {
  // Nothing to grant off-device, and re-entry while the dialog is up
  // would just re-stamp the same copy.
  if (!isNative || visible.value) {
    return;
  }
  const status = await checkNotificationPermission();
  // Granted: done. Denied: the OS will not re-prompt and the only lever
  // left is an app-settings trip - "denied = no nagging" wins.
  if (status !== 'prompt') {
    return;
  }
  // A once-ever education: someone who dismissed it, or was ejected to
  // the OS prompt and declined, is never asked again.
  if ((await getPreference(PRIMER_SEEN_KEY)) === 'true') {
    return;
  }
  copy.value = primerCopy;
  visible.value = true;
}

async function enable(): Promise<void> {
  visible.value = false;
  try {
    await setPreference(PRIMER_SEEN_KEY, 'true');
    // The OS prompt itself. Its result is read back by the next
    // checkNotificationPermission, never cached here - the OS setting is
    // the one source of truth and can change in system settings.
    await requestNotificationPermission();
  } catch (error) {
    // The dialog already closed optimistically; a failed KV write or OS
    // request must not surface as an unhandled rejection. Worst case the
    // seen-flag did not persist and the once-ever primer shows once more.
    console.error('[odin] enabling notifications failed', error);
  }
}

async function dismiss(): Promise<void> {
  visible.value = false;
  try {
    await setPreference(PRIMER_SEEN_KEY, 'true');
  } catch (error) {
    console.error('[odin] recording the primer dismissal failed', error);
  }
}

export function useNotificationPrimer(): {
  visible: Ref<boolean>;
  copy: Ref<NotificationPrimerCopy>;
  enable: () => Promise<void>;
  dismiss: () => Promise<void>;
} {
  return { visible, copy, enable, dismiss };
}
