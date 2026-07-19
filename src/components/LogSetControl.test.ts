import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { firePointer } from '@/test-utils/pointer-events';

import LogSetControl from './LogSetControl.vue';

// VTU's trigger() resolves to undefined (a Vue nextTick), not the
// event, so a defaultPrevented assertion needs the real DOM dispatch.
function fireKeydown(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  target.dispatchEvent(event);
  return event;
}

// jsdom has no ClipboardEvent constructor either; a plain Event with a
// clipboardData expando is the same workaround firePointer uses for
// PointerEvent.
function firePaste(target: EventTarget, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(event, { clipboardData: { getData: () => text } });
  target.dispatchEvent(event);
}

function mountControl(props: Record<string, unknown> = {}) {
  return mount(LogSetControl, {
    props: { reps: 12, weight: 135, weightUnit: 'lb', ...props },
  });
}

const COMMIT_DEBOUNCE_MS = 300;

afterEach(() => {
  vi.useRealTimers();
});

describe('LogSetControl', () => {
  it('seeds both fields from props', () => {
    const wrapper = mountControl();
    const fields = wrapper.findAll('.log-set-control__field');

    expect(fields[0].element.textContent).toBe('12');
    expect(fields[1].element.textContent).toBe('135');
  });

  it('a reps pad tap updates the field instantly and commits after the settle window', () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const [repsDec] = wrapper.findAll('.stepper-field__step');

    firePointer(repsDec.element, 'pointerdown');
    firePointer(repsDec.element, 'pointerup');

    expect(wrapper.findAll('.log-set-control__field')[0].element.textContent).toBe('11');
    expect(wrapper.emitted('commit')).toBeUndefined();

    vi.advanceTimersByTime(COMMIT_DEBOUNCE_MS);
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 11, weight: 135 }]]);
  });

  it('a weight pad tap steps by 5 and clamps at zero', () => {
    vi.useFakeTimers();
    const wrapper = mountControl({ weight: 3 });
    const steps = wrapper.findAll('.stepper-field__step');
    const weightDec = steps[2];

    firePointer(weightDec.element, 'pointerdown');
    firePointer(weightDec.element, 'pointerup');

    expect(wrapper.findAll('.log-set-control__field')[1].element.textContent).toBe('0');
  });

  it('a burst of pad taps coalesces into one trailing commit', () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const [repsDec] = wrapper.findAll('.stepper-field__step');

    for (let tap = 0; tap < 3; tap += 1) {
      firePointer(repsDec.element, 'pointerdown');
      firePointer(repsDec.element, 'pointerup');
    }
    vi.advanceTimersByTime(COMMIT_DEBOUNCE_MS);

    expect(wrapper.emitted('commit')).toEqual([[{ reps: 9, weight: 135 }]]);
  });

  it('reps keydown blocks non-digit keys and Enter blurs', () => {
    const wrapper = mountControl();
    const repsWell = wrapper.findAll('.log-set-control__field')[0].element as HTMLElement;

    expect(fireKeydown(repsWell, 'a').defaultPrevented).toBe(true);
    expect(fireKeydown(repsWell, '5').defaultPrevented).toBe(false);

    const blurSpy = vi.spyOn(repsWell, 'blur');
    fireKeydown(repsWell, 'Enter');
    expect(blurSpy).toHaveBeenCalled();
  });

  it('weight keydown allows exactly one decimal point', () => {
    const wrapper = mountControl();
    const weightWell = wrapper.findAll('.log-set-control__field')[1].element as HTMLElement;
    weightWell.textContent = '12';

    expect(fireKeydown(weightWell, '.').defaultPrevented).toBe(false);

    weightWell.textContent = '12.';
    expect(fireKeydown(weightWell, '.').defaultPrevented).toBe(true);
  });

  it('typing sanitizes on input and flushes on blur, rounding weight to the nearest 0.5', async () => {
    const wrapper = mountControl();
    const weightWell = wrapper.findAll('.log-set-control__field')[1];

    weightWell.element.textContent = '140.3';
    await weightWell.trigger('input');
    await weightWell.trigger('blur');

    expect(weightWell.element.textContent).toBe('140.5');
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 12, weight: 140.5 }]]);
  });

  it('blur truncates reps to a whole number', async () => {
    const wrapper = mountControl();
    const repsWell = wrapper.findAll('.log-set-control__field')[0];

    repsWell.element.textContent = '7abc';
    await repsWell.trigger('input');
    await repsWell.trigger('blur');

    expect(repsWell.element.textContent).toBe('7');
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 7, weight: 135 }]]);
  });

  it('a typed weight snaps to the nearest 0.5 at the settle boundary, not just on blur', async () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const weightWell = wrapper.findAll('.log-set-control__field')[1];

    weightWell.element.textContent = '12.3';
    await weightWell.trigger('input');
    vi.advanceTimersByTime(COMMIT_DEBOUNCE_MS);

    expect(wrapper.emitted('commit')).toEqual([[{ reps: 12, weight: 12.5 }]]);
    // The boundary snaps; local/DOM state does not also snap mid-typing.
    expect(weightWell.element.textContent).toBe('12.3');
  });

  it('sanitizes a paste to digits (plus a single dot) and commits after the settle window', () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const weightWell = wrapper.findAll('.log-set-control__field')[1].element as HTMLElement;

    firePaste(weightWell, 'ab12c.3xyz');

    expect(weightWell.textContent).toBe('12.3');
    vi.advanceTimersByTime(COMMIT_DEBOUNCE_MS);
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 12, weight: 12.5 }]]);
  });

  it('exposes flush() so a caller can force a pending settle before navigating away', () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const [repsDec] = wrapper.findAll('.stepper-field__step');

    firePointer(repsDec.element, 'pointerdown');
    firePointer(repsDec.element, 'pointerup');
    expect(wrapper.emitted('commit')).toBeUndefined();

    wrapper.vm.flush();
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 11, weight: 135 }]]);

    // The settle timer it preempted must not double-fire later.
    vi.advanceTimersByTime(COMMIT_DEBOUNCE_MS);
    expect(wrapper.emitted('commit')).toHaveLength(1);
  });

  it('a post-failure prop change re-syncs the fields to the DB truth', async () => {
    const wrapper = mountControl();

    await wrapper.setProps({ reps: 5, weight: 45 });

    const fields = wrapper.findAll('.log-set-control__field');
    expect(fields[0].element.textContent).toBe('5');
    expect(fields[1].element.textContent).toBe('45');
  });

  it('a blur with nothing pending emits nothing (the lastCommitted contract)', async () => {
    const wrapper = mountControl();
    const repsWell = wrapper.findAll('.log-set-control__field')[0];

    await repsWell.trigger('blur');

    expect(wrapper.emitted('commit')).toBeUndefined();
  });

  it('an action-triggered flush with nothing pending emits nothing (the lastCommitted contract)', () => {
    const wrapper = mountControl();

    wrapper.vm.flush();

    expect(wrapper.emitted('commit')).toBeUndefined();
  });

  it('a prop change while the field is focused does not rewrite it; blur then re-commits the user value', async () => {
    const wrapper = mount(LogSetControl, {
      props: { reps: 12, weight: 135, weightUnit: 'lb' },
      attachTo: document.body,
    });
    const repsWell = wrapper.findAll('.log-set-control__field')[0].element as HTMLElement;
    repsWell.focus();
    repsWell.textContent = '20';
    await wrapper.findAll('.log-set-control__field')[0].trigger('input');

    await wrapper.setProps({ reps: 5, weight: 135 });
    expect(repsWell.textContent).toBe('20');

    repsWell.blur();

    expect(repsWell.textContent).toBe('20');
    expect(wrapper.emitted('commit')).toEqual([[{ reps: 20, weight: 135 }]]);
    wrapper.unmount();
  });

  it('a pad tap rewrites the field even while it is focused', () => {
    vi.useFakeTimers();
    const wrapper = mount(LogSetControl, {
      props: { reps: 12, weight: 135, weightUnit: 'lb' },
      attachTo: document.body,
    });
    const repsWell = wrapper.findAll('.log-set-control__field')[0].element as HTMLElement;
    repsWell.focus();

    const [repsDec] = wrapper.findAll('.stepper-field__step');
    firePointer(repsDec.element, 'pointerdown');
    firePointer(repsDec.element, 'pointerup');

    expect(repsWell.textContent).toBe('11');
    wrapper.unmount();
  });

  it('flushes a pending edit on teardown so a Skip inside the settle window is not lost', () => {
    vi.useFakeTimers();
    const wrapper = mountControl();
    const [repsDec] = wrapper.findAll('.stepper-field__step');

    firePointer(repsDec.element, 'pointerdown');
    firePointer(repsDec.element, 'pointerup');
    expect(wrapper.emitted('commit')).toBeUndefined();

    wrapper.unmount();

    expect(wrapper.emitted('commit')).toEqual([[{ reps: 11, weight: 135 }]]);
  });
});
