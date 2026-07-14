// The adapter surface: everything the app consumes from the native bridge
// goes through here (capacitor-builder bridge isolation rule).
export { closeDatabase, getDb, initDatabase, NativeOnlyError } from './database';
export { minimizeApp, onHardwareBackButton } from './lifecycle';
export { isNative } from './platform';
export { getPreference, setPreference } from './preferences';
