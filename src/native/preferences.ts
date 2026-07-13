import { Preferences } from '@capacitor/preferences';

// Thin adapter over @capacitor/preferences for tiny KV settings (theme
// choice and the like; anything relational belongs in the database). The
// plugin's web implementation is backed by localStorage, so browser dev
// mode works without a fallback branch.

export async function getPreference(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value;
}

export async function setPreference(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}
