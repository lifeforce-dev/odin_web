import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

import { remainingSeconds } from '@/domain/rest-timer';

// Cosmetic glue over domain/rest-timer.ts: a 1s interval that only ever
// re-derives remaining-from-endsAt, never counts down on its own, so a
// frozen background webview resumes onto the correct digits. Re-derives
// on visibilitychange too, for the same reason on a tab/app switch that
// never fully suspends the interval. No native App-resume seam exists
// yet (src/native/lifecycle.ts has none); visibilitychange alone is the
// correct signal here.
export interface RestTimer {
  remaining: Ref<number>;
}

const TICK_MS = 1000;

// endsAt is null in final mode (no countdown) or before the first
// arrival read lands; remaining then parks at 0.
export function useRestTimer(endsAt: () => string | null): RestTimer {
  const remaining = ref(0);
  let intervalHandle: ReturnType<typeof setInterval> | undefined;

  function recompute(): void {
    const endsAtIso = endsAt();
    remaining.value = endsAtIso === null ? 0 : remainingSeconds(endsAtIso, Date.now());
  }

  function onVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      recompute();
    }
  }

  onMounted(() => {
    recompute();
    intervalHandle = setInterval(recompute, TICK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onBeforeUnmount(() => {
    clearInterval(intervalHandle);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  watch(endsAt, recompute);

  return { remaining };
}
