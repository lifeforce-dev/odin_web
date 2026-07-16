import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkoutCard from './WorkoutCard.vue';

// Pointer events are dispatched as plain Events with coordinate expandos:
// jsdom has no PointerEvent constructor, and VTU's trigger() cannot set
// MouseEvent's readonly button/clientX getters. The handlers only read
// those properties, and gesture tracking lives on document anyway.
// Every event carries a pointerId (the handlers filter on it); the
// primary finger is pointer 1 unless a test says otherwise.
function firePointer(
  target: EventTarget,
  type: string,
  coords: { clientX?: number; clientY?: number; button?: number; pointerId?: number } = {},
): void {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 1, ...coords });
  target.dispatchEvent(event);
}

function mountCard(props: Record<string, unknown> = {}) {
  return mount(WorkoutCard, {
    props: { name: 'Cable Row', sets: 3, restSeconds: 60, ...props },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkoutCard', () => {
  it('hides the editor until open, then formats rest as m:ss', async () => {
    const wrapper = mountCard({ restSeconds: 90 });

    expect(wrapper.find('.workout-card__editor').exists()).toBe(false);

    await wrapper.setProps({ open: true });

    expect(wrapper.find('.workout-card__editor').exists()).toBe(true);
    expect(wrapper.get('.stepper-field__value--rest').text()).toBe('1:30');
  });

  it('emits toggle on a head click, never a drag', async () => {
    const wrapper = mountCard();

    await wrapper.get('.workout-card__head').trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
    expect(wrapper.emitted('drag-start')).toBeUndefined();
  });

  it('emits drag-start from the grip once past the threshold, never a toggle', () => {
    const wrapper = mountCard();

    firePointer(wrapper.get('.grip-handle').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 75 });
    firePointer(document, 'pointerup', { clientX: 50, clientY: 75 });

    expect(wrapper.emitted('drag-start')).toHaveLength(1);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('a grip press that never travels means nothing', () => {
    const wrapper = mountCard();

    firePointer(wrapper.get('.grip-handle').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 53, clientY: 53 });
    firePointer(document, 'pointerup', { clientX: 53, clientY: 53 });

    expect(wrapper.emitted('drag-start')).toBeUndefined();
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('dresses the placements apart: circuit committed, pool stock', () => {
    // One identity, two DRESS states (loaded-rack, 2026-07-15;
    // supersedes the closed-card-identical rule this test used to pin):
    // the pool line wears the cold stock dress with compressed meta,
    // while behavior stays identical in both zones.
    const pooled = mountCard({ variant: 'pool', addable: true });
    const held = mountCard({ removable: true });

    expect(pooled.classes()).toContain('workout-card--pool');
    expect(held.classes()).not.toContain('workout-card--pool');
    expect(pooled.get('.workout-card__meta').text()).toBe('3x // 60s');
    expect(held.get('.workout-card__meta').text()).toBe('3 sets // rest 60s');
  });

  it('carries ADD TO CIRCUIT in the fold when addable, and it emits add', async () => {
    const plain = mountCard({ open: true });
    expect(plain.find('.workout-card__add').exists()).toBe(false);

    const pooled = mountCard({ open: true, addable: true });
    expect(pooled.find('.workout-card__remove').exists()).toBe(false);
    await pooled.get('.workout-card__add').trigger('click');

    expect(pooled.emitted('add')).toHaveLength(1);
  });

  it('carries REMOVE FROM CIRCUIT in the fold when removable, and it emits remove', async () => {
    const held = mountCard({ open: true, removable: true });
    expect(held.find('.workout-card__add').exists()).toBe(false);
    await held.get('.workout-card__remove').trigger('click');

    expect(held.emitted('remove')).toHaveLength(1);
  });

  it('a body swipe scrolls (never drags) while the list has scroll to lose', () => {
    const wrapper = mountCard();

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 90 });
    firePointer(document, 'pointerup', { clientX: 50, clientY: 90 });

    expect(wrapper.emitted('drag-start')).toBeUndefined();
  });

  it('a body swipe drags once the list has nothing to scroll', () => {
    const wrapper = mountCard({ dragAnywhere: true });

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 90 });

    expect(wrapper.emitted('drag-start')).toHaveLength(1);
  });

  it('a body drag that releases back over the head does not also fold it open', async () => {
    const wrapper = mountCard({ dragAnywhere: true });
    const head = wrapper.get('.workout-card__head');

    firePointer(head.element, 'pointerdown', { button: 0, clientX: 50, clientY: 50 });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 90 });
    firePointer(document, 'pointerup', { clientX: 50, clientY: 90 });
    await head.trigger('click');

    expect(wrapper.emitted('drag-start')).toHaveLength(1);
    expect(wrapper.emitted('toggle')).toBeUndefined();

    // ...and the swallow is spent: the next plain tap still folds.
    firePointer(head.element, 'pointerdown', { button: 0, clientX: 50, clientY: 50 });
    firePointer(document, 'pointerup', { clientX: 50, clientY: 50 });
    await head.trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('a still press still renames under dragAnywhere (the drag needs travel)', async () => {
    vi.useFakeTimers();
    const wrapper = mountCard({ dragAnywhere: true });

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(500);
    await flushPromises();

    expect(wrapper.get('.name-entry__entry').element.textContent).toBe('Cable Row');
    expect(wrapper.emitted('drag-start')).toBeUndefined();
  });

  it('the finger that opened a rename cannot then drag the card away', async () => {
    // The press that matured into the rename is still tracked (the
    // handle listens on document, so swapping the head out for the entry
    // never ended its session) - walking it past the threshold must not
    // lift the card out from under the open entry.
    vi.useFakeTimers();
    const wrapper = mountCard({ dragAnywhere: true });

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(500);
    await flushPromises();
    firePointer(document, 'pointermove', { clientX: 50, clientY: 120 });

    expect(wrapper.emitted('drag-start')).toBeUndefined();
    expect(wrapper.find('.name-entry__entry').exists()).toBe(true);
  });

  it('press-and-hold on the head opens the rename entry seeded with the name', async () => {
    vi.useFakeTimers();
    const wrapper = mountCard();

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(500);
    await flushPromises();

    const entry = wrapper.get('.name-entry__entry');
    expect(entry.element.textContent).toBe('Cable Row');
    // The lifting finger's click must not also fold the editor open.
    firePointer(document, 'pointerup', { clientX: 50, clientY: 50 });
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('commits a changed name on Enter and folds the entry away', async () => {
    vi.useFakeTimers();
    const wrapper = mountCard();

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(500);
    await flushPromises();

    const entry = wrapper.get('.name-entry__entry');
    entry.element.textContent = '  Cable Row Heavy ';
    await entry.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('rename')).toEqual([['Cable Row Heavy']]);
    expect(wrapper.find('.name-entry__entry').exists()).toBe(false);
  });

  it('an unchanged, blank, or escaped entry emits nothing', async () => {
    vi.useFakeTimers();
    const wrapper = mountCard();

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    vi.advanceTimersByTime(500);
    await flushPromises();

    const entry = wrapper.get('.name-entry__entry');
    entry.element.textContent = ' Cable Row ';
    await entry.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('rename')).toBeUndefined();
    expect(wrapper.find('.name-entry__entry').exists()).toBe(false);
  });

  it('a moving press never matures into a rename (that swipe is a scroll)', async () => {
    vi.useFakeTimers();
    const wrapper = mountCard();

    firePointer(wrapper.get('.workout-card__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 80 });
    vi.advanceTimersByTime(600);
    await flushPromises();

    expect(wrapper.find('.name-entry__entry').exists()).toBe(false);
  });

  it('renders the parent verdict when a rename was rejected', () => {
    const wrapper = mountCard({ notice: "'Dips' is already taken" });

    expect(wrapper.get('.workout-card__notice').text()).toContain('already taken');
  });

  it('steps once per tap and ramps while held', () => {
    vi.useFakeTimers();
    const wrapper = mountCard({ open: true });
    const minus = wrapper.findAll('.stepper-field__step')[0];

    firePointer(minus.element, 'pointerdown', { button: 0 });
    expect(wrapper.emitted('adjust')).toEqual([['sets', -1]]);

    // Hold: the ramp starts after 360ms and fires every 110ms.
    vi.advanceTimersByTime(360 + 110 * 2);
    expect(wrapper.emitted('adjust')).toHaveLength(3);

    firePointer(minus.element, 'pointerup');
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('adjust')).toHaveLength(3);
  });

  it('never orphans a ramp: a second press supersedes, other lifts are ignored', () => {
    vi.useFakeTimers();
    const wrapper = mountCard({ open: true });
    const [minus, plus] = wrapper.findAll('.stepper-field__step');

    // Finger 1 holds minus into a ramp: 1 tap + 1 ramp tick.
    firePointer(minus.element, 'pointerdown', { button: 0, pointerId: 1 });
    vi.advanceTimersByTime(360 + 110);
    expect(wrapper.emitted('adjust')).toHaveLength(2);

    // Finger 2 presses plus: the minus ramp dies with it (at most one
    // live timer pair - an overwritten timer would ramp forever).
    firePointer(plus.element, 'pointerdown', { button: 0, pointerId: 2 });
    vi.advanceTimersByTime(360 + 110);
    const emitted = wrapper.emitted('adjust');
    expect(emitted).toHaveLength(4);
    expect(emitted?.slice(2)).toEqual([
      ['sets', 1],
      ['sets', 1],
    ]);

    // Finger 1 lifting must not stop finger 2's ramp...
    firePointer(minus.element, 'pointerup', { pointerId: 1 });
    vi.advanceTimersByTime(110);
    expect(wrapper.emitted('adjust')).toHaveLength(5);

    // ...but finger 2 lifting does.
    firePointer(plus.element, 'pointerup', { pointerId: 2 });
    vi.advanceTimersByTime(1000);
    expect(wrapper.emitted('adjust')).toHaveLength(5);
  });

  it('emits the rest stepper deltas as +/-15 seconds', () => {
    const wrapper = mountCard({ open: true });
    const steps = wrapper.findAll('.stepper-field__step');

    firePointer(steps[2].element, 'pointerdown', { button: 0 });
    firePointer(steps[2].element, 'pointerup');
    firePointer(steps[3].element, 'pointerdown', { button: 0 });
    firePointer(steps[3].element, 'pointerup');

    expect(wrapper.emitted('adjust')).toEqual([
      ['restSeconds', -15],
      ['restSeconds', 15],
    ]);
  });

  it('only the flash animation may emit flash-end (animationend bubbles)', () => {
    const wrapper = mountCard({ flash: true });
    const root = wrapper.get('.workout-card').element;

    // A future descendant animation ending must not cut the flash short.
    const stray = new Event('animationend', { bubbles: true });
    Object.assign(stray, { animationName: 'editor-fold' });
    root.dispatchEvent(stray);
    expect(wrapper.emitted('flash-end')).toBeUndefined();

    // The flash itself (scoped styles rename the keyframes) does emit.
    const flash = new Event('animationend', { bubbles: true });
    Object.assign(flash, { animationName: 'card-flash-abc123' });
    root.dispatchEvent(flash);
    expect(wrapper.emitted('flash-end')).toHaveLength(1);
  });
});
