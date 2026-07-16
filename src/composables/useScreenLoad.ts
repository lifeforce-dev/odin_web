import { onMounted, ref } from 'vue';
import type { Ref } from 'vue';

// The flow screens' shared load-state machine: refresh() runs the
// screen's loader into its own refs; the twin flags gate the template
// (loadFailed renders a Retry note - a failed read must fail on the
// glass, not only in the log). One home, so the retry policy and error
// logging are a one-edit change. The workbench's richer status enum is
// deliberately not this: its reads ride the serialized write chain.
export interface ScreenLoad {
  hasLoaded: Ref<boolean>;
  loadFailed: Ref<boolean>;
  refresh: () => Promise<void>;
}

export function useScreenLoad(screenLabel: string, load: () => Promise<void>): ScreenLoad {
  const hasLoaded = ref(false);
  const loadFailed = ref(false);

  async function refresh(): Promise<void> {
    try {
      await load();
      hasLoaded.value = true;
      loadFailed.value = false;
    } catch (error) {
      console.error(`[odin] ${screenLabel} load failed`, error);
      loadFailed.value = true;
    }
  }

  onMounted(() => {
    void refresh();
  });

  return { hasLoaded, loadFailed, refresh };
}
