import { beforeEach, describe, expect, it, vi } from 'vitest';

// The permission gate's contract: educate ONCE, only when the OS will
// still ask, and never nag. The native adapter is mocked so these assert
// the gating decisions (show / stay silent / mark seen), not the OS.
const mocks = vi.hoisted(() => ({
  isNative: true,
  checkNotificationPermission: vi.fn().mockResolvedValue('prompt'),
  requestNotificationPermission: vi.fn().mockResolvedValue('granted'),
  getPreference: vi.fn().mockResolvedValue(null),
  setPreference: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/native', () => ({
  get isNative() {
    return mocks.isNative;
  },
  checkNotificationPermission: mocks.checkNotificationPermission,
  requestNotificationPermission: mocks.requestNotificationPermission,
  getPreference: mocks.getPreference,
  setPreference: mocks.setPreference,
}));

// Module-level singleton state, so a fresh import per test.
async function importModule(): Promise<typeof import('./useNotificationPermission')> {
  return await import('./useNotificationPermission');
}

const COPY = { headline: 'Know when rest is over', body: 'Get a heads-up at 0:00.' };

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.isNative = true;
  mocks.checkNotificationPermission.mockResolvedValue('prompt');
  mocks.requestNotificationPermission.mockResolvedValue('granted');
  mocks.getPreference.mockResolvedValue(null);
});

describe('ensureNotificationPermission', () => {
  it('shows the primer with the given copy when the OS will still ask and it was never seen', async () => {
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();
    const primer = useNotificationPrimer();

    await ensureNotificationPermission(COPY);

    expect(primer.visible.value).toBe(true);
    expect(primer.copy.value).toEqual(COPY);
  });

  it('stays silent when permission is already granted', async () => {
    mocks.checkNotificationPermission.mockResolvedValue('granted');
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();

    await ensureNotificationPermission(COPY);

    expect(useNotificationPrimer().visible.value).toBe(false);
  });

  it('stays silent when permission was denied - the OS will not re-prompt', async () => {
    mocks.checkNotificationPermission.mockResolvedValue('denied');
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();

    await ensureNotificationPermission(COPY);

    expect(useNotificationPrimer().visible.value).toBe(false);
  });

  it('stays silent once the primer has already been seen', async () => {
    mocks.getPreference.mockResolvedValue('true');
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();

    await ensureNotificationPermission(COPY);

    expect(useNotificationPrimer().visible.value).toBe(false);
  });

  it('stays silent off-device without reading permission at all', async () => {
    mocks.isNative = false;
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();

    await ensureNotificationPermission(COPY);

    expect(useNotificationPrimer().visible.value).toBe(false);
    expect(mocks.checkNotificationPermission).not.toHaveBeenCalled();
  });
});

describe('primer resolution', () => {
  it('enable hides the dialog, marks it seen, and fires the OS request', async () => {
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();
    const primer = useNotificationPrimer();
    await ensureNotificationPermission(COPY);

    await primer.enable();

    expect(primer.visible.value).toBe(false);
    expect(mocks.setPreference).toHaveBeenCalledExactlyOnceWith(
      'odin.notifications.primer-seen',
      'true',
    );
    expect(mocks.requestNotificationPermission).toHaveBeenCalledTimes(1);
  });

  it('dismiss hides the dialog and marks it seen without any OS request', async () => {
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();
    const primer = useNotificationPrimer();
    await ensureNotificationPermission(COPY);

    await primer.dismiss();

    expect(primer.visible.value).toBe(false);
    expect(mocks.setPreference).toHaveBeenCalledExactlyOnceWith(
      'odin.notifications.primer-seen',
      'true',
    );
    expect(mocks.requestNotificationPermission).not.toHaveBeenCalled();
  });

  it('does not re-open while already visible (no double prompt)', async () => {
    const { ensureNotificationPermission, useNotificationPrimer } = await importModule();
    const primer = useNotificationPrimer();

    await ensureNotificationPermission(COPY);
    await ensureNotificationPermission({ headline: 'other', body: 'other' });

    // The first copy stands; the second call was a no-op.
    expect(primer.copy.value).toEqual(COPY);
    expect(mocks.checkNotificationPermission).toHaveBeenCalledTimes(1);
  });
});
