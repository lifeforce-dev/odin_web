// The adapter surface: everything the app consumes from the native
// bridge goes through here (enforced by .dependency-cruiser.json).
export { closeDatabase, getDb, initDatabase, NativeOnlyError } from './database';
export { minimizeApp, onAppStateChange, onHardwareBackButton } from './lifecycle';
export {
  cancelNotifications,
  checkNotificationPermission,
  ensureNotificationChannel,
  getPendingNotificationIds,
  onNotificationAction,
  registerActionTypes,
  requestNotificationPermission,
  scheduleNotifications,
} from './notifications';
export type {
  NotificationAction,
  NotificationActionType,
  NotificationPermission,
  OdinNotification,
} from './notifications';
export { hasSystemBack, isAndroid, isNative } from './platform';
export { getPreference, setPreference } from './preferences';
