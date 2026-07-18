import { beforeEach, describe, expect, it, vi } from 'vitest';

// notifications.ts is the one file that touches @capacitor/local-
// notifications, so its adapter contract lives here: the plugin schema
// mapping (absolute fireAt -> schedule.at, allowWhileIdle punch-through),
// the permission normalization, and the browser degrade that keeps the
// plugin unreached off-device. The plugin is fully mocked; these assert
// what the adapter asks of it, not the OS behavior.
const mocks = vi.hoisted(() => ({
  schedule: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
  getPending: vi.fn().mockResolvedValue({ notifications: [] }),
  registerActionTypes: vi.fn().mockResolvedValue(undefined),
  createChannel: vi.fn().mockResolvedValue(undefined),
  checkPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
  requestPermissions: vi.fn().mockResolvedValue({ display: 'granted' }),
  addListener: vi.fn(),
  isNative: true,
  isAndroid: true,
}));

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    schedule: mocks.schedule,
    cancel: mocks.cancel,
    getPending: mocks.getPending,
    registerActionTypes: mocks.registerActionTypes,
    createChannel: mocks.createChannel,
    checkPermissions: mocks.checkPermissions,
    requestPermissions: mocks.requestPermissions,
    addListener: mocks.addListener,
  },
}));

vi.mock('./platform', () => ({
  get isNative() {
    return mocks.isNative;
  },
  get isAndroid() {
    return mocks.isAndroid;
  },
}));

async function importAdapter(): Promise<typeof import('./notifications')> {
  return await import('./notifications');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.isNative = true;
  mocks.isAndroid = true;
  mocks.getPending.mockResolvedValue({ notifications: [] });
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' });
  mocks.requestPermissions.mockResolvedValue({ display: 'granted' });
});

describe('scheduleNotifications', () => {
  it('maps each notification to the plugin schema with an absolute idle-safe schedule', async () => {
    const { scheduleNotifications } = await importAdapter();
    const fireAt = new Date('2026-07-18T00:05:00Z');

    await scheduleNotifications([
      {
        id: 7,
        title: 'Rest complete',
        body: 'Next set',
        fireAt,
        actionTypeId: 'stretch',
        extra: { poseIndex: 2 },
      },
    ]);

    // objectContaining on the per-notification shape so an additive plugin
    // field the OS later needs (sound, smallIcon) doesn't break this test
    // with no behavior change. The schedule sub-object stays exact
    // (allowWhileIdle is the load-bearing Doze punch-through), and channelId
    // is pinned - it is what upgrades the alert to a heads-up banner.
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith({
      notifications: [
        expect.objectContaining({
          id: 7,
          title: 'Rest complete',
          body: 'Next set',
          schedule: { at: fireAt, allowWhileIdle: true },
          channelId: 'odin-timers',
          actionTypeId: 'stretch',
          extra: { poseIndex: 2 },
        }),
      ],
    });
  });

  it('never calls the plugin for an empty list', async () => {
    const { scheduleNotifications } = await importAdapter();
    await scheduleNotifications([]);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it('degrades to a no-op in the browser', async () => {
    mocks.isNative = false;
    const { scheduleNotifications } = await importAdapter();
    await scheduleNotifications([
      { id: 1, title: 't', body: 'b', fireAt: new Date('2026-07-18T00:00:00Z') },
    ]);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe('ensureNotificationChannel', () => {
  it('creates a HIGH-importance, lock-screen-public heads-up channel on Android', async () => {
    const { ensureNotificationChannel } = await importAdapter();

    await ensureNotificationChannel();

    expect(mocks.createChannel).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'odin-timers', importance: 4, visibility: 1 }),
    );
  });

  it('does nothing off Android (iOS has no channels, browser has no OS surface)', async () => {
    mocks.isAndroid = false;
    const { ensureNotificationChannel } = await importAdapter();

    await ensureNotificationChannel();

    expect(mocks.createChannel).not.toHaveBeenCalled();
  });
});

describe('cancelNotifications', () => {
  it('maps ids to descriptors', async () => {
    const { cancelNotifications } = await importAdapter();
    await cancelNotifications([1, 2]);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({
      notifications: [{ id: 1 }, { id: 2 }],
    });
  });

  it('never calls the plugin for an empty list', async () => {
    const { cancelNotifications } = await importAdapter();
    await cancelNotifications([]);
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});

describe('getPendingNotificationIds', () => {
  it('projects the pending schemas down to ids', async () => {
    mocks.getPending.mockResolvedValue({ notifications: [{ id: 1 }, { id: 9 }] });
    const { getPendingNotificationIds } = await importAdapter();
    expect(await getPendingNotificationIds()).toEqual([1, 9]);
  });

  it('returns nothing in the browser without reaching the plugin', async () => {
    mocks.isNative = false;
    const { getPendingNotificationIds } = await importAdapter();
    expect(await getPendingNotificationIds()).toEqual([]);
    expect(mocks.getPending).not.toHaveBeenCalled();
  });
});

describe('permission', () => {
  it('normalizes both prompt states to prompt and passes the rest through', async () => {
    const { checkNotificationPermission } = await importAdapter();

    for (const [display, expected] of [
      ['granted', 'granted'],
      ['denied', 'denied'],
      ['prompt', 'prompt'],
      ['prompt-with-rationale', 'prompt'],
    ] as const) {
      mocks.checkPermissions.mockResolvedValueOnce({ display });
      expect(await checkNotificationPermission()).toBe(expected);
    }
  });

  it('reports denied in the browser without asking the plugin', async () => {
    mocks.isNative = false;
    const { checkNotificationPermission } = await importAdapter();
    expect(await checkNotificationPermission()).toBe('denied');
    expect(mocks.checkPermissions).not.toHaveBeenCalled();
  });
});

describe('onNotificationAction', () => {
  it('flattens the plugin event and disposes the listener', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mocks.addListener.mockResolvedValue({ remove });
    const { onNotificationAction } = await importAdapter();
    const handler = vi.fn();

    const dispose = await onNotificationAction(handler);
    const [eventName, pluginListener] = mocks.addListener.mock.calls[0] as [
      string,
      (event: { actionId: string; notification: { id: number; extra?: unknown } }) => void,
    ];
    expect(eventName).toBe('localNotificationActionPerformed');

    pluginListener({ actionId: 'skip', notification: { id: 3, extra: { poseIndex: 1 } } });
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      actionId: 'skip',
      notificationId: 3,
      extra: { poseIndex: 1 },
    });

    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('is an inert disposer in the browser', async () => {
    mocks.isNative = false;
    const { onNotificationAction } = await importAdapter();
    const dispose = await onNotificationAction(vi.fn());
    expect(mocks.addListener).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });
});
