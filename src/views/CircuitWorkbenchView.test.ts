import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbClient } from '@/db/client';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import { addExerciseToCircuit, createCircuit, findOrCreateExercise } from '@/domain/builder';

import CircuitWorkbenchView from './CircuitWorkbenchView.vue';

// Integration over the real DB double: the screen, the composable, and
// the domain layer wired together, with only the native seam replaced.

const nativeState: { isNative: boolean; db: DbClient | null } = { isNative: true, db: null };

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  getDb: () => {
    if (!nativeState.db) {
      throw new Error('test database not prepared');
    }
    return nativeState.db;
  },
}));

// ScreenHeader reads the router at the composable seam (see its test).
vi.mock('vue-router', () => ({
  useRouter: () => ({
    back: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
    options: { history: { state: {} } },
  }),
}));

let testDb: TestDb;

beforeEach(async () => {
  testDb = await createTestDb();
  nativeState.isNative = true;
  nativeState.db = testDb.db;
});

afterEach(() => {
  nativeState.db = null;
  testDb.close();
});

async function seedCircuit(): Promise<string> {
  const db = testDb.db;
  const circuit = await createCircuit(db, { kind: 'workout', name: 'Legs' });
  for (const [name, sets, restSeconds] of [
    ['Lat Pulldown', 4, 90],
    ['Cable Row', 3, 60],
  ] as const) {
    const exercise = await findOrCreateExercise(db, 'workout', name);
    await addExerciseToCircuit(db, circuit.id, exercise.id, { sets, restSeconds });
  }
  return circuit.id;
}

describe('CircuitWorkbenchView', () => {
  it('renders the persisted slots with the circuit title and count eyebrow', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Legs');
    expect(wrapper.text()).toContain('2 Workouts');
    const slots = wrapper.findAll('.workbench-slot');
    expect(slots).toHaveLength(2);
    expect(slots[0].text()).toContain('Lat Pulldown');
    expect(slots[0].text()).toContain('4 sets // rest 90s');
  });

  it('shows the empty hint for a circuit with no slots yet', async () => {
    const circuit = await createCircuit(testDb.db, { kind: 'workout', name: 'Fresh' });
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuit.id } });
    await flushPromises();

    expect(wrapper.text()).toContain('Empty // add a workout below');
    expect(wrapper.text()).toContain('Tap a workout below to add it');
  });

  it('says so when the circuit does not exist', async () => {
    const wrapper = mount(CircuitWorkbenchView, { props: { id: 'gone' } });
    await flushPromises();

    expect(wrapper.text()).toContain('No circuit here');
    expect(wrapper.find('.workbench-slot').exists()).toBe(false);
  });

  it('states browser dev mode has no data instead of pretending', async () => {
    nativeState.isNative = false;
    const wrapper = mount(CircuitWorkbenchView, { props: { id: 'any' } });
    await flushPromises();

    expect(wrapper.text()).toContain('Data lives on the device');
  });

  it('renders a failed load as an on-screen error with a retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circuitId = await seedCircuit();
    // The read path dies under the screen (plugin hiccup stand-in).
    testDb.close();

    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    expect(errorSpy).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Couldn't load this circuit");
    expect(wrapper.get('.screen-note__action').text()).toBe('Retry');
    vi.restoreAllMocks();
  });
});
