import { Capacitor } from '@capacitor/core';

// The single platform gate (capacitor-builder web/native split): consumers
// ask the adapter layer, never Capacitor directly.
export const isNative = Capacitor.isNativePlatform();
