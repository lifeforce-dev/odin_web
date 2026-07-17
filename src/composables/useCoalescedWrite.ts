import { ref } from 'vue';
import type { Ref } from 'vue';

// The app-wide single-flight policy for screen mutations: the shared
// connection runs one transaction at a time (src/native/database.ts),
// so a re-tap while the write is in flight JOINS the pending promise
// instead of racing a second BEGIN. A thrown write logs, flips
// `failed` so the screen can render it, and resolves null; the next
// fresh run clears the flag.
export interface CoalescedWrite<T> {
  failed: Ref<boolean>;
  run: () => Promise<T | null>;
}

export function useCoalescedWrite<T>(
  label: string,
  write: () => Promise<T | null>,
): CoalescedWrite<T> {
  const failed = ref(false);
  let pending: Promise<T | null> | null = null;

  function run(): Promise<T | null> {
    if (pending) {
      return pending;
    }
    failed.value = false;
    pending = (async () => {
      try {
        return await write();
      } catch (error) {
        console.error(`[odin] ${label} failed`, error);
        failed.value = true;
        return null;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  return { failed, run };
}
