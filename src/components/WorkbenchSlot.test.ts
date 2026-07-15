import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkbenchSlot from './WorkbenchSlot.vue';

// Pointer events are dispatched as plain Events with coordinate expandos:
// jsdom has no PointerEvent constructor, and VTU's trigger() cannot set
// MouseEvent's readonly button/clientX getters. The handlers only read
// those properties, and tap-vs-drag tracking lives on document anyway.
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

function mountSlot(props: Record<string, unknown> = {}) {
  return mount(WorkbenchSlot, {
    props: { name: 'Cable Row', sets: 3, restSeconds: 60, ...props },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('WorkbenchSlot', () => {
  it('renders the name and the SETS // REST meta', () => {
    const wrapper = mountSlot();

    expect(wrapper.text()).toContain('Cable Row');
    expect(wrapper.text()).toContain('3 sets // rest 60s');
  });

  it('hides the editor until open, then formats rest as m:ss', async () => {
    const wrapper = mountSlot({ restSeconds: 90 });

    expect(wrapper.find('.workbench-slot__editor').exists()).toBe(false);

    await wrapper.setProps({ open: true });

    expect(wrapper.find('.workbench-slot__editor').exists()).toBe(true);
    expect(wrapper.get('.workbench-slot__value--rest').text()).toBe('1:30');
  });

  it('emits toggle on a head press that never travels', () => {
    const wrapper = mountSlot();

    firePointer(wrapper.get('.workbench-slot__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 53, clientY: 53 });
    firePointer(document, 'pointerup', { clientX: 53, clientY: 53 });

    expect(wrapper.emitted('toggle')).toHaveLength(1);
    expect(wrapper.emitted('drag-start')).toBeUndefined();
  });

  it('emits drag-start once past the 10px threshold and never toggles', () => {
    const wrapper = mountSlot();

    firePointer(wrapper.get('.workbench-slot__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 75 });
    firePointer(document, 'pointermove', { clientX: 50, clientY: 90 });
    firePointer(document, 'pointerup', { clientX: 50, clientY: 90 });

    expect(wrapper.emitted('drag-start')).toHaveLength(1);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('ignores other fingers during a head press: no stray toggle or steal', () => {
    const wrapper = mountSlot();

    firePointer(wrapper.get('.workbench-slot__head').element, 'pointerdown', {
      button: 0,
      clientX: 50,
      clientY: 50,
    });

    // A second finger travels far and lifts elsewhere on the glass: it
    // must neither hand off a drag nor toggle the editor.
    firePointer(document, 'pointermove', { clientX: 200, clientY: 200, pointerId: 2 });
    firePointer(document, 'pointerup', { clientX: 200, clientY: 200, pointerId: 2 });
    expect(wrapper.emitted('drag-start')).toBeUndefined();
    expect(wrapper.emitted('toggle')).toBeUndefined();

    // The pressing finger still completes its tap.
    firePointer(document, 'pointerup', { clientX: 52, clientY: 52 });
    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('steps once per tap and ramps while held', () => {
    vi.useFakeTimers();
    const wrapper = mountSlot({ open: true });
    const minus = wrapper.findAll('.workbench-slot__step')[0];

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
    const wrapper = mountSlot({ open: true });
    const [minus, plus] = wrapper.findAll('.workbench-slot__step');

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

  it('only the flash animation may emit flash-end (animationend bubbles)', () => {
    const wrapper = mountSlot({ flash: true });
    const root = wrapper.get('.workbench-slot').element;

    // A future descendant animation ending must not cut the flash short.
    const stray = new Event('animationend', { bubbles: true });
    Object.assign(stray, { animationName: 'editor-fold' });
    root.dispatchEvent(stray);
    expect(wrapper.emitted('flash-end')).toBeUndefined();

    // The flash itself (scoped styles rename the keyframes) does emit.
    const flash = new Event('animationend', { bubbles: true });
    Object.assign(flash, { animationName: 'slot-flash-abc123' });
    root.dispatchEvent(flash);
    expect(wrapper.emitted('flash-end')).toHaveLength(1);
  });

  it('emits the rest stepper deltas as +/-15 seconds', () => {
    const wrapper = mountSlot({ open: true });
    const steps = wrapper.findAll('.workbench-slot__step');

    firePointer(steps[2].element, 'pointerdown', { button: 0 });
    firePointer(steps[2].element, 'pointerup');
    firePointer(steps[3].element, 'pointerdown', { button: 0 });
    firePointer(steps[3].element, 'pointerup');

    expect(wrapper.emitted('adjust')).toEqual([
      ['restSeconds', -15],
      ['restSeconds', 15],
    ]);
  });

  it('emits remove from the editor button', async () => {
    const wrapper = mountSlot({ open: true });

    await wrapper.get('.workbench-slot__remove').trigger('click');

    expect(wrapper.emitted('remove')).toHaveLength(1);
  });
});
