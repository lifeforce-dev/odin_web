import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'vue-router';

import { minimizeApp, onHardwareBackButton } from '@/native';

import { installHardwareBack } from './hardware-back';

vi.mock('@/native', () => ({
  minimizeApp: vi.fn().mockResolvedValue(undefined),
  onHardwareBackButton: vi.fn().mockResolvedValue(undefined),
}));

function makeRouter(): Router {
  return { back: vi.fn() } as unknown as Router;
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
  });

  it('pops router history while there is somewhere to go back to', async () => {
    const router = makeRouter();
    const handler = await registeredHandler(router);

    handler(true);

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it('minimizes at the root of the stack instead of exiting dead', async () => {
    const router = makeRouter();
    const handler = await registeredHandler(router);

    handler(false);

    expect(minimizeApp).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });
});
