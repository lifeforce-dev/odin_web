import { onScopeDispose, reactive } from 'vue';

// The workbench drag session (task 02-04): pointer-follow ghost, the
// landing gap inside the circuit zone, and the two armed drop zones.
// WorkbenchSlot detects the drag (its tap-vs-drag threshold) and hands
// the live pointer here; this composable owns the document-level tracking
// from that moment to the drop. Screen geometry comes in through the
// measure callbacks so the decision logic stays testable without layout.

export interface SlotDragOptions {
  // Vertical midpoints of every non-dragged slot row, top to bottom.
  measureSlotMidpoints(draggedId: string): number[];
  // The pool zone's top edge: a slot released at or under it is removed.
  // Measured ONCE per drag, at begin(): the zone swap restructures the
  // list, so re-measuring per move would let our own state change move
  // the boundary and feed back into the zone test (a bistable oscillator
  // at the seam). Frozen geometry cannot loop.
  measurePoolTop(): number;
  onReorder(draggedId: string, insertAt: number): void;
  onRemove(draggedId: string): void;
}

export interface SlotDragState {
  draggingId: string | null;
  // The lifted card renders full-size at the grab point: ghostX/Y are the
  // card's top-left so the spot the thumb picked it up stays under the
  // thumb for the whole drag. The view renders the ghost's content; the
  // height also sizes the landing gap the list opens for it.
  ghostX: number;
  ghostY: number;
  ghostWidth: number;
  ghostHeight: number;
  // Index among the non-dragged slots where the landing gap opens (the
  // drop preview); null while the pool (remove) is armed.
  gapIndex: number | null;
  circuitArmed: boolean;
  poolArmed: boolean;
}

// Pure so the drop-position rule is unit-testable: insert before the
// first slot whose midpoint is below the pointer, else append.
export function insertionIndex(midpoints: number[], pointerY: number): number {
  const before = midpoints.findIndex((midpoint) => pointerY < midpoint);
  return before === -1 ? midpoints.length : before;
}

// Pure for the same reason: converts the drop preview (gap index counted
// among the NON-dragged rows) into the full ordered id list persistence
// expects. This is the off-by-one seam of the whole pipeline - splicing
// into the unfiltered list would shift every downward drop by one.
export function orderAfterDrop(
  orderedIds: string[],
  draggedId: string,
  gapIndex: number,
): string[] {
  const remaining = orderedIds.filter((id) => id !== draggedId);
  remaining.splice(gapIndex, 0, draggedId);
  return remaining;
}

export function useSlotDrag(options: SlotDragOptions) {
  const state = reactive<SlotDragState>({
    draggingId: null,
    ghostX: 0,
    ghostY: 0,
    ghostWidth: 0,
    ghostHeight: 0,
    gapIndex: null,
    circuitArmed: false,
    poolArmed: false,
  });

  // Where inside the source card the thumb grabbed it; keeps that point
  // under the thumb (not reactive - only ghostX/Y derive from it).
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  // The finger that lifted the card. Document-level listeners see every
  // pointer on the glass; a stray second touch must not steer the ghost,
  // end the session, or start a second one (multi-touch is an ordinary
  // accident on a phone, and this drag's drop can REMOVE a slot).
  let sessionPointerId: number | null = null;

  // The zone boundary, frozen at grab time (see measurePoolTop).
  let poolTopAtGrab = Number.POSITIVE_INFINITY;

  // Hysteresis (Schmitt trigger) on the zone seam: arm the pool AT the
  // boundary, disarm only after retreating this far back above it. A
  // thumb resting on a hard line has natural tremor; without the band
  // every wobble toggles the zones and replays the list restructure.
  const POOL_DISARM_SLACK_PX = 16;

  function begin(slotId: string, event: PointerEvent, sourceRect: DOMRect): void {
    if (state.draggingId !== null) {
      return;
    }
    state.draggingId = slotId;
    state.ghostWidth = sourceRect.width;
    state.ghostHeight = sourceRect.height;
    // Clamp the grab point into the card: the rect is measured after the
    // editor-close re-render, so a card that shifted up under the thumb
    // (an open editor above collapsed) would otherwise put the grab point
    // outside the card and ride the ghost visibly off the finger.
    grabOffsetX = Math.min(Math.max(event.clientX - sourceRect.left, 0), sourceRect.width);
    grabOffsetY = Math.min(Math.max(event.clientY - sourceRect.top, 0), sourceRect.height);
    sessionPointerId = event.pointerId;
    poolTopAtGrab = options.measurePoolTop();
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
    // Exactly one zone is armed at a time (STYLEGUIDE drop-zone rule):
    // a slot over the pool means remove; anywhere else targets the order.
    const overPool = state.poolArmed
      ? event.clientY >= poolTopAtGrab - POOL_DISARM_SLACK_PX
      : event.clientY >= poolTopAtGrab;
    state.poolArmed = overPool;
    state.circuitArmed = !overPool;
    state.gapIndex = overPool
      ? null
      : insertionIndex(options.measureSlotMidpoints(state.draggingId), event.clientY);
  }

  // The preview is the contract: release applies exactly the state the
  // user was shown, with NO re-track from the pointerup coordinates. A
  // lifting finger rolls its contact point a few px as it leaves the
  // glass, so the release event routinely lands off the held position -
  // re-tracking here shifted the insertion by a slot (a visible reshuffle
  // after letting go) and, near the seam, could even flip a reorder into
  // a remove.
  function drop(event: PointerEvent): void {
    const draggedId = state.draggingId;
    if (!draggedId || !isSessionPointer(event)) {
      return;
    }
    const removing = state.poolArmed;
    const insertAt = state.gapIndex;
    reset();
    if (removing) {
      options.onRemove(draggedId);
    } else if (insertAt !== null) {
      options.onReorder(draggedId, insertAt);
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
    state.circuitArmed = false;
    state.poolArmed = false;
    sessionPointerId = null;
  }

  onScopeDispose(reset);

  return { state, begin };
}
