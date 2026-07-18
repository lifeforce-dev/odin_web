// Adapter over @capacitor/local-notifications (bridge isolation: the
// plugin is imported nowhere else). Deliberately feature-agnostic - it
// knows how to ask for permission and how to schedule/cancel absolute-
// time notifications, nothing about rest or stretch. The rest timer
// (03-04) schedules one informational alert; the stretch chain (ODI-24)
// schedules a whole sequence with Next/Skip action buttons through the
// SAME surface, which is why registerActionTypes/onNotificationAction
// live here now even though rest's tap-to-open needs neither.
import { LocalNotifications } from '@capacitor/local-notifications';
import type { PermissionState, PluginListenerHandle } from '@capacitor/core';

import { isAndroid, isNative } from './platform';

// Android 8+ posts every notification to a channel; without one at HIGH
// importance the OS shows the alert silently in the status bar with no
// heads-up banner and no sound. One channel serves rest AND stretch (the
// adapter is feature-agnostic), created once at startup via
// ensureNotificationChannel. importance 4 = HIGH (heads-up + sound),
// visibility 1 = PUBLIC (full content on the lock screen). iOS has no
// channels (createChannel is unimplemented there) and the browser has no
// OS surface, so the whole thing is Android-only; channelId is still set
// on every notification and simply ignored off Android.
const TIMER_CHANNEL_ID = 'odin-timers';

export type NotificationPermission = 'granted' | 'denied' | 'prompt';

export interface OdinNotification {
  // Caller-owned id; collisions cancel/replace, so features partition the
  // id space between them (see rest-alarm's REST_NOTIFICATION_ID).
  id: number;
  title: string;
  body: string;
  fireAt: Date;
  // A registered action-group id for notifications that carry buttons
  // (the stretch chain's Next/Skip). Omitted for informational alerts
  // like rest, whose only interaction is a tap that brings the app forward.
  actionTypeId?: string;
  // Routing payload echoed back to onNotificationAction on tap/action.
  extra?: Record<string, unknown>;
}

export interface NotificationAction {
  // 'tap' for a plain body tap; otherwise a registered action id.
  actionId: string;
  notificationId: number;
  extra: Record<string, unknown> | undefined;
}

export interface NotificationActionType {
  id: string;
  actions: { id: string; title: string }[];
}

let warnedUnavailable = false;

// A browser dev session has no OS notification service. Every mutating
// call degrades visibly (one warn, then a no-op) rather than throwing -
// the in-app timer is the whole experience in dev, and a throw here
// would take the rest flow down with it. Consumers that only make sense
// on device (useRestAlarm) already gate on isNative up front.
function unavailable(): boolean {
  if (isNative) {
    return false;
  }
  if (!warnedUnavailable) {
    console.warn(
      '[odin] local notifications are unavailable in browser dev; scheduling is a no-op',
    );
    warnedUnavailable = true;
  }
  return true;
}

function normalizePermission(state: PermissionState): NotificationPermission {
  if (state === 'granted' || state === 'denied') {
    return state;
  }
  // 'prompt' and 'prompt-with-rationale' both mean "the OS will still ask".
  return 'prompt';
}

export async function checkNotificationPermission(): Promise<NotificationPermission> {
  if (!isNative) {
    return 'denied';
  }
  const { display } = await LocalNotifications.checkPermissions();
  return normalizePermission(display);
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNative) {
    return 'denied';
  }
  const { display } = await LocalNotifications.requestPermissions();
  return normalizePermission(display);
}

// The heads-up channel for timer alerts. Idempotent (Android's
// createNotificationChannel updates in place), so calling it once at
// startup is enough; a no-op off Android. Non-fatal for the caller - a
// missing channel only downgrades the alert to a silent status-bar entry.
export async function ensureNotificationChannel(): Promise<void> {
  if (!isAndroid) {
    return;
  }
  await LocalNotifications.createChannel({
    id: TIMER_CHANNEL_ID,
    name: 'Workout timers',
    description: 'Rest and stretch timer alerts',
    importance: 4,
    visibility: 1,
    vibration: true,
  });
}

export async function scheduleNotifications(notifications: OdinNotification[]): Promise<void> {
  if (unavailable() || notifications.length === 0) {
    return;
  }
  await LocalNotifications.schedule({
    notifications: notifications.map((notification) => ({
      id: notification.id,
      title: notification.title,
      body: notification.body,
      // allowWhileIdle punches through Doze so the alert fires on time
      // even after the phone has been locked and idle. Exact delivery
      // additionally needs the OS exact-alarm grant (manifest
      // SCHEDULE_EXACT_ALARM, user-grantable and denied by default on
      // Android 13+); without it the OS degrades this to inexact-but-idle,
      // i.e. possibly a little late, which is the accepted fallback.
      schedule: { at: notification.fireAt, allowWhileIdle: true },
      // The HIGH-importance channel is what makes the alert a heads-up
      // banner + sound rather than a silent status-bar entry (Android 8+).
      // Ignored on iOS.
      channelId: TIMER_CHANNEL_ID,
      actionTypeId: notification.actionTypeId,
      extra: notification.extra,
    })),
  });
}

export async function cancelNotifications(ids: number[]): Promise<void> {
  if (unavailable() || ids.length === 0) {
    return;
  }
  await LocalNotifications.cancel({ notifications: ids.map((id) => ({ id })) });
}

export async function getPendingNotificationIds(): Promise<number[]> {
  if (unavailable()) {
    return [];
  }
  const { notifications } = await LocalNotifications.getPending();
  return notifications.map((notification) => notification.id);
}

// The stretch chain's Next/Skip buttons: register their action group once
// at startup before scheduling any notification that references it.
export async function registerActionTypes(types: NotificationActionType[]): Promise<void> {
  if (unavailable() || types.length === 0) {
    return;
  }
  await LocalNotifications.registerActionTypes({ types });
}

// A single global tap/action listener (registered once at startup). Rest
// does not need one - a plain tap brings the singleTask activity forward
// and session-restore reopens the screen - but the stretch chain routes
// its lock-screen Next/Skip through here. Returns a disposer.
export async function onNotificationAction(
  handler: (action: NotificationAction) => void,
): Promise<() => void> {
  if (!isNative) {
    return () => {};
  }
  const listener: PluginListenerHandle = await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (event) => {
      handler({
        actionId: event.actionId,
        notificationId: event.notification.id,
        extra: event.notification.extra ?? undefined,
      });
    },
  );
  return () => void listener.remove();
}
