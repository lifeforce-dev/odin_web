import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';

import { minimizeApp, onHardwareBackButton } from '@/native';

import { installHardwareBack } from './hardware-back';

const nativeState = { isNative: true };

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  minimizeApp: vi.fn().mockResolvedValue(undefined),
  onHardwareBackButton: vi.fn().mockResolvedValue(undefined),
}));

function makeRouter(meta: Record<string, unknown> = {}): Router {
  return {
    currentRoute: { value: { meta } },
    replace: vi.fn().mockResolvedValue(undefined),
    back: vi.fn(),
  } as unknown as Router;
}

// Registers through the mocked adapter and returns the handler it was
// given, so each test can drive a hardware back press directly.
async function registeredHandler(router: Router): Promise<(canGoBack: boolean) => void> {
  await installHardwareBack(router);
  const register = vi.mocked(onHardwareBackButton);
  expect(register).toHaveBeenCalledTimes(1);
  return register.mock.calls[0][0];
}

describe('installHardwareBack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeState.isNative = true;
  });

  it('replaces to the structural map destination and never calls router.back', async () => {
    const router = makeRouter({ upTo: { name: 'home' } });
    const handler = await registeredHandler(router);

    handler(true);

    expect(router.replace).toHaveBeenCalledExactlyOnceWith({ name: 'home' });
    expect(router.back).not.toHaveBeenCalled();
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it('minimizes at a route with no upTo instead of walking history', async () => {
    const router = makeRouter();
    const handler = await registeredHandler(router);

    handler(false);

    expect(minimizeApp).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('ignores canGoBack: a mapped route still replaces regardless of the flag', async () => {
    const router = makeRouter({ upTo: { name: 'home' } });
    const handler = await registeredHandler(router);

    handler(false);

    expect(router.replace).toHaveBeenCalledExactlyOnceWith({ name: 'home' });
    expect(router.back).not.toHaveBeenCalled();
  });

  it('ignores canGoBack: a route with no upTo still minimizes even when true (kills the lift<->rest ping-pong)', async () => {
    const router = makeRouter();
    const handler = await registeredHandler(router);

    handler(true);

    expect(minimizeApp).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
