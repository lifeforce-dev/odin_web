import { onScopeDispose, reactive } from 'vue';

import { insertionIndex } from './useWorkbenchDrag';

// The circuits screen's rotation-queue drag session: the workbench
// drag's session discipline (pointerId capture, grab-point-clamped
// ghost, the release-roll rule) with no zones, no delete target, no library - a
// single vertical list has nowhere else to drop. Reuses
// useWorkbenchDrag's pure insertionIndex; orderAfterDrop is applied by
// the caller (the view maps onDrop's gap into manager.reorder).

export interface QueueDragOptions {
  // Vertical midpoints of every non-dragged row, top to bottom.
  measureMidpoints(draggedId: string): number[];
  onDrop(draggedId: string, insertAt: number): void;
}

export interface QueueDragState {
  draggingId: string | null;
  // The lifted row renders full-size at the grab point: ghostX/Y are the
  // row's top-left so the spot the thumb picked it up stays under the
  // thumb for the whole drag.
  ghostX: number;
  ghostY: number;
  ghostWidth: number;
  ghostHeight: number;
  // Index among the non-dragged rows where the landing gap opens (the
  // drop preview); null only before the first move.
  gapIndex: number | null;
}

export function useQueueDrag(options: QueueDragOptions) {
  const state = reactive<QueueDragState>({
    draggingId: null,
    ghostX: 0,
    ghostY: 0,
    ghostWidth: 0,
    ghostHeight: 0,
    gapIndex: null,
  });

  // Where inside the source row the thumb grabbed it; keeps that point
  // under the thumb (not reactive - only ghostX/Y derive from it).
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  // The finger that lifted the row. Document-level listeners see every
  // pointer on the glass; a stray second touch must not steer the ghost
  // or end the session.
  let sessionPointerId: number | null = null;

  function begin(id: string, event: PointerEvent, sourceRect: DOMRect): void {
    if (state.draggingId !== null) {
      return;
    }
    state.draggingId = id;
    state.ghostWidth = sourceRect.width;
    state.ghostHeight = sourceRect.height;
    grabOffsetX = Math.min(Math.max(event.clientX - sourceRect.left, 0), sourceRect.width);
    grabOffsetY = Math.min(Math.max(event.clientY - sourceRect.top, 0), sourceRect.height);
    sessionPointerId = event.pointerId;
    document.addEventListener('pointermove', track);
    document.addEventListener('pointerup', drop);
    document.addEventListener('pointercancel', cancel);
    track(event);
  }

  function isSessionPointer(event: PointerEvent): boolean {
    return event.pointerId === sessionPointerId;
  }

  function track(event: PointerEvent): void {
    if (!state.draggingId || !isSessionPointer(event)) {
      return;
    }
    state.ghostX = event.clientX - grabOffsetX;
    state.ghostY = event.clientY - grabOffsetY;
    state.gapIndex = insertionIndex(options.measureMidpoints(state.draggingId), event.clientY);
  }

  // The preview is the contract: release applies exactly the gap the
  // user was shown, with NO re-track from the pointerup coordinates
  // (the release-roll rule - see useWorkbenchDrag's drop() for why).
  // Releasing outside the list still commits the last previewed gap:
  // single-zone semantics, there is nowhere else to drop.
  function drop(event: PointerEvent): void {
    const draggedId = state.draggingId;
    if (!draggedId || !isSessionPointer(event)) {
      return;
    }
    const insertAt = state.gapIndex;
    reset();
    if (insertAt !== null) {
      options.onDrop(draggedId, insertAt);
    }
  }

  function cancel(event: PointerEvent): void {
    if (!isSessionPointer(event)) {
      return;
    }
    reset();
  }

  function reset(): void {
    document.removeEventListener('pointermove', track);
    document.removeEventListener('pointerup', drop);
    document.removeEventListener('pointercancel', cancel);
    state.draggingId = null;
    state.gapIndex = null;
    sessionPointerId = null;
  }

  onScopeDispose(reset);

  return { state, begin };
}
