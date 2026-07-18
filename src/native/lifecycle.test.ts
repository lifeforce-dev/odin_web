import { beforeEach, describe, expect, it, vi } from 'vitest';

// lifecycle.ts is the one file that touches @capacitor/app, so its
// invariants live nowhere else: re-registration must remove the previous
// handle exactly once, and the web build must never reach the plugin.
// Module-level listener state means a fresh module per test.
const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  isNative: true,
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addListener },
}));

vi.mock('./platform', () => ({
  get isNative() {
    return mocks.isNative;
  },
}));

function makeHandle(): { remove: ReturnType<typeof vi.fn> } {
  return { remove: vi.fn().mockResolvedValue(undefined) };
}

async function importLifecycle(): Promise<typeof import('./lifecycle')> {
  return await import('./lifecycle');
}

describe('onHardwareBackButton', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.addListener.mockReset();
    mocks.isNative = true;
  });

  it('replaces the previous listener on re-registration', async () => {
    const firstHandle = makeHandle();
    const secondHandle = makeHandle();
    mocks.addListener.mockResolvedValueOnce(firstHandle).mockResolvedValueOnce(secondHandle);
    const { onHardwareBackButton } = await importLifecycle();

    await onHardwareBackButton(() => {});
    await onHardwareBackButton(() => {});

    expect(mocks.addListener).toHaveBeenCalledTimes(2);
    expect(firstHandle.remove).toHaveBeenCalledTimes(1);
    expect(secondHandle.remove).not.toHaveBeenCalled();
  });

  it('unwraps canGoBack from the plugin event for the handler', async () => {
    mocks.addListener.mockResolvedValue(makeHandle());
    const { onHardwareBackButton } = await importLifecycle();
    const handler = vi.fn();

    await onHardwareBackButton(handler);
    const pluginListener = mocks.addListener.mock.calls[0][1] as (event: {
      canGoBack: boolean;
    }) => void;
    pluginListener({ canGoBack: true });

    expect(handler).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('never reaches the plugin in the browser', async () => {
    mocks.isNative = false;
    const { onHardwareBackButton } = await importLifecycle();

    await onHardwareBackButton(() => {});

    expect(mocks.addListener).not.toHaveBeenCalled();
  });
});

describe('onAppStateChange', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.addListener.mockReset();
    mocks.isNative = true;
  });

  it('unwraps isActive from the plugin event for the handler', async () => {
    mocks.addListener.mockResolvedValue(makeHandle());
    const { onAppStateChange } = await importLifecycle();
    const handler = vi.fn();

    await onAppStateChange(handler);
    const [eventName, pluginListener] = mocks.addListener.mock.calls[0] as [
      string,
      (event: { isActive: boolean }) => void,
    ];
    expect(eventName).toBe('appStateChange');

    pluginListener({ isActive: false });
    expect(handler).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('returns a disposer that removes exactly this listener', async () => {
    const handle = makeHandle();
    mocks.addListener.mockResolvedValue(handle);
    const { onAppStateChange } = await importLifecycle();

    const dispose = await onAppStateChange(() => {});
    expect(handle.remove).not.toHaveBeenCalled();
    dispose();
    expect(handle.remove).toHaveBeenCalledTimes(1);
  });

  it('never reaches the plugin in the browser, and the disposer stays callable', async () => {
    mocks.isNative = false;
    const { onAppStateChange } = await importLifecycle();

    const dispose = await onAppStateChange(() => {});

    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });
});
