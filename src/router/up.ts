import { onUnmounted } from 'vue';
import type { Router, RouteLocationNormalizedLoaded, RouteLocationRaw } from 'vue-router';

import { isNative, minimizeApp } from '@/native';

// The one structural up-map consumer: every route declares its
// destination in meta.upTo, and this file is the only place that reads
// it. Hardware back and NavUpRow both funnel through goUp - neither
// walks router history.
declare module 'vue-router' {
  interface RouteMeta {
    upTo?: RouteLocationRaw | ((route: RouteLocationNormalizedLoaded) => RouteLocationRaw);
    upLabel?: string;
  }
}

// Unwraps the function form with the CURRENT route (the rest route's
// exerciseId param). Null means no structural up exists (home, gallery).
export function resolveUpTo(route: RouteLocationNormalizedLoaded): RouteLocationRaw | null {
  const { upTo } = route.meta;
  if (!upTo) {
    return null;
  }
  return typeof upTo === 'function' ? upTo(route) : upTo;
}

type UpOverrideHandler = () => void | Promise<void>;

let upOverride: UpOverrideHandler | null = null;

// The single override slot: a screen with destructive back semantics
// (rest's rollback) registers here and goUp runs it INSTEAD of the
// structural map. The dispose only clears the slot if it still holds
// THIS handler - mount/unmount order across a route swap is not
// guaranteed, so a late unmount must never clear a handler a newer
// screen already installed.
export function setUpOverride(handler: UpOverrideHandler): () => void {
  upOverride = handler;
  return () => {
    if (upOverride === handler) {
      upOverride = null;
    }
  };
}

export function useUpOverride(handler: UpOverrideHandler): void {
  const dispose = setUpOverride(handler);
  onUnmounted(dispose);
}

// THE up entry: hardware back and NavUpRow both call this, never
// router.back() or raw history. An override wins outright; otherwise
// the structural map replaces (never pushes, so up cannot grow the
// history it exists to replace); with neither, only a native shell can
// minimize - the adapter's minimizeApp rejects loudly on web by design,
// so this branch is a deliberate no-op there.
export function goUp(router: Router): void {
  if (upOverride) {
    // The handler runs synchronously (op ordering downstream depends on
    // it) but its settlement is watched: a future destructive-back
    // screen that rejects must fail on the log, not into the void.
    Promise.resolve(upOverride()).catch((error: unknown) =>
      console.error('[odin] up override failed', error),
    );
    return;
  }
  const resolved = resolveUpTo(router.currentRoute.value);
  if (resolved) {
    void router.replace(resolved);
    return;
  }
  if (isNative) {
    minimizeApp().catch((error: unknown) => console.error('[odin] minimize failed', error));
  }
}
