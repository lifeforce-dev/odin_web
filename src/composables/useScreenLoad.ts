import { onMounted, ref } from 'vue';
import type { Ref } from 'vue';

// The flow screens' shared load-state machine: refresh() runs the
// screen's loader into its own refs; the twin flags gate the template
// (loadFailed renders a Retry note - a failed read must fail on the
// screen, not only in the log). One home, so the retry policy and error
// logging are a one-edit change. The workbench's richer status enum is
// deliberately not this: its reads ride the serialized write chain.
export interface ScreenLoad {
  hasLoaded: Ref<boolean>;
  loadFailed: Ref<boolean>;
  refresh: () => Promise<void>;
  settled: () => Promise<void>;
}

export function useScreenLoad(screenLabel: string, load: () => Promise<void>): ScreenLoad {
  const hasLoaded = ref(false);
  const loadFailed = ref(false);

  // The latest started refresh, mount load included. settled() lets a
  // caller whose decision depends on the loaded facts (rest's rollback)
  // wait out an in-flight read instead of acting on a stale null;
  // refresh never rejects, so awaiting it is always safe.
  let latest: Promise<void> = Promise.resolve();

  async function runLoad(): Promise<void> {
    try {
      await load();
      hasLoaded.value = true;
      loadFailed.value = false;
    } catch (error) {
      console.error(`[odin] ${screenLabel} load failed`, error);
      loadFailed.value = true;
    }
  }

  function refresh(): Promise<void> {
    latest = runLoad();
    return latest;
  }

  onMounted(() => {
    void refresh();
  });

  return { hasLoaded, loadFailed, refresh, settled: () => latest };
}
