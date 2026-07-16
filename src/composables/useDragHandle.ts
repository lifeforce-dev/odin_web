import { onScopeDispose } from 'vue';

// The grip's press-to-drag decision (task 02-07): every draggable row's
// grip (the dot grid) is the ONLY drag surface. Grips carry
// touch-action: none, so the browser never contests a gesture that
// starts there; row bodies keep native panning and fold open on click.
// A press that travels past the threshold lifts the row (onDragStart
// hands the live pointer to the drag session); a press that releases
// without travelling means nothing - a grip has no tap meaning.
// Replaces both 02-04's whole-head handle and 02-05's hold-to-lift
// (owner device feedback: with any row surface draggable, scrolling a
// full list was nearly impossible).

export const DRAG_THRESHOLD_PX = 10;

export interface DragHandleOptions {
  onDragStart(event: PointerEvent): void;
}

export function useDragHandle(options: DragHandleOptions) {
  // The pressing finger. Document-level listeners hear EVERY pointer on
  // the glass (feature rule): all tracking filters to this id, and a new
  // press is refused while one is live.
  let pressPointerId: number | null = null;
  let pressOrigin: { x: number; y: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    if (pressPointerId !== null) {
      return;
    }
    pressPointerId = event.pointerId;
    pressOrigin = { x: event.clientX, y: event.clientY };
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!pressOrigin || event.pointerId !== pressPointerId) {
      return;
    }
    const travelled = Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y);
    if (travelled < DRAG_THRESHOLD_PX) {
      return;
    }
    releaseTracking();
    options.onDragStart(event);
  }

  function release(event: PointerEvent): void {
    if (event.pointerId !== pressPointerId) {
      return;
    }
    releaseTracking();
  }

  function releaseTracking(): void {
    pressPointerId = null;
    pressOrigin = null;
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', release);
    document.removeEventListener('pointercancel', release);
  }

  onScopeDispose(releaseTracking);

  return { onPointerDown };
}
