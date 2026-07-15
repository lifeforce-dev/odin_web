import type { DbClient } from '@/db/client';
import { getDb, isNative } from '@/native';

// The screens' database handle: null in browser dev mode, where there is
// no on-device SQLite (deliberate; see main.ts). Device-gated screens
// branch on the null and say so with DEVICE_ONLY_NOTE instead of
// pretending to have data.
export function useDb(): DbClient | null {
  return isNative ? getDb() : null;
}

// One copy string for every device-gated screen's unavailable note.
export const DEVICE_ONLY_NOTE = 'Data lives on the device // open the installed app';
