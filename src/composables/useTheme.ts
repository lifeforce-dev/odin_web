import { readonly, ref } from 'vue';

import { getPreference, setPreference } from '@/native';
import { DEFAULT_THEME, isThemeName, THEMES, type ThemeName } from '@/styles/contract';

const THEME_PREFERENCE_KEY = 'odin.theme';

// Module-level so every consumer shares one source of truth for the
// active theme; the DOM attribute and this ref always move together.
const activeTheme = ref<ThemeName>(DEFAULT_THEME);

function applyTheme(name: ThemeName): void {
  activeTheme.value = name;
  document.documentElement.dataset.theme = name;
}

// Called once at bootstrap. index.html ships data-theme="odin-dark"
// statically so the default renders with no unthemed flash; this only
// swaps the attribute when the user persisted a different choice. A
// stored name that no longer exists is ignored, keeping the default.
// Theme is cosmetic, so this never rejects: a failed preference read
// keeps the default rather than blocking boot.
export async function initTheme(): Promise<void> {
  let saved: string | null;
  try {
    saved = await getPreference(THEME_PREFERENCE_KEY);
  } catch (error) {
    console.warn('[odin] could not restore the persisted theme; using the default', error);
    return;
  }
  if (saved !== null && isThemeName(saved)) {
    applyTheme(saved);
  }
}

export function useTheme() {
  // The DOM swap always lands; persistence is best-effort, so callers can
  // fire-and-forget. A failed write only costs the choice on next launch.
  async function setTheme(name: ThemeName): Promise<void> {
    applyTheme(name);
    try {
      await setPreference(THEME_PREFERENCE_KEY, name);
    } catch (error) {
      console.warn('[odin] could not persist the theme choice; it resets on next launch', error);
    }
  }

  return { theme: readonly(activeTheme), themes: THEMES, setTheme };
}
