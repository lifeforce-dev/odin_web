import { Capacitor } from '@capacitor/core';

// The single platform gate: consumers ask the adapter layer, never
// Capacitor directly.
export const isNative = Capacitor.isNativePlatform();
