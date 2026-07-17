import { ref } from 'vue';
import type { Ref } from 'vue';

import type { DbClient } from '@/db/client';
import { arriveAtRest, finishSession, updateRestLog } from '@/domain/workout';
import type { RestArrival } from '@/domain/workout';

import { useScreenLoad } from './useScreenLoad';
import type { ScreenLoad } from './useScreenLoad';

// The rest screen's driver: the arrival auto-log read, the edit queue,
// and the FINISH write. Navigation itself stays in the view (same split
// as useActiveSession).
export interface RestSession extends ScreenLoad {
  arrival: Ref<RestArrival | null>;
  writeFailed: Ref<boolean>;
  finishFailed: Ref<boolean>;
  commitEdit: (reps: number, weight: number) => Promise<void>;
  flushPendingWrites: () => Promise<boolean>;
  finish: () => Promise<boolean>;
}

export function useRestSession(
  db: DbClient | null,
  exerciseId: () => string,
  setIndex: () => number,
): RestSession {
  const arrival = ref<RestArrival | null>(null);
  const writeFailed = ref(false);
  const finishFailed = ref(false);

  const screenLoad = useScreenLoad('rest', async () => {
    if (!db) {
      return;
    }
    arrival.value = await arriveAtRest(db, exerciseId(), setIndex());
  });

  // Every screen mutation - an edit, a retry re-read, OR the FINISH
  // write - rides ONE chain, in call order: the shared connection runs
  // one transaction at a time, so any of these racing another must
  // queue behind it rather than open a second BEGIN (the useWorkbench
  // enqueue precedent, scoped down to this screen's one row + session).
  // Edits carry payloads, so this is a serialized queue, not
  // useCoalescedWrite - join semantics would silently drop a second
  // tap's value.
  let writeChain: Promise<void> = Promise.resolve();

  function enqueue(operation: () => Promise<void>): Promise<void> {
    writeChain = writeChain.then(operation);
    return writeChain;
  }

  // The one legitimate mutation of an auto-logged row: a pre-advance
  // correction. A vanished row or a thrown write surfaces as a note on
  // the glass and re-derives the facts (the DB is the truth) rather
  // than guessing, the same shape a failed rest-start write uses on
  // the lift screen.
  function commitEdit(reps: number, weight: number): Promise<void> {
    const target = arrival.value;
    if (!db || !target) {
      return Promise.resolve();
    }
    return enqueue(async () => {
      try {
        const ok = await updateRestLog(db, target.setLogId, { reps, weight });
        if (!ok) {
          throw new Error(`set_log ${target.setLogId} vanished under a live edit`);
        }
        writeFailed.value = false;
      } catch (error) {
        console.error('[odin] rest log edit failed', error);
        writeFailed.value = true;
        // Already running ON the chain: enqueueing a refresh here would
        // await a tail that is itself waiting on this very op - deadlock.
        await screenLoad.refresh();
      }
    });
  }

  // Reports THIS flush's outcome. Resetting the flag first is
  // deliberate: a stale writeFailed from an earlier failed edit (whose
  // catch already re-derived the wells to DB truth) must not soft-lock
  // a later, clean advance.
  async function flushPendingWrites(): Promise<boolean> {
    writeFailed.value = false;
    await writeChain;
    return !writeFailed.value;
  }

  function finish(): Promise<boolean> {
    const target = arrival.value;
    if (!db || !target) {
      return Promise.resolve(false);
    }
    let finished = false;
    return enqueue(async () => {
      try {
        const result = await finishSession(db, target.sessionId);
        finished = result !== null;
        finishFailed.value = false;
        if (!result) {
          // Already ended elsewhere (a race, or a stale re-tap): the DB
          // is the truth, re-derive rather than guess. Already running
          // ON the chain, same deadlock trap as commitEdit's catch above.
          await screenLoad.refresh();
        }
      } catch (error) {
        console.error('[odin] finish session failed', error);
        finishFailed.value = true;
      }
    }).then(() => finished);
  }

  // Retry rides the same serialized chain as every other write: a bare
  // screenLoad.refresh() here could race a queued edit into a second
  // BEGIN.
  function refresh(): Promise<void> {
    return enqueue(() => screenLoad.refresh());
  }

  return {
    ...screenLoad,
    refresh,
    arrival,
    writeFailed,
    finishFailed,
    commitEdit,
    flushPendingWrites,
    finish,
  };
}
