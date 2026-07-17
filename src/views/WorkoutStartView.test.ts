import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { newId } from '@/db/ids';
import { session, setLog } from '@/db/schema';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import type { ExerciseRow } from '@/db/schema';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  setPrescription,
} from '@/domain/builder';

import WorkoutStartView from './WorkoutStartView.vue';

// Integration over the real DB double: the grid's prop passthrough,
// the tap-through route params, and the TotalTime feed are the seams
// the domain tests cannot see, and the in-flight states have no device
// walk until 03-05 writes sessions.

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

// ScreenHeader no longer touches the router; NavUpRow does instead, and
// its render gate needs meta.upTo/upLabel present.
vi.mock('vue-router', () => ({
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
}));

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.hasSystemBack = false;
  nativeState.db = testDb.db;
  routerPush.mockClear();
  routerPush.mockResolvedValue(undefined);
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
  vi.useRealTimers();
});

// Bench Press prescribed 2 sets, Cable Row 4: small enough to complete
// one and leave the other mid-flight.
async function seedCircuit(): Promise<{ circuitId: string; exercises: ExerciseRow[] }> {
  const db = testDb.db;
  const circuit = await createCircuit(db, { kind: 'workout', name: 'Legs' });
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

async function startSession(circuitId: string): Promise<string> {
  const id = newId();
  await testDb.db.insert(session).values({
    id,
    circuitId,
    startedAt: '2026-07-16T10:00:00.000Z',
    endedAt: null,
  });
  return id;
}

async function logSets(sessionId: string, exerciseId: string, count: number): Promise<void> {
  for (let setIndex = 1; setIndex <= count; setIndex += 1) {
    await testDb.db.insert(setLog).values({
      id: newId(),
      sessionId,
      exerciseId,
      setIndex,
      reps: 10,
      weight: 10,
      weightUnit: 'lb',
      loggedAt: '2026-07-16T10:05:00.000Z',
    });
  }
}

function tiles(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.circuit-card');
}

describe('WorkoutStartView', () => {
  it('renders the up-next circuit as the title with one tile per slot', async () => {
    await seedCircuit();
    const wrapper = mount(WorkoutStartView);
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Legs');
    const cards = tiles(wrapper);
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('Bench Press');
    expect(cards[1].text()).toContain('Cable Row');
    // No session in flight: the readout parks.
    expect(wrapper.text()).toContain('00:00:00');
  });

  it('derives tile states and the running total from the in-flight session', async () => {
    // Only Date is faked (real setTimeout keeps flushPromises alive):
    // the readout must derive from the persisted start, not the machine
    // clock the seeded timestamp happens to be in the past of.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-07-16T10:01:05.000Z') });
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);
    await logSets(sessionId, exercises[1].id, 1);

    const wrapper = mount(WorkoutStartView);
    await flushPromises();

    const [done, inProgress] = tiles(wrapper);
    expect(done.text()).toContain('Done');
    expect(done.attributes('disabled')).toBeDefined();
    expect(inProgress.text()).toContain('1/4');
    expect(inProgress.attributes('disabled')).toBeUndefined();
    // The footer runs off session.startedAt: 65s after the seeded start.
    expect(wrapper.text()).toContain('Total Time');
    expect(wrapper.text()).toContain('00:01:05');
  });

  it("pushes the workout-set route with the tapped tile's exerciseId", async () => {
    const { circuitId, exercises } = await seedCircuit();
    const sessionId = await startSession(circuitId);
    await logSets(sessionId, exercises[0].id, 2);

    const wrapper = mount(WorkoutStartView);
    await flushPromises();

    // The done tile is inert; tapping it must not navigate.
    await tiles(wrapper)[0].trigger('click');
    expect(routerPush).not.toHaveBeenCalled();

    await tiles(wrapper)[1].trigger('click');
    expect(routerPush).toHaveBeenCalledExactlyOnceWith({
      name: 'workout-set',
      params: { exerciseId: exercises[1].id },
    });
  });

  it('shows the nothing-to-start note when no circuit is startable', async () => {
    const wrapper = mount(WorkoutStartView);
    await flushPromises();

    expect(wrapper.text()).toContain('Nothing to start');
    expect(tiles(wrapper)).toHaveLength(0);
  });
});
