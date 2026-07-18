// Adapter over @capacitor/app (bridge isolation: the plugin is imported
// nowhere else). Owns the Android hardware back button.
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

// Android-only in the plugin. Callers gate on isNative only (goUp's
// no-up branch), so an iOS call is reachable and rejects loudly with
// the plugin's own unimplemented error, same as a stray web call; no
// silent gate here.
export async function minimizeApp(): Promise<void> {
  await App.minimizeApp();
}

// Foreground/background transitions (isActive true = foreground). Unlike
// the singleton back handler, this returns a disposer: the rest alarm is
// inherently screen-scoped (it only matters while a rest is on the
// glass), so its consumer adds the listener on mount and removes it on
// unmount rather than owning a permanent one. No-ops in the browser,
// where nothing schedules OS notifications; the disposer stays callable.
export async function onAppStateChange(handler: (isActive: boolean) => void): Promise<() => void> {
  if (!isNative) {
    return () => {};
  }
  const listener = await App.addListener('appStateChange', ({ isActive }) => {
    handler(isActive);
  });
  return () => void listener.remove();
}
