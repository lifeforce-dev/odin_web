import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, ref } from 'vue';
import type { Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRestAlarm } from './useRestAlarm';

// The scheduling policy at the heart of the rest notification: the OS
// alarm is registered at rest START (so it survives the app being closed,
// not just minimized), and the foreground banner is suppressed a beat
// before endsAt but ONLY while the app is in front. The native adapter and
// its app-state seam are mocked so these assert the scheduling decisions
// against a pinned clock, not real OS delivery.
const mocks = vi.hoisted(() => ({
  isNative: true,
  onAppStateChange: vi.fn(),
  scheduleNotifications: vi.fn().mockResolvedValue(undefined),
  cancelNotifications: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/native', () => ({
  get isNative() {
    return mocks.isNative;
  },
  onAppStateChange: mocks.onAppStateChange,
  scheduleNotifications: mocks.scheduleNotifications,
  cancelNotifications: mocks.cancelNotifications,
}));

const NOW = new Date('2026-07-18T00:00:00Z');
const FUTURE = '2026-07-18T00:01:00Z'; // NOW + 60s
const LATER = '2026-07-18T00:02:00Z'; // NOW + 120s
const REST_ID = 1;
// endsAt(60s) - SUPPRESS_LEAD(1s): the foreground cancel fires here.
const SUPPRESS_AT_MS = 59_000;

// One harness component, one endsAt cell it reads through the getter, so
// the whole file stays single-component. Each mount swaps in a fresh cell.
let harnessEndsAt: Ref<string | null> = ref(null);

const AlarmHarness = defineComponent({
  setup() {
    useRestAlarm(() => harnessEndsAt.value);
    return () => null;
  },
});

interface Harness {
  wrapper: ReturnType<typeof mount>;
  endsAt: Ref<string | null>;
  // The isActive handler useRestAlarm registered with the app-state seam.
  fireAppState: (isActive: boolean) => void;
  dispose: ReturnType<typeof vi.fn>;
}

async function mountAlarm(initialEndsAt: string | null): Promise<Harness> {
  const dispose = vi.fn();
  mocks.onAppStateChange.mockResolvedValue(dispose);
  harnessEndsAt = ref<string | null>(initialEndsAt);

  const wrapper = mount(AlarmHarness);
  await flushPromises();

  const handler = mocks.onAppStateChange.mock.calls[0]?.[0] as
    ((isActive: boolean) => void) | undefined;
  return {
    wrapper,
    endsAt: harnessEndsAt,
    fireAppState: handler ?? (() => {}),
    dispose,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.isNative = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRestAlarm', () => {
  it('schedules the rest alarm at rest start (on mount), not on background', async () => {
    await mountAlarm(FUTURE);

    expect(mocks.scheduleNotifications).toHaveBeenCalledExactlyOnceWith([
      {
        id: REST_ID,
        title: 'Rest complete',
        body: 'Time for your next set.',
        fireAt: new Date(FUTURE),
      },
    ]);
  });

  it('suppresses the foreground banner a beat before endsAt while foreground', async () => {
    await mountAlarm(FUTURE);

    vi.advanceTimersByTime(SUPPRESS_AT_MS);

    expect(mocks.cancelNotifications).toHaveBeenCalledWith([REST_ID]);
  });

  it('does not suppress while backgrounded, so the OS alarm survives to fire', async () => {
    const { fireAppState } = await mountAlarm(FUTURE);

    fireAppState(false);
    vi.advanceTimersByTime(SUPPRESS_AT_MS + 5_000);

    expect(mocks.cancelNotifications).not.toHaveBeenCalled();
  });

  it('re-arms the foreground suppression from the wall clock, not a stale relative delay', async () => {
    const { fireAppState } = await mountAlarm(FUTURE); // endsAt = NOW + 60s

    // On device the JS timer is frozen while backgrounded, so advance only
    // the wall clock: 40s pass with the app in the background.
    fireAppState(false);
    vi.setSystemTime(new Date(NOW.getTime() + 40_000));
    fireAppState(true);

    // Residual lead from the clock is 60 - 1 - 40 = 19s. A broken re-arm
    // that restarted the original 59s delay would still be pending here.
    vi.advanceTimersByTime(19_000);

    expect(mocks.cancelNotifications).toHaveBeenCalledWith([REST_ID]);
  });

  it('cancels immediately on returning to the foreground already inside the lead window', async () => {
    const { fireAppState } = await mountAlarm(FUTURE); // endsAt = NOW + 60s

    fireAppState(false);
    // Come back with 0.5s left - past endsAt - SUPPRESS_LEAD, so the cancel
    // is immediate, no timer to wait out.
    vi.setSystemTime(new Date(NOW.getTime() + 59_500));
    fireAppState(true);

    expect(mocks.cancelNotifications).toHaveBeenCalledWith([REST_ID]);
  });

  it('cancels the alarm when endsAt transitions to null (skip/extend into final mode)', async () => {
    const { endsAt } = await mountAlarm(FUTURE);

    endsAt.value = null;
    await nextTick();

    expect(mocks.cancelNotifications).toHaveBeenCalledWith([REST_ID]);
  });

  it('cancels rather than leaving a stale alarm when endsAt moves into the past', async () => {
    const { endsAt } = await mountAlarm(FUTURE);
    mocks.scheduleNotifications.mockClear();

    // A 03-06 skip/extend that shortens rest below the elapsed time.
    endsAt.value = '2026-07-17T23:59:00Z'; // NOW - 60s
    await nextTick();

    expect(mocks.scheduleNotifications).not.toHaveBeenCalled();
    expect(mocks.cancelNotifications).toHaveBeenLastCalledWith([REST_ID]);
  });

  it('disposes a listener that resolves after unmount (no leaked handler)', async () => {
    const dispose = vi.fn();
    let resolveListener: (() => void) | undefined;
    mocks.onAppStateChange.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListener = () => resolve(dispose);
      }),
    );
    harnessEndsAt = ref<string | null>(FUTURE);

    const wrapper = mount(AlarmHarness);
    // onMounted is still awaiting the app-state roundtrip: unmount first,
    // then let it resolve.
    wrapper.unmount();
    resolveListener?.();
    await flushPromises();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('schedules nothing in final mode (null endsAt)', async () => {
    await mountAlarm(null);

    expect(mocks.scheduleNotifications).not.toHaveBeenCalled();
  });

  it('reschedules from the new endsAt on skip/extend', async () => {
    const { endsAt } = await mountAlarm(FUTURE);

    endsAt.value = LATER;
    await nextTick();

    expect(mocks.scheduleNotifications).toHaveBeenLastCalledWith([
      expect.objectContaining({ fireAt: new Date(LATER) }),
    ]);
  });

  it('disposes the listener and cancels the alarm on unmount', async () => {
    const { wrapper, dispose } = await mountAlarm(FUTURE);

    wrapper.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(mocks.cancelNotifications).toHaveBeenCalledWith([REST_ID]);
  });

  it('stays dormant off-device (no listener, no scheduling)', async () => {
    mocks.isNative = false;
    harnessEndsAt = ref<string | null>(FUTURE);
    mount(AlarmHarness);
    await flushPromises();

    expect(mocks.onAppStateChange).not.toHaveBeenCalled();
    expect(mocks.scheduleNotifications).not.toHaveBeenCalled();
  });
});
