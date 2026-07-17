import { Capacitor } from '@capacitor/core';

// The single platform gate: consumers ask the adapter layer, never
// Capacitor directly.
export const isNative = Capacitor.isNativePlatform();

// Android is the only platform with a system back affordance; iOS and
// the browser both need the on-screen NavUpRow instead.
export const hasSystemBack = Capacitor.getPlatform() === 'android';
