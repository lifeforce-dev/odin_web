import { ref, watch } from 'vue';
import type { Ref } from 'vue';

import type { DbClient } from '@/db/client';
import { getWorkoutSet, startRest as startRestInDomain } from '@/domain/workout';
import type { RestEntry, WorkoutSet } from '@/domain/workout';

import { useCoalescedWrite } from './useCoalescedWrite';
import { useScreenLoad } from './useScreenLoad';
import type { ScreenLoad } from './useScreenLoad';

// The lift screen's driver: loads the workout-set facts for the routed
// exercise and runs the START REST / FINISH transition. Navigation
// stays with the view; this only owns the facts and the write.

export interface ActiveSession extends ScreenLoad {
  workoutSet: Ref<WorkoutSet | null>;
  restFailed: Ref<boolean>;
  startRest: () => Promise<RestEntry | null>;
}

export function useActiveSession(db: DbClient | null, exerciseId: () => string): ActiveSession {
  const workoutSet = ref<WorkoutSet | null>(null);

  const screenLoad = useScreenLoad('workout set', async () => {
    if (!db) {
      return;
    }
    workoutSet.value = await getWorkoutSet(db, exerciseId());
  });

  const rest = useCoalescedWrite('start rest', async () => {
    if (!db) {
      return null;
    }
    const entry = await startRestInDomain(db, exerciseId());
    if (!entry) {
      // A refusal means the screen is stale (the set is already
      // done, or the exercise left the circuit): re-derive the
      // facts instead of guessing.
      await screenLoad.refresh();
    }
    return entry;
  });

  // The view instance survives an in-place param change (vue-router
  // reuses it), so the facts must follow the route, not the mount.
  // The old exercise's facts and failure note are dropped up front:
  // stale values must never render against the new route, even for
  // the beat the re-read takes (or after it fails).
  watch(exerciseId, () => {
    workoutSet.value = null;
    rest.failed.value = false;
    void screenLoad.refresh();
  });

  return { ...screenLoad, workoutSet, restFailed: rest.failed, startRest: rest.run };
}
