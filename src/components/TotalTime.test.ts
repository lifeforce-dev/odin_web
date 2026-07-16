import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TotalTime from './TotalTime.vue';

describe('TotalTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T10:01:05.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the readout from the persisted session start', () => {
    const wrapper = mount(TotalTime, { props: { startedAt: '2026-07-16T10:00:00.000Z' } });

    expect(wrapper.text()).toContain('00:01:05');
  });

  it('parks at zero when no session is in flight', () => {
    const wrapper = mount(TotalTime, { props: { startedAt: null } });

    expect(wrapper.text()).toContain('00:00:00');
  });

  it('re-derives on tick instead of counting, so a frozen interval cannot drift it', async () => {
    const wrapper = mount(TotalTime, { props: { startedAt: '2026-07-16T10:00:00.000Z' } });

    // Simulate a webview frozen for five minutes firing a single tick
    // (the advance itself moves the fake clock the final second).
    vi.setSystemTime(new Date('2026-07-16T10:06:04.000Z'));
    await vi.advanceTimersByTimeAsync(1000);

    expect(wrapper.text()).toContain('00:06:05');
  });

  it('stops ticking after unmount', () => {
    const wrapper = mount(TotalTime, { props: { startedAt: '2026-07-16T10:00:00.000Z' } });

    wrapper.unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
