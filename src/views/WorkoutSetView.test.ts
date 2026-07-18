import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import type { ExerciseRow, SessionRow } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  setPrescription,
} from '@/domain/builder';
import { REST_PRIMER_COPY } from '@/composables/useRestAlarm';
import { armRollbackNotice, resetRollbackNotice } from '@/composables/useRollbackNotice';

import WorkoutSetView from './WorkoutSetView.vue';

// Integration over the real DB double: the three-zone render states,
// the START REST / FINISH label switch, and the transition write + rest
// route push are view wiring the domain tests cannot see - and there is
// no device walk of the logged states until 03-03 writes set logs.

const nativeState: { isNative: boolean; hasSystemBack: boolean; db: DbClient | null } = {
  isNative: true,
  hasSystemBack: false,
  db: null,
};

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  get hasSystemBack() {
    return nativeState.hasSystemBack;
  },
  minimizeApp: vi.fn().mockResolvedValue(undefined),
  getDb: () => {
    if (!nativeState.db) {
      throw new Error('test database not prepared');
    }
    return nativeState.db;
  },
}));

// The Start Rest tap primes notification permission (fire-and-forget). The
// gate itself is owned by useNotificationPermission.test.ts; here we spy on
// the seam to assert WHICH taps raise it - a non-final Start Rest primes
// with the rest copy, the final-set FINISH does not.
const primerMocks = vi.hoisted(() => ({
  ensureNotificationPermission: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/composables/useNotificationPermission', () => ({
  ensureNotificationPermission: primerMocks.ensureNotificationPermission,
}));

const routerPush = vi.hoisted(() => vi.fn());

// ScreenHeader no longer touches the router; NavUpRow does instead, and
// its render gate needs meta.upTo/upLabel present.
vi.mock('vue-router', () => ({
  useRoute: () => ({
    params: {},
    meta: { upTo: { name: 'workout-start' }, upLabel: 'Workout' },
  }),
  useRouter: () => ({
    push: routerPush,
    back: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
    currentRoute: { value: { meta: { upTo: { name: 'workout-start' }, upLabel: 'Workout' } } },
    options: { history: { state: {} } },
  }),
}));

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.hasSystemBack = false;
  nativeState.db = testDb.db;
  routerPush.mockClear();
  routerPush.mockResolvedValue(undefined);
  primerMocks.ensureNotificationPermission.mockClear();
  resetRollbackNotice();
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
  vi.useRealTimers();
});

// Bench Press prescribed 2 sets, Cable Row 4: enough to finish one
// exercise while the session still has sets elsewhere.
async function seedCircuit(): Promise<{ circuitId: string; exercises: ExerciseRow[] }> {
  const db = testDb.db;
  const circuit = await createCircuit(db, { kind: 'workout', name: 'Push' });
  const exercises: ExerciseRow[] = [];
  for (const [name, sets] of [
    ['Bench Press', 2],
    ['Cable Row', 4],
  ] as const) {
    const exercise = await findOrCreateExercise(db, 'workout', name);
    await setPrescription(db, exercise.id, { sets, restSeconds: 60 });
    await addExerciseToCircuit(db, circuit.id, exercise.id);
    exercises.push(exercise);
  }
  return { circuitId: circuit.id, exercises };
}

async function startSession(
  circuitId: string,
  { startedAt = '2026-07-16T10:00:00.000Z', endedAt = null as string | null } = {},
): Promise<string> {
  const id = newId();
  await testDb.db.insert(session).values({ id, circuitId, startedAt, endedAt });
  return id;
}

async function logSets(
  sessionId: string,
  exerciseId: string,
  count: number,
  { reps = 10, weight = 10, loggedAt = '2026-07-16T10:05:00.000Z' } = {},
): Promise<void> {
  for (let setIndex = 1; setIndex <= count; setIndex += 1) {
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId,
      setIndex,
      reps,
      weight,
      weightUnit: 'lb',
      loggedAt,
    });
  }
}

async function allSessions(): Promise<SessionRow[]> {
  return testDb.db.select().from(session);
}

async function mountView(exerciseId: string) {
  const wrapper = mount(WorkoutSetView, { props: { exerciseId } });
  await flushPromises();
  return wrapper;
}

describe('WorkoutSetView', () => {
  it('renders the three zones for a fresh exercise', async () => {
    const { exercises } = await seedCircuit();

    const wrapper = await mountView(exercises[1].id);

    expect(wrapper.get('h1').text()).toBe('Cable Row');
    const boxes = wrapper.findAll('.set-progress__box');
    expect(boxes).toHaveLength(4);
    expect(boxes[0].classes()).toContain('set-progress__box--current');
    expect(boxes[1].classes()).toContain('set-progress__box--pending');
    expect(wrapper.get('.workout-set__word').text()).toBe('Lift!');
    expect(wrapper.get('.docked-action').text()).toBe('Start Rest');
    // No history yet: the quiet context zone drops the card entirely.
    expect(wrapper.find('.last-circuit').exists()).toBe(false);
    // No session in flight: the readout parks.
    expect(wrapper.text()).toContain('00:00:00');
  });

  it("derives box states and the running total from the in-flight session's facts", async () => {
    // Only Date is faked (real timers keep flushPromises alive).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T10:01:05.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[1].id, 2);

    const wrapper = await mountView(exercises[1].id);

    const boxes = wrapper.findAll('.set-progress__box');
    expect(boxes[0].classes()).toContain('set-progress__box--done');
    expect(boxes[1].classes()).toContain('set-progress__box--done');
    expect(boxes[2].classes()).toContain('set-progress__box--current');
    expect(boxes[3].classes()).toContain('set-progress__box--pending');
    expect(wrapper.text()).toContain('00:01:05');
  });

  it('shows the newest previous-session set as Last Session', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const ended = await startSession(circuitId, {
      startedAt: '2026-07-14T10:00:00.000Z',
      endedAt: '2026-07-14T11:00:00.000Z',
    });
    await logSets(ended, exercises[1].id, 1, { reps: 6, weight: 110 });

    const wrapper = await mountView(exercises[1].id);

    const card = wrapper.get('.last-circuit');
    expect(card.text()).toContain('Last Session');
    expect(card.text()).toContain('6');
    expect(card.text()).toContain('110');
  });

  it('mints the session and routes to the rest screen on START REST', async () => {
    const { circuitId, exercises } = await seedCircuit();

    const wrapper = await mountView(exercises[1].id);
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    const rows = await allSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0].circuitId).toBe(circuitId);
    expect(rows[0].endedAt).toBeNull();
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({
      name: 'rest',
      params: { exerciseId: exercises[1].id, setIndex: 1 },
    });
  });

  it('primes the notification permission with the rest copy on a non-final Start Rest', async () => {
    const { exercises } = await seedCircuit();

    const wrapper = await mountView(exercises[1].id); // Cable Row, 4 sets: not final
    expect(wrapper.get('.docked-action').text()).toBe('Start Rest');
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(primerMocks.ensureNotificationPermission).toHaveBeenCalledExactlyOnceWith(
      REST_PRIMER_COPY,
    );
  });

  it('does not prime the permission on the final-set FINISH', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);
    await logSets(sessionId, exercises[1].id, 3); // Cable Row set 4 is the session's last

    const wrapper = await mountView(exercises[1].id);
    expect(wrapper.get('.docked-action').text()).toBe('Finish');
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(primerMocks.ensureNotificationPermission).not.toHaveBeenCalled();
  });

  it('coalesces a double-tap into one clean transition', async () => {
    const { exercises } = await seedCircuit();

    const wrapper = await mountView(exercises[1].id);
    const button = wrapper.get('.docked-action');
    void button.trigger('click');
    void button.trigger('click');
    await flushPromises();

    expect(await allSessions()).toHaveLength(1);
    // One row alone would also hold WITHOUT the guard - the shared
    // connection rejects the second BEGIN, which lands in the failure
    // note. The guard's actual promise is that the second tap joins
    // the first: no failure surfaced, only the successful rest route
    // ever pushed.
    expect(wrapper.text()).not.toContain("Couldn't start the rest");
    expect(routerPush).toHaveBeenCalled();
    for (const call of routerPush.mock.calls) {
      expect(call[0]).toEqual({
        name: 'rest',
        params: { exerciseId: exercises[1].id, setIndex: 1 },
      });
    }
  });

  it('surfaces a failed transition on the glass and stays put', async () => {
    const { exercises } = await seedCircuit();
    // Reads keep working; only the transition's transaction fails. The
    // view captures useDb() at setup, so the proxy must precede mount.
    nativeState.db = new Proxy(testDb.db as object, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('injected write failure'));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DbClient;

    const wrapper = await mountView(exercises[1].id);
    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain("Couldn't start the rest");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('re-derives the facts when the transition refuses a stale screen', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const wrapper = await mountView(exercises[0].id);

    // The screen goes stale behind the view's back: every remaining
    // set gets logged elsewhere before the tap.
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);

    await wrapper.get('.docked-action').trigger('click');
    await flushPromises();

    expect(routerPush).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('All sets logged');
    expect(wrapper.find('.docked-action').exists()).toBe(false);
    // The refusal minted nothing; only the seeded session exists.
    expect(await allSessions()).toHaveLength(1);
  });

  it('follows an in-place route param change to the new exercise', async () => {
    const { exercises } = await seedCircuit();
    const wrapper = await mountView(exercises[0].id);
    expect(wrapper.get('h1').text()).toBe('Bench Press');

    await wrapper.setProps({ exerciseId: exercises[1].id });
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Cable Row');
    expect(wrapper.findAll('.set-progress__box')).toHaveLength(4);
  });

  it('drops the stale facts when a param-change refresh fails', async () => {
    const { exercises } = await seedCircuit();
    let failReads = false;
    nativeState.db = new Proxy(testDb.db as object, {
      get(target, prop, receiver) {
        if (failReads && prop === 'select') {
          throw new Error('injected read failure');
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DbClient;

    const wrapper = await mountView(exercises[0].id);
    expect(wrapper.get('h1').text()).toBe('Bench Press');

    failReads = true;
    await wrapper.setProps({ exerciseId: exercises[1].id });
    await flushPromises();

    // A failed re-read must not leave exercise A's facts over exercise
    // B's route: Retry note, no footer clock/CTA, no stale title.
    expect(wrapper.text()).toContain("Couldn't load the workout set");
    expect(wrapper.find('.workout-set__footer').exists()).toBe(false);
    expect(wrapper.get('h1').text()).toBe('Workout Set');
  });

  it("reads FINISH on the session's final unlogged set and still routes to rest", async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);
    await logSets(sessionId, exercises[1].id, 3);

    const wrapper = await mountView(exercises[1].id);

    const button = wrapper.get('.docked-action');
    expect(button.text()).toBe('Finish');
    await button.trigger('click');
    await flushPromises();

    // Final mode is derived on the rest screen, so FINISH pushes the
    // same route as START REST; no second session appears.
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({
      name: 'rest',
      params: { exerciseId: exercises[1].id, setIndex: 4 },
    });
    expect(await allSessions()).toHaveLength(1);
  });

  it('renders the all-logged note instead of LIFT! for a done exercise', async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);

    const wrapper = await mountView(exercises[0].id);

    expect(wrapper.text()).toContain('All sets logged');
    expect(wrapper.find('.workout-set__word').exists()).toBe(false);
    expect(wrapper.find('.docked-action').exists()).toBe(false);
  });

  it('says so when the exercise is not on any circuit', async () => {
    await seedCircuit();
    const pooled = await findOrCreateExercise(testDb.db, 'workout', 'Poolside Curl');

    const wrapper = await mountView(pooled.id);

    expect(wrapper.text()).toContain('Not on this workout');
    expect(wrapper.find('.docked-action').exists()).toBe(false);
  });

  it('shows the device-only note in browser dev mode', async () => {
    nativeState.isNative = false;

    const wrapper = await mountView(newId());

    expect(wrapper.text()).toContain('Data lives on the device');
  });

  describe('rollback notice handoff', () => {
    it('renders the SET ROLLED BACK snackbar with no Undo button when armed', async () => {
      const { exercises } = await seedCircuit();
      armRollbackNotice();

      const wrapper = await mountView(exercises[0].id);

      expect(wrapper.get('.trash-snackbar__msg').text()).toBe('Set rolled back');
      expect(wrapper.find('.trash-snackbar__undo').exists()).toBe(false);
    });

    it('renders no snackbar on a second mount: consume clears the one-shot flag', async () => {
      const { exercises } = await seedCircuit();
      armRollbackNotice();
      await mountView(exercises[0].id);

      const wrapper = await mountView(exercises[0].id);

      expect(wrapper.find('.trash-snackbar').exists()).toBe(false);
    });
  });
});
