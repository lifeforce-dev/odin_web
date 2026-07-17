import { afterEach, describe, expect, it, vi } from 'vitest';

import { useCoalescedWrite } from './useCoalescedWrite';

describe('useCoalescedWrite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('joins a second run onto the in-flight write', async () => {
    let resolveWrite: (value: string) => void = () => {};
    let calls = 0;
    const { run } = useCoalescedWrite('op', () => {
      calls += 1;
      return new Promise<string>((resolve) => {
        resolveWrite = resolve;
      });
    });

    const first = run();
    const second = run();
    resolveWrite('done');

    expect(await first).toBe('done');
    expect(await second).toBe('done');
    expect(calls).toBe(1);
  });

  it('runs fresh again once the previous write settles', async () => {
    let calls = 0;
    const { run } = useCoalescedWrite('op', async () => {
      calls += 1;
      return calls;
    });

    expect(await run()).toBe(1);
    expect(await run()).toBe(2);
  });

  it('logs a thrown write, flips failed, and resolves null', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { failed, run } = useCoalescedWrite('op', () => Promise.reject(new Error('boom')));

    expect(await run()).toBeNull();

    expect(failed.value).toBe(true);
    expect(consoleError).toHaveBeenCalledWith('[odin] op failed', expect.any(Error));
  });

  it('clears failed on the next fresh run', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldFail = true;
    const { failed, run } = useCoalescedWrite('op', async () => {
      if (shouldFail) {
        throw new Error('boom');
      }
      return 'ok';
    });

    await run();
    expect(failed.value).toBe(true);

    shouldFail = false;
    expect(await run()).toBe('ok');
    expect(failed.value).toBe(false);
  });
});
