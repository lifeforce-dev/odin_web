import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RouteLocationRaw } from 'vue-router';

import CircuitRow from '@/components/CircuitRow.vue';
import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import type { CircuitRow as CircuitRowRecord } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  getCircuitById,
  getLibrary,
  listActiveCircuits,
  listCircuitSlots,
} from '@/domain/builder';
import { abandonSession } from '@/domain/workout';
import appRouter from '@/router';

import CircuitsView from './CircuitsView.vue';

// Integration over the real DB double: the screen, useCircuitManager, and
// the domain layer wired together, with only the native and router seams
// replaced. Captured push payloads are re-resolved through the REAL route
// table (restore.test.ts's corollary): the fake router accepts anything,
// so resolvability - the thing a route-param change would break - is
// pinned separately via a partial vue-router mock that keeps createRouter
// real.

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

const routerPush = vi.hoisted(() => vi.fn());

// Records what .confirm-strip looked like AT THE MOMENT each geometry
// measurement ran, proving the strip-closes-before-measure ordering
// (not just its post-settle absence) - the real implementation still
// runs, so gapIndex and drop behavior are unaffected.
const measureMidpointsCalls = vi.hoisted(() => [] as Array<Element | null>);

vi.mock('@/composables/measure-midpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/measure-midpoints')>();
  return {
    measureRowMidpoints: (...args: Parameters<typeof actual.measureRowMidpoints>) => {
      measureMidpointsCalls.push(document.querySelector('.confirm-strip'));
      return actual.measureRowMidpoints(...args);
    },
  };
});

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>();
  return {
    ...actual,
    useRoute: () => ({
      params: {},
      meta: { upTo: { name: 'home' }, upLabel: 'Home' },
    }),
    useRouter: () => ({
      push: routerPush,
      back: vi.fn(),
      replace: vi.fn().mockResolvedValue(undefined),
      currentRoute: { value: { meta: { upTo: { name: 'home' }, upLabel: 'Home' } } },
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
  measureMidpointsCalls.length = 0;
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
  vi.restoreAllMocks();
});

async function seedCircuit(name: string, workoutNames: string[] = []): Promise<CircuitRowRecord> {
  const circuit = await createCircuit(testDb.db, { kind: 'workout', name });
  for (const workoutName of workoutNames) {
    const exercise = await findOrCreateExercise(testDb.db, 'workout', workoutName);
    await addExerciseToCircuit(testDb.db, circuit.id, exercise.id);
  }
  return circuit;
}

async function seedInFlightSession(circuitId: string): Promise<string> {
  const id = newId();
  await testDb.db.insert(session).values({
    id,
    circuitId,
    startedAt: '2026-07-17T10:00:00.000Z',
    endedAt: null,
    outcome: null,
  });
  return id;
}

function circuitRows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAllComponents(CircuitRow);
}

function resolvePush() {
  return appRouter.resolve(routerPush.mock.calls[0][0] as RouteLocationRaw);
}

describe('CircuitsView', () => {
  it('renders rows in rotation order with workout counts', async () => {
    await seedCircuit('Legs', ['Lat Pulldown', 'Cable Row']);
    await seedCircuit('Push', ['Bench Press']);
    await seedCircuit('Empty');
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const rows = circuitRows(wrapper);
    expect(rows.map((row) => row.props('name'))).toEqual(['Legs', 'Push', 'Empty']);
    expect(rows.map((row) => row.props('order'))).toEqual([1, 2, 3]);
    expect(rows[0].get('.circuit-row__meta').text()).toBe('2 workouts');
    expect(rows[1].get('.circuit-row__meta').text()).toBe('1 workout');
    expect(rows[2].get('.circuit-row__meta').text()).toBe('Empty');
  });

  it('shows the empty-queue hint with no circuits, and drops it once one exists', async () => {
    const empty = mount(CircuitsView);
    await flushPromises();
    expect(empty.get('.circuits__empty-hint').text()).toContain('No circuits yet');
    expect(circuitRows(empty)).toHaveLength(0);

    await seedCircuit('Legs', ['Lat Pulldown']);
    const filled = mount(CircuitsView);
    await flushPromises();
    expect(filled.find('.circuits__empty-hint').exists()).toBe(false);
    expect(circuitRows(filled)).toHaveLength(1);
  });

  it('tags the first non-empty row NEXT when idle, skipping an empty front row', async () => {
    await seedCircuit('Empty Front');
    await seedCircuit('Legs', ['Lat Pulldown']);
    await seedCircuit('Push', ['Bench Press']);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const rows = circuitRows(wrapper);
    expect(rows[0].props('tag')).toBeNull();
    expect(rows[1].props('tag')).toBe('next');
    expect(rows[2].props('tag')).toBeNull();
    expect(rows[1].get('.circuit-row__tag').text()).toBe('Next');
  });

  it("tags the in-flight session's circuit ACTIVE regardless of position", async () => {
    await seedCircuit('Legs', ['Lat Pulldown']);
    const push = await seedCircuit('Push', ['Bench Press']);
    await seedInFlightSession(push.id);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const rows = circuitRows(wrapper);
    const pushRow = rows.find((row) => row.props('name') === 'Push')!;
    expect(pushRow.props('tag')).toBe('active');
    expect(rows.find((row) => row.props('name') === 'Legs')?.props('tag')).toBeNull();
    expect(pushRow.get('.circuit-row__tag').text()).toBe('Active');
  });

  it('shows the active-session box only while a session is in flight', async () => {
    await seedCircuit('Legs', ['Lat Pulldown']);
    const idleWrapper = mount(CircuitsView);
    await flushPromises();
    expect(idleWrapper.find('.circuits__active').exists()).toBe(false);

    const push = await seedCircuit('Push', ['Bench Press']);
    await seedInFlightSession(push.id);
    const activeWrapper = mount(CircuitsView);
    await flushPromises();

    expect(activeWrapper.get('.circuits__active-name').text()).toBe('Push');
  });

  it('abandon strip confirm ends the session, keeps set_logs, and rotates the circuit to the back', async () => {
    const push = await seedCircuit('Push', ['Bench Press']);
    await seedCircuit('Pull', ['Cable Row']);
    const sessionId = await seedInFlightSession(push.id);
    const [pushSlot] = await listCircuitSlots(testDb.db, push.id);
    const setLogId = newId();
    await testDb.db.insert(setLog).values({
      id: setLogId,
      sessionId,
      exerciseId: pushSlot.exerciseId,
      setIndex: 1,
      reps: 10,
      weight: 135,
      weightUnit: 'lb',
      loggedAt: '2026-07-17T10:02:00.000Z',
    });
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const abandonBtn = wrapper
      .findAll('.circuits__ghost-btn')
      .find((button) => button.text() === 'Abandon');
    await abandonBtn!.trigger('click');
    await flushPromises();

    const strip = wrapper.get('.confirm-strip');
    expect(strip.text()).toContain('End this workout?');
    expect(strip.text()).toContain('Your logged sets are kept');

    await wrapper.get('.confirm-strip__confirm').trigger('click');
    await flushPromises();

    expect(wrapper.find('.circuits__active').exists()).toBe(false);
    const rows = await testDb.db.select().from(session);
    const row = rows.find((entry) => entry.id === sessionId);
    expect(row).toMatchObject({ outcome: 'abandoned' });
    expect(row?.endedAt).not.toBeNull();
    const order = await listActiveCircuits(testDb.db, 'workout');
    expect(order.map((circuit) => circuit.name)).toEqual(['Pull', 'Push']);
    const survivingSetLogs = await testDb.db.select().from(setLog);
    expect(survivingSetLogs.find((entry) => entry.id === setLogId)).toBeDefined();
  });

  it('swap mode dims ineligible rows; confirm fronts the target, abandons the old session, and stays put', async () => {
    const push = await seedCircuit('Push', ['Bench Press']);
    const pull = await seedCircuit('Pull', ['Cable Row']);
    await seedCircuit('Empty');
    const sessionId = await seedInFlightSession(push.id);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const swapBtn = wrapper.findAll('.circuits__ghost-btn').find((b) => b.text() === 'Swap');
    await swapBtn!.trigger('click');
    await flushPromises();

    const rows = circuitRows(wrapper);
    expect(rows.find((row) => row.props('name') === 'Push')?.props('dimmed')).toBe(true);
    expect(rows.find((row) => row.props('name') === 'Empty')?.props('dimmed')).toBe(true);
    const pullRow = rows.find((row) => row.props('name') === 'Pull')!;
    expect(pullRow.props('dimmed')).toBe(false);

    // Delete affordances are inert in swap mode: a tap must not fold
    // open the DELETE strip (it shares openStripId with the swap pick).
    await pullRow.get('.circuit-row__delete').trigger('click');
    await flushPromises();
    expect(wrapper.find('.confirm-strip').exists()).toBe(false);
    expect((await getCircuitById(testDb.db, pull.id))?.archivedAt).toBeNull();

    await pullRow.get('.circuit-row__body').trigger('click');
    await flushPromises();

    const strip = wrapper.get('.confirm-strip');
    expect(strip.text()).toContain('Your logged sets are recorded');
    expect(strip.text()).toContain('Start Workout will start // Pull');

    await wrapper.get('.confirm-strip__confirm').trigger('click');
    await flushPromises();

    const order = await listActiveCircuits(testDb.db, 'workout');
    expect(order[0].id).toBe(pull.id);
    const sessions = await testDb.db.select().from(session);
    expect(sessions.find((entry) => entry.id === sessionId)).toMatchObject({
      outcome: 'abandoned',
    });
    // Swap fronts the queue; it never auto-starts a session or navigates.
    expect(wrapper.find('.circuits__active').exists()).toBe(false);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('row taps never navigate in swap mode', async () => {
    const push = await seedCircuit('Push', ['Bench Press']);
    await seedCircuit('Pull', ['Cable Row']);
    await seedInFlightSession(push.id);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const swapBtn = wrapper.findAll('.circuits__ghost-btn').find((b) => b.text() === 'Swap');
    await swapBtn!.trigger('click');
    await flushPromises();

    const pullRow = circuitRows(wrapper).find((row) => row.props('name') === 'Pull')!;
    await pullRow.get('.circuit-row__body').trigger('click');

    expect(routerPush).not.toHaveBeenCalled();
  });

  it('active going null (behind the screen) exits swap mode and clears the open strip', async () => {
    const push = await seedCircuit('Push', ['Bench Press']);
    await seedCircuit('Pull', ['Cable Row']);
    const sessionId = await seedInFlightSession(push.id);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const swapBtn = wrapper.findAll('.circuits__ghost-btn').find((b) => b.text() === 'Swap');
    await swapBtn!.trigger('click');
    await flushPromises();
    expect(wrapper.find('.circuits__active-hint').exists()).toBe(true);

    // Ends the session behind the screen's back - the swap strip has no
    // knowledge of this until the next reload.
    await abandonSession(testDb.db, sessionId);

    // A queue drag reload is the trigger: reorder now reloads per C1.
    const rows = circuitRows(wrapper);
    const press = new Event('pointerdown', { bubbles: true });
    Object.assign(press, { clientX: 10, clientY: 5, pointerId: 9, button: 0 });
    rows[0].vm.$emit('drag-start', press as PointerEvent);
    await flushPromises();
    const release = new Event('pointerup', { bubbles: true });
    Object.assign(release, { clientX: 10, clientY: 5, pointerId: 9 });
    document.dispatchEvent(release);
    await flushPromises();

    expect(wrapper.find('.circuits__active-hint').exists()).toBe(false);
    expect(wrapper.find('.confirm-strip').exists()).toBe(false);
    expect(circuitRows(wrapper).every((row) => row.props('dimmed') === false)).toBe(true);
    wrapper.unmount();
  });

  it('+ ADD CIRCUIT creates and navigates through a route re-resolved against the real table', async () => {
    const wrapper = mount(CircuitsView);
    await flushPromises();

    await wrapper.get('.circuits__add-btn').trigger('click');
    await flushPromises();

    expect(routerPush).toHaveBeenCalledTimes(1);
    const resolved = resolvePush();
    expect(resolved.name).toBe('circuit-workbench');
    const created = (await listActiveCircuits(testDb.db, 'workout'))[0];
    expect(resolved.params).toEqual({ id: created.id });
    expect(created.name).toBe('New Circuit');
  });

  it('shows a notice and does not navigate when the create fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Reads keep working; only the create's transaction fails. The view
    // captures useDb() at setup, so the proxy must precede mount (the
    // HomeView.test.ts precedent).
    nativeState.db = new Proxy(testDb.db as object, {
      get(target, prop, receiver) {
        if (prop === 'transaction') {
          return () => Promise.reject(new Error('injected write failure'));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DbClient;
    const wrapper = mount(CircuitsView);
    await flushPromises();

    await wrapper.get('.circuits__add-btn').trigger('click');
    await flushPromises();

    expect(wrapper.get('.circuits__add-notice').text()).toContain("Couldn't create");
    expect(routerPush).not.toHaveBeenCalled();
  });

  it('ADD CIRCUIT double-tap joins the in-flight create, minting exactly one circuit', async () => {
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const btn = wrapper.get('.circuits__add-btn');
    void btn.trigger('click');
    void btn.trigger('click');
    await flushPromises();

    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(await listActiveCircuits(testDb.db, 'workout')).toHaveLength(1);
  });

  it('delete strip confirm archives the circuit; its workouts derive back to available', async () => {
    const push = await seedCircuit('Push', ['Bench Press']);
    const other = await seedCircuit('Legs');
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const pushRow = circuitRows(wrapper).find((row) => row.props('name') === 'Push')!;
    await pushRow.get('.circuit-row__delete').trigger('click');
    await flushPromises();

    const strip = wrapper.get('.confirm-strip');
    expect(strip.text()).toContain('Delete this circuit?');
    expect(strip.text()).toContain('workouts and their history are kept');

    await wrapper.get('.confirm-strip__confirm').trigger('click');
    await flushPromises();

    expect(circuitRows(wrapper).map((row) => row.props('name'))).not.toContain('Push');
    const archived = await getCircuitById(testDb.db, push.id);
    expect(archived?.archivedAt).not.toBeNull();
    const library = await getLibrary(testDb.db, other.id);
    expect(library.available.map((entry) => entry.name)).toContain('Bench Press');
  });

  it('starting a drag closes an open strip before measuring geometry', async () => {
    await seedCircuit('Push', ['Bench Press']);
    await seedCircuit('Pull', ['Cable Row']);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    const rows = circuitRows(wrapper);
    await rows[0].get('.circuit-row__delete').trigger('click');
    await flushPromises();
    expect(wrapper.find('.confirm-strip').exists()).toBe(true);
    measureMidpointsCalls.length = 0;

    // The drag session begins on the OTHER row; the strip must already
    // be gone when the geometry is measured (an open strip inflates its
    // wrapper's rect and skews every midpoint below it).
    const press = new Event('pointerdown', { bubbles: true });
    Object.assign(press, { clientX: 10, clientY: 100, pointerId: 7, button: 0 });
    rows[1].vm.$emit('drag-start', press as PointerEvent);
    await flushPromises();

    expect(wrapper.find('.confirm-strip').exists()).toBe(false);

    // Measurement runs per move, not just at lift: an explicit move
    // proves the strip stays gone for every later measurement too.
    const move = new Event('pointermove', { bubbles: true });
    Object.assign(move, { clientX: 10, clientY: 150, pointerId: 7 });
    document.dispatchEvent(move);
    await flushPromises();

    expect(measureMidpointsCalls.length).toBeGreaterThan(0);
    expect(measureMidpointsCalls.every((strip) => strip === null)).toBe(true);

    const release = new Event('pointerup', { bubbles: true });
    Object.assign(release, { clientX: 10, clientY: 150, pointerId: 7 });
    document.dispatchEvent(release);
    await flushPromises();
    wrapper.unmount();
  });

  it('row tap navigates through a route re-resolved against the real table', async () => {
    const legs = await seedCircuit('Legs', ['Lat Pulldown']);
    const wrapper = mount(CircuitsView);
    await flushPromises();

    await circuitRows(wrapper)[0].get('.circuit-row__body').trigger('click');

    expect(routerPush).toHaveBeenCalledTimes(1);
    const resolved = resolvePush();
    expect(resolved.name).toBe('circuit-workbench');
    expect(resolved.params).toEqual({ id: legs.id });
  });
});
