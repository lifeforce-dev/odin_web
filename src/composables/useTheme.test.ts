import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPreference = vi.fn<(key: string) => Promise<string | null>>();
const setPreference = vi.fn<(key: string, value: string) => Promise<void>>();

vi.mock('@/native', () => ({
  getPreference: (key: string) => getPreference(key),
  setPreference: (key: string, value: string) => setPreference(key, value),
}));

// useTheme holds module-level state, so each test gets a fresh module
// registry and a clean documentElement.
async function loadModule() {
  vi.resetModules();
  return import('./useTheme');
}

beforeEach(() => {
  getPreference.mockReset();
  setPreference.mockReset();
  delete document.documentElement.dataset.theme;
});

describe('useTheme', () => {
  it('setTheme applies the DOM attribute and persists the choice', async () => {
    setPreference.mockResolvedValue(undefined);
    const { useTheme } = await loadModule();

    await useTheme().setTheme('odin-dark');

    expect(document.documentElement.dataset.theme).toBe('odin-dark');
    expect(setPreference).toHaveBeenCalledWith('odin.theme', 'odin-dark');
  });

  it('initTheme applies a persisted valid theme, read from the same key setTheme writes', async () => {
    getPreference.mockResolvedValue('odin-dark');
    const { initTheme, useTheme } = await loadModule();

    await initTheme();

    // The key is a cross-session contract on user devices: a read/write
    // key split would silently stop restoring every persisted theme.
    expect(getPreference).toHaveBeenCalledWith('odin.theme');
    expect(document.documentElement.dataset.theme).toBe('odin-dark');
    expect(useTheme().theme.value).toBe('odin-dark');
  });

  it('initTheme resolves and keeps the default when the preference read fails', async () => {
    getPreference.mockRejectedValue(new Error('bridge unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { initTheme, useTheme } = await loadModule();

    // Theme is cosmetic: a rejection here would block boot in main.ts.
    await expect(initTheme()).resolves.toBeUndefined();

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(useTheme().theme.value).toBe('odin-dark');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('setTheme keeps the DOM swap and resolves when persistence fails', async () => {
    setPreference.mockRejectedValue(new Error('storage failure'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { useTheme } = await loadModule();

    // Callers fire-and-forget (the gallery discards the promise), so a
    // persist failure must not become an unhandled rejection.
    await expect(useTheme().setTheme('odin-dark')).resolves.toBeUndefined();

    expect(document.documentElement.dataset.theme).toBe('odin-dark');
    expect(useTheme().theme.value).toBe('odin-dark');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('initTheme ignores an unknown persisted theme name', async () => {
    getPreference.mockResolvedValue('theme-deleted-in-an-update');
    const { initTheme } = await loadModule();

    await initTheme();

    // The static default from index.html stays untouched.
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('initTheme leaves the default in place when nothing is persisted', async () => {
    getPreference.mockResolvedValue(null);
    const { initTheme, useTheme } = await loadModule();

    await initTheme();

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(useTheme().theme.value).toBe('odin-dark');
  });
});
