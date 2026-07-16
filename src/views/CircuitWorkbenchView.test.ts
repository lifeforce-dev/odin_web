import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkoutCard from '@/components/WorkoutCard.vue';
import type { DbClient } from '@/db/client';
import { createTestDb } from '@/db/test-db';
import type { TestDb } from '@/db/test-db';
import {
  addExerciseToCircuit,
  createCircuit,
  findOrCreateExercise,
  listCircuitSlots,
  setPrescription,
} from '@/domain/builder';

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
    await setPrescription(db, exercise.id, { sets, restSeconds });
    await addExerciseToCircuit(db, circuit.id, exercise.id);
  }
  return circuit.id;
}

// The pool around the seeded circuit: one free workout and one held by
// another circuit.
async function seedPool(): Promise<{ freeId: string; heldId: string; otherCircuitId: string }> {
  const db = testDb.db;
  const free = await findOrCreateExercise(db, 'workout', 'Goblet Squat');
  const other = await createCircuit(db, { kind: 'workout', name: 'Upper Body' });
  const held = await findOrCreateExercise(db, 'workout', 'Pushups');
  await addExerciseToCircuit(db, other.id, held.id);
  return { freeId: free.id, heldId: held.id, otherCircuitId: other.id };
}

function circuitCards(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.workbench__circuit-zone .workout-card');
}

describe('CircuitWorkbenchView', () => {
  it('renders the persisted cards with the circuit title and count eyebrow', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    expect(wrapper.get('h1').text()).toBe('Legs');
    expect(wrapper.text()).toContain('2 Workouts');
    const cards = circuitCards(wrapper);
    expect(cards).toHaveLength(2);
    expect(cards[0].text()).toContain('Lat Pulldown');
    // The VALUES prove the prop wiring; the sentence format is
    // WorkoutCard.test.ts's contract, pinned once there.
    expect(cards[0].text()).toMatch(/4 sets/);
    expect(cards[0].text()).toMatch(/90s/);
  });

  it('renders a blank title while loading, never a placeholder flash', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });

    // Before the load settles no placeholder title may flash.
    expect(wrapper.get('h1').text()).toBe('');

    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Legs');
  });

  it('shows the empty hint for a circuit with no cards yet', async () => {
    const circuit = await createCircuit(testDb.db, { kind: 'workout', name: 'Fresh' });
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuit.id } });
    await flushPromises();

    expect(wrapper.text()).toContain('Empty // add a workout below');
    expect(wrapper.text()).toContain('Tap a workout below to open it');
  });

  it('says so when the circuit does not exist', async () => {
    const wrapper = mount(CircuitWorkbenchView, { props: { id: 'gone' } });
    await flushPromises();

    expect(wrapper.text()).toContain('No circuit here');
    expect(wrapper.find('.workout-card').exists()).toBe(false);
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

  it('numbers the rack and keeps no standing empty socket', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // Every committed row is a numbered socket; the open socket exists
    // only as a drag's landing gap, never at idle.
    const badges = wrapper.findAll('.workbench__circuit-zone .workbench__rack-index');
    expect(badges.map((badge) => badge.text())).toEqual(['01', '02']);
    expect(wrapper.find('.workbench__rack-slot--gap').exists()).toBe(false);

    // The reorder midpoints are measured on the wrappers via
    // data-rack-id, never on the cards inside them: the wrappers carry
    // the FLIP slide transform, and a transformed ancestor hijacks its
    // descendants' offsetParent, so a card measured mid-slide reads ~0
    // and the landing gap flaps between slots. This pins the attribute
    // the measurement depends on; stripping it would silently empty
    // every midpoint list.
    const rackIds = wrapper
      .findAll('.workbench__circuit-zone .workbench__rack-slot')
      .map((row) => row.attributes('data-rack-id'));
    const cardIds = circuitCards(wrapper).map((card) => card.attributes('data-card-id'));
    expect(rackIds).toEqual(cardIds);
    expect(rackIds.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });

  it('keeps the drop feedback transients out of the idle screen', async () => {
    const circuitId = await seedCircuit();
    await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // The berth, the seam tick, and the receded-region filters exist
    // only while a card is lifted - at idle the pool is plain stock
    // and nothing is dimmed.
    expect(wrapper.find('.workbench__berth').exists()).toBe(false);
    expect(wrapper.find('.workbench__seam-tick').exists()).toBe(false);
    expect(wrapper.find('.workbench__region--receded').exists()).toBe(false);
    // Bans the zone-ring classes by name (a blanket [class*="--armed"]
    // ban would fail any component legitimately carrying an --armed
    // modifier at idle): armed is stated by the lit region, and the
    // only --armed dress is the forge face's, mid-drag.
    expect(wrapper.find('.workbench__circuit-zone--armed').exists()).toBe(false);
    expect(wrapper.find('.workbench__pool--armed').exists()).toBe(false);
    expect(wrapper.find('.forge-slot__face--armed').exists()).toBe(false);
  });

  it('dresses pool cards as stock and circuit cards as committed', async () => {
    const circuitId = await seedCircuit();
    await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    const poolCard = wrapper.get('.workbench__pool-list .workout-card');
    expect(poolCard.classes()).toContain('workout-card--pool');
    expect(poolCard.text()).toMatch(/3x/);
    expect(poolCard.text()).toMatch(/60s/);
    for (const card of circuitCards(wrapper)) {
      expect(card.classes()).not.toContain('workout-card--pool');
    }
  });

  it('renders the pool in its two groups with the create row between them', async () => {
    const circuitId = await seedCircuit();
    await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    const headers = wrapper.findAll('.pool-group__label');
    expect(headers.map((header) => header.text())).toEqual(['Available', 'In Other Circuits']);
    expect(wrapper.get('.workbench__pool-list .workout-card__name').text()).toBe('Goblet Squat');
    expect(wrapper.get('.pool-elsewhere__name').text()).toBe('Pushups');
    expect(wrapper.get('.pool-elsewhere__owner').text()).toBe('Upper Body');
    expect(wrapper.text()).toContain('+ New workout');
  });

  it('hides the elsewhere group when no other circuit holds anything', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    const headers = wrapper.findAll('.pool-group__label');
    expect(headers.map((header) => header.text())).toEqual(['Available']);
  });

  it('adds an available workout from its editor: it arrives as configured', async () => {
    const circuitId = await seedCircuit();
    const { freeId } = await seedPool();
    await setPrescription(testDb.db, freeId, { sets: 5, restSeconds: 45 });
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // ADD TO CIRCUIT lives in the fold, where a circuit card carries
    // REMOVE: same control, same fold, two dress states.
    await wrapper.get(`[data-card-id="${freeId}"] .workout-card__head`).trigger('click');
    await wrapper.get(`[data-card-id="${freeId}"] .workout-card__add`).trigger('click');
    await flushPromises();

    const cards = circuitCards(wrapper);
    expect(cards).toHaveLength(3);
    expect(cards[2].text()).toContain('Goblet Squat');
    // The workout brings its own prescription; nothing re-defaults.
    expect(cards[2].text()).toMatch(/5 sets/);
    expect(cards[2].text()).toMatch(/45s/);
    expect(wrapper.find('.workbench__pool-list .workout-card').exists()).toBe(false);
    const persisted = await listCircuitSlots(testDb.db, circuitId);
    expect(persisted.map((slot) => slot.exerciseName)).toContain('Goblet Squat');
  });

  it('opens the SAME editor on a pool card, minus the circuit-only remove', async () => {
    const circuitId = await seedCircuit();
    const { freeId } = await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    await wrapper.get(`[data-card-id="${freeId}"] .workout-card__head`).trigger('click');

    const poolCard = wrapper.get(`[data-card-id="${freeId}"]`);
    expect(poolCard.find('.workout-card__editor').exists()).toBe(true);
    expect(poolCard.findAll('.stepper-field__step')).toHaveLength(4);
    expect(poolCard.find('.workout-card__remove').exists()).toBe(false);

    // The circuit card's editor carries the remove; one control, one
    // placement-driven difference.
    const heldId = (await listCircuitSlots(testDb.db, circuitId))[0].exerciseId;
    await wrapper.get(`[data-card-id="${freeId}"] .workout-card__head`).trigger('click');
    await wrapper.get(`[data-card-id="${heldId}"] .workout-card__head`).trigger('click');
    expect(wrapper.get(`[data-card-id="${heldId}"]`).find('.workout-card__remove').exists()).toBe(
      true,
    );
  });

  it('steals through the strip: warning first, then both circuits move', async () => {
    const circuitId = await seedCircuit();
    const { heldId, otherCircuitId } = await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // Clicking the row folds the warning open; nothing has moved yet.
    await wrapper.get(`[data-card-id="${heldId}"] .pool-elsewhere__head`).trigger('click');
    expect(wrapper.get('.pool-elsewhere__strip').text()).toContain('out of Upper Body');
    expect(await listCircuitSlots(testDb.db, otherCircuitId)).toHaveLength(1);

    await wrapper.get('.pool-elsewhere__move').trigger('click');
    await flushPromises();

    const cards = circuitCards(wrapper);
    expect(cards.map((card) => card.text()).join(' ')).toContain('Pushups');
    expect(wrapper.find('.pool-elsewhere__row').exists()).toBe(false);
    expect(await listCircuitSlots(testDb.db, otherCircuitId)).toHaveLength(0);
  });

  it('creates inline into AVAILABLE and leaves the circuit alone', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    await wrapper.get('.pool-create__row').trigger('click');
    wrapper.get('.name-entry__entry').element.textContent = 'Dead Bug';
    await wrapper.get('.name-entry__entry').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    // The created workout waits in the pool, fully editable there.
    expect(wrapper.get('.workbench__pool-list .workout-card__name').text()).toBe('Dead Bug');
    expect(circuitCards(wrapper)).toHaveLength(2);
    expect(await listCircuitSlots(testDb.db, circuitId)).toHaveLength(2);
  });

  it('routes a created name that lives elsewhere to that row, strip open', async () => {
    const circuitId = await seedCircuit();
    const { heldId, otherCircuitId } = await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    await wrapper.get('.pool-create__row').trigger('click');
    wrapper.get('.name-entry__entry').element.textContent = 'Pushups';
    await wrapper.get('.name-entry__entry').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    // Nothing moved; the owner's row is open on its warning instead.
    expect(await listCircuitSlots(testDb.db, otherCircuitId)).toHaveLength(1);
    expect(circuitCards(wrapper)).toHaveLength(2);
    const heldRow = wrapper.get(`[data-card-id="${heldId}"]`);
    expect(heldRow.classes()).toContain('pool-elsewhere--open');
  });

  it('applies a rename from either zone; a taken name notices on the card', async () => {
    const circuitId = await seedCircuit();
    const { freeId } = await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // The card detects the press-and-hold itself (WorkoutCard.test.ts);
    // here the wiring is under test, so the emit is driven directly.
    const poolCard = wrapper
      .findAllComponents(WorkoutCard)
      .find((card) => card.props('addable') === true);
    if (!poolCard) {
      throw new Error('expected an addable pool card');
    }

    poolCard.vm.$emit('rename', 'Cable Row');
    await flushPromises();
    expect(wrapper.get(`[data-card-id="${freeId}"] .workout-card__notice`).text()).toContain(
      'already taken',
    );

    poolCard.vm.$emit('rename', 'Goblet Squat Heavy');
    await flushPromises();
    expect(wrapper.get('.workbench__pool-list .workout-card__name').text()).toBe(
      'Goblet Squat Heavy',
    );
  });

  it('keeps the delete face laid out in the forge slot, hidden until a drag begins', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // The slot doubles as the delete target (the forge rule): the face
    // must exist in the idle DOM so the drag can measure its boundary,
    // and it only swaps in via the state-driven lifted class.
    const slot = wrapper.get('.forge-slot');
    // The copy is exactly `x DELETE`, bare ASCII in both dormant and
    // armed - the visuals alone escalate.
    expect(slot.get('.forge-slot__face').text()).toBe('x DELETE');
    expect(slot.text()).toContain('+ New workout');
    expect(slot.classes()).not.toContain('forge-slot--lifted');
  });

  it('flips to loading the moment the circuit id changes', async () => {
    const circuitId = await seedCircuit();
    const other = await createCircuit(testDb.db, { kind: 'workout', name: 'Push Day' });
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Legs');

    await wrapper.setProps({ id: other.id });

    // The flip is synchronous: circuit A must not stay interactive (a
    // stale tap would enqueue a wrong-circuit write) while B loads.
    expect(wrapper.text()).toContain('Loading circuit');
    await flushPromises();
    expect(wrapper.get('h1').text()).toBe('Push Day');
  });
});

// The drag seam: session ids are exercise ids, persistence wants item
// ids, and the drop callbacks translate between them. jsdom rects are
// all zero, so every frozen boundary sits at y=0: negative clientY is
// the circuit band, positive is the forge (or, with the forge seam
// stubbed lower, the pool). Pointer events are plain Events with
// coordinate expandos - the established jsdom workaround.

function dragPointer(
  type: string,
  coords: { clientX: number; clientY: number },
  pointerId = 7,
): void {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, coords, { pointerId });
  document.dispatchEvent(event);
}

function syntheticPress(coords: { clientX: number; clientY: number }, pointerId = 7): PointerEvent {
  const event = new Event('pointerdown', { bubbles: true });
  Object.assign(event, coords, { pointerId, button: 0 });
  return event as PointerEvent;
}

function cardByName(wrapper: ReturnType<typeof mount>, name: string) {
  const card = wrapper.findAllComponents(WorkoutCard).find((entry) => entry.props('name') === name);
  if (!card) {
    throw new Error(`expected a rendered card named ${name}`);
  }
  return card;
}

describe('CircuitWorkbenchView / drag seams', () => {
  it('persists a drag reorder through the exercise-to-item id translation', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();
    const [first, second] = await listCircuitSlots(testDb.db, circuitId);

    cardByName(wrapper, 'Cable Row').vm.$emit(
      'drag-start',
      syntheticPress({ clientX: 10, clientY: 5 }),
    );
    await flushPromises();
    dragPointer('pointermove', { clientX: 10, clientY: -50 });
    await flushPromises();

    // The presence half of the transient contract: mid-drag the real
    // ghost renders and the rack opens the landing gap.
    expect(wrapper.find('.workbench__drag-ghost').exists()).toBe(true);
    expect(wrapper.find('.workbench__rack-slot--gap').exists()).toBe(true);

    dragPointer('pointerup', { clientX: 10, clientY: -50 });
    await flushPromises();

    // The reorder landed with ITEM ids (handing exercise ids to
    // reorderSlots would reorder-mismatch into a silent resync no-op).
    const persisted = await listCircuitSlots(testDb.db, circuitId);
    expect(persisted.map((slot) => slot.id)).toEqual([second.id, first.id]);
    wrapper.unmount();
  });

  it('a flick released before geometry settles never starts a drag', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    cardByName(wrapper, 'Cable Row').vm.$emit(
      'drag-start',
      syntheticPress({ clientX: 10, clientY: 5 }),
    );
    // The release lands inside the settle tick, before the session
    // could begin: no session, no ghost left stuck on screen.
    dragPointer('pointerup', { clientX: 10, clientY: 5 });
    await flushPromises();

    expect(wrapper.find('.workbench__drag-ghost').exists()).toBe(false);
    const persisted = await listCircuitSlots(testDb.db, circuitId);
    expect(persisted.map((slot) => slot.exerciseName)).toEqual(['Lat Pulldown', 'Cable Row']);
    wrapper.unmount();
  });

  it('a forge drop deletes the workout and the snackbar undo restores it', async () => {
    const circuitId = await seedCircuit();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();
    const [first] = await listCircuitSlots(testDb.db, circuitId);

    cardByName(wrapper, 'Lat Pulldown').vm.$emit(
      'drag-start',
      syntheticPress({ clientX: 10, clientY: 5 }),
    );
    await flushPromises();
    dragPointer('pointermove', { clientX: 10, clientY: 40 });
    await flushPromises();

    // Over the forge the face arms - the presence half of the armed
    // dress the idle test bans.
    expect(wrapper.get('.forge-slot__face').classes()).toContain('forge-slot__face--armed');

    dragPointer('pointerup', { clientX: 10, clientY: 40 });
    await flushPromises();

    // The one destructive gesture: archived in the DB, gone from the
    // rack, and the single recovery surface is up with the right name.
    expect(circuitCards(wrapper)).toHaveLength(1);
    expect(wrapper.get('.trash-snackbar__msg').text()).toBe('Lat Pulldown deleted');
    expect(await listCircuitSlots(testDb.db, circuitId)).toHaveLength(1);

    await wrapper.get('.trash-snackbar__undo').trigger('click');
    await flushPromises();

    // Undo restores the identity AND its held slot, and the toast is
    // spent.
    const restored = await listCircuitSlots(testDb.db, circuitId);
    expect(restored.map((slot) => slot.exerciseId)[0]).toBe(first.exerciseId);
    expect(circuitCards(wrapper)).toHaveLength(2);
    expect(wrapper.find('.trash-snackbar').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens the pool berth at the TOP of the stock for a circuit card', async () => {
    const circuitId = await seedCircuit();
    await seedPool();
    const wrapper = mount(CircuitWorkbenchView, { props: { id: circuitId } });
    await flushPromises();

    // Push the forge seam down to y=100 so 0 <= y < 100 reads as the
    // pool band (all other rects stay zero).
    const forgeEl = wrapper.get('.forge-slot').element as HTMLElement;
    forgeEl.getBoundingClientRect = () =>
      ({ top: 100, left: 0, bottom: 148, right: 400, width: 400, height: 48 }) as DOMRect;

    cardByName(wrapper, 'Cable Row').vm.$emit(
      'drag-start',
      syntheticPress({ clientX: 10, clientY: 5 }),
    );
    await flushPromises();
    dragPointer('pointermove', { clientX: 10, clientY: 40 });
    await flushPromises();

    // The berth is deterministic - always the top row of AVAILABLE,
    // never the sorted spot mid-list (which could even open below the
    // scroll).
    const items = wrapper.get('.workbench__pool-items').element;
    expect(items.children[0].className).toContain('workbench__berth');

    dragPointer('pointerup', { clientX: 10, clientY: -50 });
    await flushPromises();
    wrapper.unmount();
  });
});
