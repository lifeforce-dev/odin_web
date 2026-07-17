import type { Router } from 'vue-router';

import { getResumePoint } from '@/domain/workout';
import { getDb, isNative } from '@/native';

// Open-where-left: a cold open with an in-flight session lands on the
// screen the session facts imply (domain/workout.ts getResumePoint) -
// the rest screen mid-rest (including an expired rest sitting at
// 0:00), else the exercise grid. There is no resume modal, ever:
// closing the app is never abandoning. replace() keeps home out of a
// back-tap away only in history terms - the structural up-map still
// walks rest -> lift -> grid -> home. Fires only when the app opened
// AT home: a dev-browser deep link (or any future deep link) is an
// explicit destination the restore must not hijack.
export async function restoreWhereLeftOff(router: Router): Promise<void> {
  // Adapter accessors, not useDb(): this runs at boot, outside any
  // component setup (the precedent hardware-back.ts sets for
  // router-layer code).
  if (!isNative) {
    return;
  }
  const db = getDb();
  await router.isReady();
  if (router.currentRoute.value.name !== 'home') {
    return;
  }
  const point = await getResumePoint(db);
  if (!point) {
    return;
  }
  // Re-checked after the await: a tap landing inside the read window is
  // an explicit destination, and the never-hijack rule outranks the
  // restore no matter when the navigation happens.
  if (router.currentRoute.value.name !== 'home') {
    return;
  }
  if (point.screen === 'rest') {
    await router.replace({
      name: 'rest',
      params: { exerciseId: point.exerciseId, setIndex: point.setIndex },
    });
    return;
  }
  await router.replace({ name: 'workout-start' });
}
