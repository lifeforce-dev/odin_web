import { onMounted, onUnmounted, watch } from 'vue';

import { cancelNotifications, isNative, onAppStateChange, scheduleNotifications } from '@/native';

// The rest notification, scheduled so it survives the app being CLOSED,
// not just minimized. The OS alarm is registered the moment the rest is
// known (at start, while the app is alive) - NOT on background: a swipe-
// close kills the process before a background handler's async schedule
// call can finish, so background-scheduling silently drops the alarm.
// Scheduling up front sidesteps that race, and the plugin's static
// receiver fires the alert even after the process dies.
//
// Foreground stays silent without losing that: while the app is in front
// the live rest screen is the display, so a hair before endsAt we cancel
// the alarm - but ONLY while foreground (isForeground gated). Minimized,
// locked, or closed, that cancel never runs, so the OS alarm fires.
//
// Skip/extend support is free: it only changes endsAt in the foreground,
// and the watch below reschedules + re-arms from the new value.
//
// endsAt is the countdown-mode end (null in final mode or before the
// arrival read lands); null means there is nothing to alarm.

const REST_NOTIFICATION_ID = 1;

// Cancel the foreground banner this many ms before endsAt: comfortably
// beats the OS alarm so someone watching the screen never sees a redundant
// banner. The only cost is that backgrounding in the final second (when
// the countdown is already visibly at zero) skips the notification.
const SUPPRESS_LEAD_MS = 1000;

const REST_ALERT = {
  title: 'Rest complete',
  body: 'Time for your next set.',
} as const;

// The rest flow's value case for the shared permission primer, shown on
// the first Start Rest (the stretch flow will pass its own copy to the
// same dialog).
export const REST_PRIMER_COPY = {
  headline: 'Know when rest is over',
  body: 'Odin can alert you the moment your rest timer hits zero, even with your phone locked or the app closed.',
} as const;

function scheduleRestAlarm(endsAtIso: string): void {
  const fireAt = new Date(endsAtIso);
  if (fireAt.getTime() <= Date.now()) {
    // A past/near-past endsAt (a skip/extend that shortened rest
    // below the elapsed time) can't be a future alarm: clear any still-
    // pending one instead of leaving the old future alarm to fire late.
    cancelRestAlarm();
    return;
  }
  void scheduleNotifications([
    { id: REST_NOTIFICATION_ID, title: REST_ALERT.title, body: REST_ALERT.body, fireAt },
  ]).catch((error: unknown) => {
    console.error('[odin] scheduling the rest notification failed', error);
  });
}

function cancelRestAlarm(): void {
  void cancelNotifications([REST_NOTIFICATION_ID]).catch((error: unknown) => {
    console.error('[odin] cancelling the rest notification failed', error);
  });
}

export function useRestAlarm(endsAt: () => string | null): void {
  // Browser dev has no session and no OS notifications - the whole policy
  // is a device concern, so it stays dormant off-device.
  if (!isNative) {
    return;
  }

  // The rest screen is only ever mounted in the foreground (a fresh tap or
  // a cold-open restore), so foreground is the correct start; the app-state
  // listener corrects it from there.
  let isForeground = true;
  let suppressTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeAppState: (() => void) | undefined;
  let disposed = false;

  function clearSuppress(): void {
    if (suppressTimer !== undefined) {
      clearTimeout(suppressTimer);
      suppressTimer = undefined;
    }
  }

  function syncSchedule(): void {
    const endsAtIso = endsAt();
    if (endsAtIso !== null) {
      scheduleRestAlarm(endsAtIso);
    } else {
      cancelRestAlarm();
    }
  }

  // Re-armed from the wall clock each time (mount, endsAt change, return to
  // foreground) so a frozen-then-resumed timer can never drift.
  function armSuppress(): void {
    clearSuppress();
    const endsAtIso = endsAt();
    if (endsAtIso === null) {
      return;
    }
    const lead = new Date(endsAtIso).getTime() - SUPPRESS_LEAD_MS - Date.now();
    if (lead <= 0) {
      // Already inside the lead window: if we are the foreground display,
      // there is nothing left for the OS alarm to announce.
      if (isForeground) {
        cancelRestAlarm();
      }
      return;
    }
    suppressTimer = setTimeout(() => {
      suppressTimer = undefined;
      if (isForeground) {
        cancelRestAlarm();
      }
    }, lead);
  }

  // The alarm follows endsAt (scheduled at start, rescheduled on skip/
  // extend); immediate so the first non-null value schedules right away.
  watch(
    endsAt,
    () => {
      syncSchedule();
      armSuppress();
    },
    { immediate: true },
  );

  onMounted(async () => {
    // onAppStateChange awaits a bridge roundtrip; a fast unmount (tap-
    // through, immediate rollback) can run onUnmounted before it resolves.
    // If so, dispose the just-registered listener at once rather than
    // storing it - an orphaned handler would keep firing and could cancel
    // a LATER rest's alarm through the shared REST_NOTIFICATION_ID.
    const dispose = await onAppStateChange((active) => {
      isForeground = active;
      if (active) {
        // Back in front: re-arm the foreground suppression from the clock.
        armSuppress();
      } else {
        // Backgrounded: drop the suppression so the alarm reaches the OS.
        // The alarm itself stays scheduled (from start).
        clearSuppress();
      }
    });
    if (disposed) {
      dispose();
      return;
    }
    disposeAppState = dispose;
  });

  // Leaving the rest screen (advance, finish, rollback) ends the alarm's
  // reason to exist.
  onUnmounted(() => {
    disposed = true;
    disposeAppState?.();
    clearSuppress();
    cancelRestAlarm();
  });
}
