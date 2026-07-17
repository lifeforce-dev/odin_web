import { ref } from 'vue';
import type { Ref } from 'vue';

import type { DbClient } from '@/db/client';
import { arriveAtRest, finishSession, rollBackRest, updateRestLog } from '@/domain/workout';
import type { RestArrival } from '@/domain/workout';

import { useScreenLoad } from './useScreenLoad';
import type { ScreenLoad } from './useScreenLoad';

// A call's result vs the screen's standing state: 'clean' is an
// outcome only (nothing was undone, leave without announcing), never a
// state; 'idle' is the state before any rollback has run.
export type RollBackOutcome = 'rolled-back' | 'clean' | 'failed';
export type RollBackState = 'idle' | 'rolled-back' | 'failed';

// The rest screen's driver: the arrival auto-log read, the edit queue,
// the FINISH write, and the rollback that undoes the arrival outright.
// Navigation itself stays in the view (same split as useActiveSession).
export interface RestSession extends ScreenLoad {
  arrival: Ref<RestArrival | null>;
  writeFailed: Ref<boolean>;
  finishFailed: Ref<boolean>;
  rollbackState: Ref<RollBackState>;
  commitEdit: (reps: number, weight: number) => Promise<void>;
  flushPendingWrites: () => Promise<boolean>;
  finish: () => Promise<boolean>;
  rollBack: () => Promise<RollBackOutcome>;
}

export function useRestSession(
  db: DbClient | null,
  exerciseId: () => string,
  setIndex: () => number,
): RestSession {
  const arrival = ref<RestArrival | null>(null);
  const writeFailed = ref(false);
  const finishFailed = ref(false);

  // One machine, one carrier. Once 'rolled-back', the arrival row is
  // gone: every write this screen could still queue (a pending edit's
  // settle window, the teardown flush) must go inert instead of
  // resurrecting it via updateRestLog-miss -> refresh -> arriveAtRest.
  // Checked at both call time and inside the queued op: an edit
  // enqueued between the rollback call and its execution lands BEHIND
  // it on the chain. 'failed' renders the try-again note.
  const rollbackState = ref<RollBackState>('idle');

  const screenLoad = useScreenLoad('rest', async () => {
    if (!db) {
      return;
    }
    arrival.value = await arriveAtRest(db, exerciseId(), setIndex());
  });

  // Every screen mutation - an edit, a retry re-read, the FINISH write,
  // OR the rollback - rides ONE chain, in call order: the shared
  // connection runs one transaction at a time, so any of these racing
  // another must queue behind it rather than open a second BEGIN (the
  // useWorkbench enqueue precedent, scoped down to this screen's one
  // row + session). Edits carry payloads, so this is a serialized
  // queue, not useCoalescedWrite - join semantics would silently drop a
  // second tap's value.
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
    if (!db || !target || rollbackState.value === 'rolled-back') {
      return Promise.resolve();
    }
    return enqueue(async () => {
      if (rollbackState.value === 'rolled-back') {
        return;
      }
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
    if (!db || !target || rollbackState.value === 'rolled-back') {
      return Promise.resolve(false);
    }
    let finished = false;
    return enqueue(async () => {
      if (rollbackState.value === 'rolled-back') {
        return;
      }
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

  // Back on rest IS the rollback: deletes the arrival row outright so
  // the lift page re-derives the un-done set. The whole decision runs
  // ON the chain, and behind the settled load: the mount load's
  // arriveAtRest INSERT is the one write that does not ride the chain,
  // and a back press racing that window (the instant "oops, back out"
  // this feature exists for) must roll back the insert it raced, never
  // read a still-null arrival as "nothing to undo".
  function rollBack(): Promise<RollBackOutcome> {
    if (!db) {
      return Promise.resolve('clean');
    }
    let outcome: RollBackOutcome = 'clean';
    return enqueue(async () => {
      // A double-fired back press: nothing left to undo, and 'clean'
      // leaves without re-arming the one-shot notice a first landing
      // may already have consumed.
      if (rollbackState.value === 'rolled-back') {
        return;
      }
      await screenLoad.settled();
      const target = arrival.value;
      if (!target) {
        return;
      }
      try {
        // A false result means the row was already gone - the set is
        // un-logged either way, which is what the notice announces.
        await rollBackRest(db, target.setLogId);
        rollbackState.value = 'rolled-back';
        outcome = 'rolled-back';
      } catch (error) {
        console.error('[odin] rest rollback failed', error);
        rollbackState.value = 'failed';
        outcome = 'failed';
      }
    }).then(() => outcome);
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
    rollbackState,
    commitEdit,
    flushPendingWrites,
    finish,
    rollBack,
  };
}
