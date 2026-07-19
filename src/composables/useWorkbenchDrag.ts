import { computed, onScopeDispose, reactive } from 'vue';

// The workbench drag session: pointer-follow ghost, the landing gap
// inside the circuit zone, and the armed drop zones. One behavior for
// both origins; only the drop outcome depends on where the card came
// from: over the circuit the gap previews the position (reorder or
// add), over the library a circuit card is removed and a library card put
// back, over the delete target the workout is deleted entirely. The row's grip
// detects the lift (useDragHandle) and hands the live pointer here;
// this composable owns the document-level tracking from that moment to
// the drop. Screen geometry comes in through the measure callbacks so
// the decision logic stays testable without layout.

export type WorkbenchDragOrigin = 'circuit' | 'library';

// The action a delete-target drop performs is still "trash the workout",
// which is why the callback and the domain verb keep that word.
export type WorkbenchDragZone = 'circuit' | 'library' | 'delete';

export interface WorkbenchDragOptions {
  // Vertical midpoints of every non-dragged circuit card, top to bottom.
  // (A library card's id matches no circuit card, so every card measures.)
  measureSlotMidpoints(draggedId: string): number[];
  // The library zone's top edge and the delete target's top edge. Measured
  // ONCE per drag, at begin(): the zone swap restructures the list, so
  // re-measuring per move would let our own state change move a boundary
  // and feed back into the zone test (a bistable oscillator at the
  // boundary). Frozen geometry cannot loop.
  measureLibraryTop(): number;
  measureDeleteTop(): number;
  onReorder(draggedId: string, insertAt: number): void;
  onRemove(draggedId: string): void;
  // A library card dropped over the circuit: add (or steal) at the gap.
  onAdd(exerciseId: string, insertAt: number): void;
  // Any card dropped on the delete target: delete the workout entirely.
  onTrash(exerciseId: string): void;
}

export interface WorkbenchDragState {
  origin: WorkbenchDragOrigin | null;
  draggingId: string | null;
  // The lifted card renders full-size at the grab point: ghostX/Y are the
  // card's top-left so the spot the thumb picked it up stays under the
  // thumb for the whole drag. The view renders the ghost's content; the
  // height also sizes the landing gap the list opens for it.
  ghostX: number;
  ghostY: number;
  ghostWidth: number;
  ghostHeight: number;
  // Index among the non-dragged circuit cards where the landing gap
  // opens (the drop preview); null unless the circuit is the armed zone.
  gapIndex: number | null;
  circuitArmed: boolean;
  libraryArmed: boolean;
  deleteArmed: boolean;
}

// Pure so the drop-position rule is unit-testable: insert before the
// first card whose midpoint is below the pointer, else append.
export function insertionIndex(midpoints: number[], pointerY: number): number {
  const before = midpoints.findIndex((midpoint) => pointerY < midpoint);
  return before === -1 ? midpoints.length : before;
}

// Pure for the same reason: converts the drop preview (gap index counted
// among the NON-dragged rows) into the full ordered id list persistence
// expects. This is the off-by-one hazard of the whole pipeline - splicing
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

export function useWorkbenchDrag(options: WorkbenchDragOptions) {
  const state = reactive<WorkbenchDragState>({
    origin: null,
    draggingId: null,
    ghostX: 0,
    ghostY: 0,
    ghostWidth: 0,
    ghostHeight: 0,
    gapIndex: null,
    circuitArmed: false,
    libraryArmed: false,
    deleteArmed: false,
  });

  // The one-armed-zone invariant as a single observable: which zone
  // the drop would land in right now, null when nothing is lifted.
  const armedZone = computed<WorkbenchDragZone | null>(() => {
    if (state.draggingId === null) {
      return null;
    }
    if (state.deleteArmed) {
      return 'delete';
    }
    return state.libraryArmed ? 'library' : 'circuit';
  });

  // Where inside the source card the thumb grabbed it; keeps that point
  // under the thumb (not reactive - only ghostX/Y derive from it).
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  // The finger that lifted the card. Document-level listeners see every
  // pointer on the screen; a stray second touch must not steer the ghost,
  // end the session, or start a second one (multi-touch is an ordinary
  // accident on a phone, and this drag's drop can DELETE a workout).
  let sessionPointerId: number | null = null;

  // The zone boundaries, frozen at grab time (see the measure options).
  let libraryTopAtGrab = Number.POSITIVE_INFINITY;
  let deleteTopAtGrab = Number.POSITIVE_INFINITY;

  // Hysteresis (Schmitt trigger) at each zone boundary: arm AT the line,
  // disarm only after retreating this far back above it. A thumb resting
  // on a hard line has natural tremor; without the band every wobble
  // toggles the zones and replays the list restructure.
  const BOUNDARY_SLACK_PX = 16;

  function begin(
    origin: WorkbenchDragOrigin,
    id: string,
    event: PointerEvent,
    sourceRect: DOMRect,
  ): void {
    if (state.draggingId !== null) {
      return;
    }
    state.origin = origin;
    state.draggingId = id;
    state.ghostWidth = sourceRect.width;
    state.ghostHeight = sourceRect.height;
    // Clamp the grab point into the card: the rect is measured after the
    // editor-close re-render, so a card that shifted up under the thumb
    // (an open editor above collapsed) would otherwise put the grab point
    // outside the card and ride the ghost visibly off the finger.
    grabOffsetX = Math.min(Math.max(event.clientX - sourceRect.left, 0), sourceRect.width);
    grabOffsetY = Math.min(Math.max(event.clientY - sourceRect.top, 0), sourceRect.height);
    sessionPointerId = event.pointerId;
    libraryTopAtGrab = options.measureLibraryTop();
    deleteTopAtGrab = options.measureDeleteTop();
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
    // Exactly one zone is armed at a time, tested bottom-up: the
    // delete target, then the library, else the circuit.
    const y = event.clientY;
    const overDelete = state.deleteArmed
      ? y >= deleteTopAtGrab - BOUNDARY_SLACK_PX
      : y >= deleteTopAtGrab;
    const overLibrary =
      !overDelete &&
      (state.libraryArmed ? y >= libraryTopAtGrab - BOUNDARY_SLACK_PX : y >= libraryTopAtGrab);
    state.deleteArmed = overDelete;
    state.libraryArmed = overLibrary;
    state.circuitArmed = !overDelete && !overLibrary;
    state.gapIndex = state.circuitArmed
      ? insertionIndex(options.measureSlotMidpoints(state.draggingId), y)
      : null;
  }

  // The preview is the contract: release applies exactly the state the
  // user was shown, with NO re-track from the pointerup coordinates. A
  // lifting finger rolls its contact point a few px as it leaves the
  // screen, so the release event routinely lands off the held position -
  // re-tracking here shifted the insertion by a slot (a visible reshuffle
  // after letting go) and, near a boundary, could even flip a reorder into
  // a remove.
  function drop(event: PointerEvent): void {
    const draggedId = state.draggingId;
    if (!draggedId || !isSessionPointer(event)) {
      return;
    }
    const origin = state.origin;
    const trashing = state.deleteArmed;
    const droppingInLibrary = state.libraryArmed;
    const insertAt = state.gapIndex;
    reset();
    if (trashing) {
      options.onTrash(draggedId);
      return;
    }
    if (droppingInLibrary) {
      // A circuit card released over the library leaves the circuit; a library
      // card is simply put back where it never stopped being.
      if (origin === 'circuit') {
        options.onRemove(draggedId);
      }
      return;
    }
    if (insertAt !== null) {
      if (origin === 'circuit') {
        options.onReorder(draggedId, insertAt);
      } else {
        options.onAdd(draggedId, insertAt);
      }
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
    state.origin = null;
    state.draggingId = null;
    state.gapIndex = null;
    state.circuitArmed = false;
    state.libraryArmed = false;
    state.deleteArmed = false;
    sessionPointerId = null;
  }

  onScopeDispose(reset);

  return { state, begin, armedZone };
}
