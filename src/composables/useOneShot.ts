import { onScopeDispose } from 'vue';

// A single-slot one-shot timer: set() always cancels the pending shot
// first, so the slot can never orphan a stale callback, and scope
// disposal cancels whatever is left. One slot per concern - create
// another instance rather than sharing one. Gesture state machines
// (hold-to-ramp, press-and-hold) are NOT one-shots; they keep their
// own timers.
export function useOneShot() {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function set(callback: () => void, delayMs: number): void {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, delayMs);
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  onScopeDispose(cancel);

  return { set, cancel };
}
