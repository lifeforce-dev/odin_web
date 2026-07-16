// The adapter surface: everything the app consumes from the native
// bridge goes through here (enforced by .dependency-cruiser.json).
export { closeDatabase, getDb, initDatabase, NativeOnlyError } from './database';
export { minimizeApp, onHardwareBackButton } from './lifecycle';
export { isNative } from './platform';
export { getPreference, setPreference } from './preferences';
