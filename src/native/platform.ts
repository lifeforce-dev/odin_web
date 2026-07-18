import { Capacitor } from '@capacitor/core';

// The single platform gate: consumers ask the adapter layer, never
// Capacitor directly.
export const isNative = Capacitor.isNativePlatform();

// Android is the only platform with a system back affordance; iOS and
// the browser both need the on-screen NavUpRow instead.
export const hasSystemBack = Capacitor.getPlatform() === 'android';

// Notification channels are an Android 8+ concept: iOS has none (the
// plugin's createChannel is unimplemented there) and the browser has no
// OS surface, so channel setup gates on this.
export const isAndroid = Capacitor.getPlatform() === 'android';
