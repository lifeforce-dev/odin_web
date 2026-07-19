import { flushPromises, mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import type { ExerciseRow } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  setPrescription,
} from '@/domain/builder';
import { consumeRollbackNotice, resetRollbackNotice } from '@/composables/useRollbackNotice';
import { firePointer } from '@/test-utils/pointer-events';

import RestView from './RestView.vue';

// Integration over the real DB double, mirroring WorkoutSetView.test.ts's
// seam-mocking pattern: the arrival auto-log, the timer render states,
// the edit write-behind, and the NEXT SET / FINISH routing are view
// wiring the domain and composable-unit tests cannot see on their own.

const nativeState: { isNative: boolean; hasSystemBack: boolean; db: DbClient | null } = {
  isNative: true,
  hasSystemBack: false,
  db: null,
};

// useRestAlarm's seam: onMounted registers an app-state listener and
// schedules/cancels the OS rest alert. useRestAlarm.test.ts owns the alarm
// state machine; here the schedule mock is asserted for ONE thing - that
// RestView hands useRestAlarm the countdown getter, not the adjacent
// rollback-window computed (which is non-null in final mode and would
// schedule a spurious alert on FINISH screens).
const alarmMocks = vi.hoisted(() => ({
  onAppStateChange: vi.fn().mockResolvedValue(() => {}),
  scheduleNotifications: vi.fn().mockResolvedValue(undefined),
  cancelNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  get hasSystemBack() {
    return nativeState.hasSystemBack;
  },
  minimizeApp: vi.fn().mockResolvedValue(undefined),
  onAppStateChange: alarmMocks.onAppStateChange,
  scheduleNotifications: alarmMocks.scheduleNotifications,
  cancelNotifications: alarmMocks.cancelNotifications,
  getDb: () => {
    if (!nativeState.db) {
      throw new Error('test database not prepared');
    }
    return nativeState.db;
  },
}));

const routerPush = vi.hoisted(() => vi.fn());
const routerReplace = vi.hoisted(() => vi.fn());
const routeParams = vi.hoisted(() => ({ current: {} as Record<string, string> }));

// RestView reads exerciseId/setIndex from props, not useRoute(); the
// route object serves NavUpRow (rendered in the #action slot) and the
// override's resolveUpTo call, so its meta mirrors the real rest
// route's function-form upTo - params flow from routeParams, set per
// mount by mountView.
vi.mock('vue-router', () => {
  const route = {
    get params() {
      return routeParams.current;
    },
    meta: {
      upTo: (current: { params: Record<string, string> }) => ({
        name: 'workout-set',
        params: { exerciseId: current.params.exerciseId },
      }),
      upLabel: 'Roll Back Set',
    },
  };
  return {
    useRoute: () => route,
    useRouter: () => ({
      push: routerPush,
      back: vi.fn(),
      replace: routerReplace,
      currentRoute: { value: route },
      options: { history: { state: {} } },
    }),
  };
});

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.hasSystemBack = false;
  nativeState.db = testDb.db;
  routerPush.mockClear();
  routerPush.mockResolvedValue(undefined);
  routerReplace.mockClear();
  routerReplace.mockResolvedValue(undefined);
  alarmMocks.scheduleNotifications.mockClear();
  alarmMocks.cancelNotifications.mockClear();
  alarmMocks.onAppStateChange.mockClear();
  resetRollbackNotice();
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
  vi.useRealTimers();
});

// Bench Press: 2 sets, 90s rest. Cable Row: 1 set, so a session can be
// driven to its very last unlogged set without a third exercise.
async function seedCircuit(): Promise<{ circuitId: string; exercises: ExerciseRow[] }> {
  const db = testDb.db;
  const circuit = await createCircuit(db, { kind: 'workout', name: 'Push' });
  const exercises: ExerciseRow[] = [];
  for (const [name, sets, restSeconds] of [
    ['Bench Press', 2, 90],
    ['Cable Row', 1, 60],
  ] as const) {
    const exercise = await findOrCreateExercise(db, 'workout', name);
    await setPrescription(db, exercise.id, { sets, restSeconds });
    await addExerciseToCircuit(db, circuit.id, exercise.id);
    exercises.push(exercise);
  }
  return { circuitId: circuit.id, exercises };
}

async function startSession(
  circuitId: string,
  { startedAt = '2026-07-16T10:00:00.000Z' } = {},
): Promise<string> {
  const id = newId();
  await testDb.db.insert(session).values({ id, circuitId, startedAt, endedAt: null });
  return id;
}

async function allSetLogs() {
  return testDb.db.select().from(setLog);
}

async function mountView(exerciseId: string, setIndex: number) {
  routeParams.current = { exerciseId, setIndex: String(setIndex) };
  const wrapper = mount(RestView, { props: { exerciseId, setIndex } });
  await flushPromises();
  return wrapper;
}

// A transaction proxy that lets every call through untouched EXCEPT the
// Nth: the arrival read is always call 1, so failOnCall: 2 targets the
// very next write (an edit or FINISH) while the recovery re-read that
// follows a failure (call 3) still succeeds and re-derives real facts.
function failTransaction(db: DbClient, failOnCall: number): DbClient {
  let calls = 0;
  return new Proxy(db as object, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return (...args: unknown[]) => {
          calls += 1;
          if (calls === failOnCall) {
            return Promise.reject(new Error('injected write failure'));
          }
          const original = Reflect.get(target, prop, receiver) as (...a: unknown[]) => unknown;
          return original.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DbClient;
}

function tapFirstStepper(wrapper: VueWrapper<InstanceType<typeof RestView>>): void {
  const [step] = wrapper.findAll('.stepper-field__step');
  firePointer(step.element, 'pointerdown');
  firePointer(step.element, 'pointerup');
}

describe('RestView', () => {
  it('auto-logs on arrival and renders digits derived from endsAt', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);

    const wrapper = await mountView(exercises[0].id, 1);

    expect(wrapper.get('h1').text()).toBe('Rest');
    expect(wrapper.get('.rest-digits').text()).toBe('1:30');
    const rows = await allSetLogs();
    expect(rows).toMatchObject([
      { exerciseId: exercises[0].id, setIndex: 1, reps: 10, weight: 10 },
    ]);
  });

  it('schedules the OS rest alarm at the countdown endsAt on a countdown arrival', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);

    await mountView(exercises[0].id, 1); // Bench Press, 90s rest -> countdown mode

    // Auto-log stamps loggedAt = now (10:05:00); +90s rest -> endsAt 10:06:30.
    expect(alarmMocks.scheduleNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ fireAt: new Date('2026-07-16T10:06:30.000Z') }),
    ]);
  });

  it('schedules no alarm on a final-mode FINISH arrival (the wrong-computed trap)', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    // Bench Press fully logged; Cable Row's one set is the session's last,
    // so this arrival is final mode: rollbackWindowEndsAt is non-null but
    // the countdown endsAt is null, and only the latter may drive the alarm.
    await testDb.db.insert(setLog).values([
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:05:00.000Z',
      },
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 2,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:06:00.000Z',
      },
    ]);

    const wrapper = await mountView(exercises[1].id, 1);

    expect(wrapper.find('.rest__hero').exists()).toBe(false);
    expect(alarmMocks.scheduleNotifications).not.toHaveBeenCalled();
  });

  it('pulses the docked action at <=10s remaining', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await setPrescription(testDb.db, exercises[0].id, { restSeconds: 15 });
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    // advanceTimersByTimeAsync also moves the clock forward by its own
    // duration on top of setSystemTime, landing one second later still
    // (the TotalTime.test.ts convention): 10:05:08 + 1s = 10:05:09, 6s
    // left of the 15s rest.
    vi.setSystemTime(new Date('2026-07-16T10:05:08.000Z'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.get('.rest-digits').text()).toBe('0:06');
    expect(wrapper.get('.docked-action').classes()).toContain('docked-action--pulsing');
    expect(wrapper.find('.rest-digits--timeup').exists()).toBe(false);
  });

  it('pulses at exactly 10s remaining (the boundary)', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await setPrescription(testDb.db, exercises[0].id, { restSeconds: 15 });
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    vi.setSystemTime(new Date('2026-07-16T10:05:04.000Z'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.get('.rest-digits').text()).toBe('0:10');
    expect(wrapper.get('.docked-action').classes()).toContain('docked-action--pulsing');
  });

  it('fills the docked action and calms the digits at 0:00', async () => {
    vi.useFakeTimers({ now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await setPrescription(testDb.db, exercises[0].id, { restSeconds: 15 });
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    vi.setSystemTime(new Date('2026-07-16T10:05:20.000Z'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.get('.rest-digits').text()).toBe('0:00');
    expect(wrapper.get('.rest-digits').classes()).toContain('rest-digits--timeup');
    expect(wrapper.get('.docked-action').classes()).toContain('docked-action--filled');
  });

  it('re-derives the digits from endsAt on a visibilitychange, not the cosmetic interval', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T10:05:00.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    expect(wrapper.get('.rest-digits').text()).toBe('1:30');

    // The interval is real (not faked) here, so it cannot have ticked in
    // the time this test takes to run; only the visibilitychange
    // listener can be what re-derives the digits below.
    vi.setSystemTime(new Date('2026-07-16T10:05:45.000Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(wrapper.get('.rest-digits').text()).toBe('0:45');
  });

  it('a pad tap flushes into the same set_log row after the settle window', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    tapFirstStepper(wrapper);

    await vi.advanceTimersByTimeAsync(300);
    await flushPromises();

    const rows = await allSetLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(9);
  });

  it('NEXT SET routes back to the lift page while this exercise still has sets', async () => {
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    expect(wrapper.get('.docked-action').text()).toBe('Next Set');
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(routerPush).toHaveBeenCalledExactlyOnceWith({
      name: 'workout-set',
      params: { exerciseId: exercises[0].id },
    });
  });

  it('NEXT SET routes to the grid once this exercise is done but others remain', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    // Set 1 already logged (its own earlier rest cycle); Cable Row still
    // has its one set open, so arriving at Bench Press's 2nd (last) set
    // must route to the grid, not back to the (now-done) lift page.
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId: exercises[0].id,
      setIndex: 1,
      reps: 10,
      weight: 10,
      weightUnit: 'lb',
      loggedAt: '2026-07-16T10:05:00.000Z',
    });
    const wrapper = await mountView(exercises[0].id, 2);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(routerPush).toHaveBeenCalledExactlyOnceWith({ name: 'workout-start' });
  });

  it('FINISH ends the session and routes home on the very last set', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    // Bench Press fully logged; Cable Row's one set is the session's last.
    await testDb.db.insert(setLog).values([
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:05:00.000Z',
      },
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 2,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:06:00.000Z',
      },
    ]);

    const wrapper = await mountView(exercises[1].id, 1);

    expect(wrapper.get('.docked-action').text()).toBe('Finish');
    expect(wrapper.find('.rest__hero').exists()).toBe(false);
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const [row] = await testDb.db.select().from(session);
    expect(row.endedAt).not.toBeNull();
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({ name: 'home' });
  });

  it('flushes a pending edit before routing to the lift page (NEXT SET, sets remain)', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    tapFirstStepper(wrapper);

    // No advanceTimersByTime: the docked action's own flush must land
    // the edit, not the settle window - deleting either flush call in
    // handleAction leaves this row at its prefilled value.
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const rows = await allSetLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(9);
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({
      name: 'workout-set',
      params: { exerciseId: exercises[0].id },
    });
  });

  it('flushes a pending edit before routing to the grid (NEXT SET, exercise done)', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId: exercises[0].id,
      setIndex: 1,
      reps: 10,
      weight: 10,
      weightUnit: 'lb',
      loggedAt: '2026-07-16T10:05:00.000Z',
    });
    const wrapper = await mountView(exercises[0].id, 2);

    tapFirstStepper(wrapper);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const rows = await allSetLogs();
    const editedRow = rows.find((row) => row.setIndex === 2);
    expect(editedRow?.reps).toBe(9);
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({ name: 'workout-start' });
  });

  it('flushes a pending edit before FINISH stamps endedAt', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await testDb.db.insert(setLog).values([
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:05:00.000Z',
      },
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 2,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:06:00.000Z',
      },
    ]);
    const wrapper = await mountView(exercises[1].id, 1);

    tapFirstStepper(wrapper);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const rows = await allSetLogs();
    const editedRow = rows.find((row) => row.exerciseId === exercises[1].id);
    expect(editedRow?.reps).toBe(9);
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({ name: 'home' });
  });

  it('blocks NEXT SET when the pending edit fails to flush', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    nativeState.db = failTransaction(testDb.db, 2);
    const wrapper = await mountView(exercises[0].id, 1);

    tapFirstStepper(wrapper);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(routerPush).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("Couldn't save the edit");
  });

  it('blocks FINISH when the pending edit fails to flush; endedAt stays null', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await testDb.db.insert(setLog).values([
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:05:00.000Z',
      },
      {
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 2,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:06:00.000Z',
      },
    ]);
    nativeState.db = failTransaction(testDb.db, 2);
    const wrapper = await mountView(exercises[1].id, 1);
    expect(wrapper.get('.docked-action').text()).toBe('Finish');

    tapFirstStepper(wrapper);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const [row] = await testDb.db.select().from(session);
    expect(row.endedAt).toBeNull();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('flushes a pending edit on teardown (a Skip/back navigation) inside the settle window', async () => {
    vi.useFakeTimers();
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    const wrapper = await mountView(exercises[0].id, 1);

    tapFirstStepper(wrapper);
    wrapper.unmount();
    await flushPromises();

    const rows = await allSetLogs();
    expect(rows).toHaveLength(1);
    expect(rows[0].reps).toBe(9);
  });

  it('renders a note and writes nothing for a stale route with no in-flight session', async () => {
    const { exercises } = await seedCircuit();

    const wrapper = await mountView(exercises[0].id, 1);

    expect(wrapper.text()).toContain('Nothing resting here');
    expect(wrapper.find('.docked-action').exists()).toBe(false);
    expect(await allSetLogs()).toHaveLength(0);
  });

  it('surfaces a failed arrival read as a Retry note with no docked action bar', async () => {
    const { circuitId, exercises } = await seedCircuit();
    await startSession(circuitId);
    nativeState.db = new Proxy(testDb.db as object, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('injected read failure'));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DbClient;

    const wrapper = await mountView(exercises[0].id, 1);

    expect(wrapper.text()).toContain("Couldn't load the rest screen");
    expect(wrapper.find('.docked-action').exists()).toBe(false);
    expect(wrapper.find('.rest__footer').exists()).toBe(false);
    // The up affordance sits outside the load gate: a failed read must
    // never strand an iOS user on this screen.
    expect(wrapper.find('.nav-up-row').exists()).toBe(true);
  });

  it('shows the device-only note in browser dev mode', async () => {
    nativeState.isNative = false;

    const wrapper = await mountView(newId(), 1);

    expect(wrapper.text()).toContain('Data lives on the device');
  });

  describe('back = rollback', () => {
    it('a NavUpRow press rolls back: row deleted, session untouched, replaces to the lift page, notice armed', async () => {
      const { circuitId, exercises } = await seedCircuit();
      const sessionId = await startSession(circuitId);
      const wrapper = await mountView(exercises[0].id, 1);

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(0);
      const [row] = await testDb.db.select().from(session);
      expect(row).toMatchObject({ id: sessionId, endedAt: null });
      expect(routerReplace).toHaveBeenCalledExactlyOnceWith({
        name: 'workout-set',
        params: { exerciseId: exercises[0].id },
      });
      expect(consumeRollbackNotice()).toBe(true);
    });

    it('a rollback failure stays put, notes it, and leaves the row intact', async () => {
      const { circuitId, exercises } = await seedCircuit();
      await startSession(circuitId);
      nativeState.db = failTransaction(testDb.db, 2);
      const wrapper = await mountView(exercises[0].id, 1);

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(routerReplace).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Couldn't roll back");
      expect(await allSetLogs()).toHaveLength(1);
    });

    it('THE TRAP: a rollback must not let the teardown flush resurrect the deleted row', async () => {
      vi.useFakeTimers();
      const { circuitId, exercises } = await seedCircuit();
      await startSession(circuitId);
      const wrapper = await mountView(exercises[0].id, 1);

      // Opens the settle window: the edit has not reached commitEdit yet.
      tapFirstStepper(wrapper);

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      // Unmount flushes LogSetControl's pending edit; without the
      // rolled-back latch this would updateRestLog-miss, refresh, and
      // arriveAtRest would re-insert the just-deleted row.
      wrapper.unmount();
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(0);
    });

    it('a back press racing the arrival load rolls back the insert it raced', async () => {
      const { circuitId, exercises } = await seedCircuit();
      await startSession(circuitId);
      routeParams.current = { exerciseId: exercises[0].id, setIndex: '1' };
      // No flush after mount: the press lands while arriveAtRest's
      // insert is still in flight - the exact reflex this screen's
      // back exists for. The rollback must wait out the load and
      // delete the row it raced, never leave as 'clean'.
      const wrapper = mount(RestView, {
        props: { exerciseId: exercises[0].id, setIndex: 1 },
      });

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(0);
      expect(consumeRollbackNotice()).toBe(true);
      expect(routerReplace).toHaveBeenCalledExactlyOnceWith({
        name: 'workout-set',
        params: { exerciseId: exercises[0].id },
      });
      wrapper.unmount();
    });

    it('THE TRAP, in-op half: an edit enqueued while the rollback is in flight stays inert', async () => {
      vi.useFakeTimers();
      const { circuitId, exercises } = await seedCircuit();
      await startSession(circuitId);
      const wrapper = await mountView(exercises[0].id, 1);

      tapFirstStepper(wrapper);
      // Deliberately un-awaited: the rollback op is enqueued but has
      // not run when the settle window fires below, so commitEdit's
      // call-time guard still passes and the edit lands BEHIND the
      // delete on the chain - only the in-op guard stops it from
      // resurrecting the row.
      void wrapper.get('.nav-up-row').trigger('click');
      vi.advanceTimersByTime(300);
      await flushPromises();

      wrapper.unmount();
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(0);
    });

    it('a second press after a failed rollback retries: row gone, replace fires, note clears', async () => {
      const { circuitId, exercises } = await seedCircuit();
      await startSession(circuitId);
      nativeState.db = failTransaction(testDb.db, 2);
      const wrapper = await mountView(exercises[0].id, 1);

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();
      expect(routerReplace).not.toHaveBeenCalled();

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(0);
      expect(routerReplace).toHaveBeenCalledExactlyOnceWith({
        name: 'workout-set',
        params: { exerciseId: exercises[0].id },
      });
      expect(consumeRollbackNotice()).toBe(true);
      expect(wrapper.text()).not.toContain("Couldn't roll back");
    });

    it('an expired rest leaves without rolling back: row kept, no notice, label reads Workout', async () => {
      // The cold-open restore case: the
      // seeded arrival is an hour past its 90s window, and re-arrival
      // keeps the original loggedAt, so the row's own age disarms the
      // rollback - back is a plain leave and the up row stops
      // promising destruction.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T11:00:00.000Z') });
      const { circuitId, exercises } = await seedCircuit();
      const sessionId = await startSession(circuitId);
      await testDb.db.insert(setLog).values({
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:00:30.000Z',
      });
      const wrapper = await mountView(exercises[0].id, 1);

      expect(wrapper.get('.nav-up-row').text()).toContain('Workout');
      expect(wrapper.get('.nav-up-row').text()).not.toContain('Roll Back');

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(await allSetLogs()).toHaveLength(1);
      expect(routerReplace).toHaveBeenCalledExactlyOnceWith({
        name: 'workout-set',
        params: { exerciseId: exercises[0].id },
      });
      expect(consumeRollbackNotice()).toBe(false);
    });

    it('edits on an expired rest still overwrite the restored set in place', async () => {
      // The other half of the same ruling: the kept set is not frozen -
      // coming back to the restored screen and changing the numbers
      // updates THAT row (same id, loggedAt untouched), never a
      // duplicate.
      vi.useFakeTimers({ now: new Date('2026-07-16T11:00:00.000Z') });
      const { circuitId, exercises } = await seedCircuit();
      const sessionId = await startSession(circuitId);
      await testDb.db.insert(setLog).values({
        id: newId(),
        sessionId,
        exerciseId: exercises[0].id,
        setIndex: 1,
        reps: 10,
        weight: 10,
        weightUnit: 'lb',
        loggedAt: '2026-07-16T10:00:30.000Z',
      });
      const wrapper = await mountView(exercises[0].id, 1);

      tapFirstStepper(wrapper);
      await vi.advanceTimersByTimeAsync(300);
      await flushPromises();

      const rows = await allSetLogs();
      expect(rows).toHaveLength(1);
      expect(rows[0].reps).toBe(9);
      expect(rows[0].loggedAt).toBe('2026-07-16T10:00:30.000Z');
    });

    it('a stale route (no arrival) still replaces on press but arms no notice', async () => {
      const { exercises } = await seedCircuit();

      const wrapper = await mountView(exercises[0].id, 1);

      await wrapper.get('.nav-up-row').trigger('click');
      await flushPromises();

      expect(routerReplace).toHaveBeenCalledExactlyOnceWith({
        name: 'workout-set',
        params: { exerciseId: exercises[0].id },
      });
      expect(consumeRollbackNotice()).toBe(false);
    });
  });
});
