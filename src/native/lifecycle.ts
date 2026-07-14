// Adapter over @capacitor/app (bridge isolation: the plugin is imported
// nowhere else). Owns the Android hardware back button; pause/resume
// listeners join here when the timer flows (epics 03/04) need them.
import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

import { isNative } from './platform';

let backButtonListener: PluginListenerHandle | undefined;

// Registering any 'backButton' listener disables Capacitor's default
// Android back behavior, so the handler owns the whole decision.
// canGoBack is the WebView history's position-aware flag: false only at
// the bottom of the stack. The event never fires on iOS (no hardware
// back) and registration is skipped in the browser, where the browser's
// own back control already drives history.
export async function onHardwareBackButton(handler: (canGoBack: boolean) => void): Promise<void> {
  if (!isNative) {
    return;
  }
  // Re-registration replaces the previous listener. Note the bridge
  // itself clears all native listeners on every page load (Android
  // Bridge.reset() runs removeAllListeners() in onPageStarted), so a
  // dev reload can never double-fire; this guard only covers repeated
  // in-context registration.
  await backButtonListener?.remove();
  backButtonListener = await App.addListener('backButton', (event) => {
    handler(event.canGoBack);
  });
}

// Android-only in the plugin, and only reachable from the back handler,
// which itself only fires on Android. A stray web call rejects loudly
// with the plugin's own unimplemented error; no silent gate here.
export async function minimizeApp(): Promise<void> {
  await App.minimizeApp();
}
