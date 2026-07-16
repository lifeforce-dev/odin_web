import { computed, onScopeDispose, reactive } from 'vue';

// The workbench drag session (tasks 02-04/02-05/02-07): pointer-follow
// ghost, the landing gap inside the circuit zone, and the armed drop
// zones. ONE behavior for both origins - the zones read identically
// whichever list the card was lifted from; only the drop OUTCOME
// depends on where it came from:
//   over the circuit -> the landing gap previews the position
//     (a circuit card reorders there, a pool card is added there);
//   over the pool -> the card goes to (or stays in) the pool
//     (a circuit card is removed from the circuit, a pool card is
//     simply put back);
//   over the forge (the create slot at the pool's bottom, STYLEGUIDE
//     section 9) -> the workout is deleted entirely, wherever it came
//     from.
// The row's grip detects the lift (useDragHandle; grips are the only
// drag surface and alone carry touch-action: none, so the browser never
// contests the gesture) and hands the live pointer here; this composable
// owns the document-level tracking from that moment to the drop. Screen
// geometry comes in through the measure callbacks so the decision logic
// stays testable without layout.

export type WorkbenchDragOrigin = 'circuit' | 'pool';

// 'forge' is the canonical name for the delete target (STYLEGUIDE
// section 9); the ACTION a forge drop performs is still "trash the
// workout", which is why the callback below and the domain verb keep
// that word.
export type WorkbenchDragZone = 'circuit' | 'pool' | 'forge';

export interface WorkbenchDragOptions {
  // Vertical midpoints of every non-dragged circuit card, top to bottom.
  // (A pool card's id matches no circuit card, so every card measures.)
  measureSlotMidpoints(draggedId: string): number[];
  // The pool zone's top edge and the forge target's top edge. Measured
  // ONCE per drag, at begin(): the zone swap restructures the list, so
  // re-measuring per move would let our own state change move a boundary
  // and feed back into the zone test (a bistable oscillator at the
  // seam). Frozen geometry cannot loop.
  measurePoolTop(): number;
  measureForgeTop(): number;
  onReorder(draggedId: string, insertAt: number): void;
  onRemove(draggedId: string): void;
  // A pool card dropped over the circuit: add (or steal) at the gap.
  onAdd(exerciseId: string, insertAt: number): void;
  // Any card dropped on the forge: delete the workout entirely.
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
  poolArmed: boolean;
  forgeArmed: boolean;
}

// Pure so the drop-position rule is unit-testable: insert before the
// first card whose midpoint is below the pointer, else append.
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
    poolArmed: false,
    forgeArmed: false,
  });

  // The one-armed-zone invariant as a single observable: which zone the
  // drop would land in right now, null when nothing is lifted. The view
  // keys the relight off it and watches it for the seam-crossing tick
  // (crossing-tick pick, 2026-07-16); a future haptic rides the same
  // transitions.
  const armedZone = computed<WorkbenchDragZone | null>(() => {
    if (state.draggingId === null) {
      return null;
    }
    if (state.forgeArmed) {
      return 'forge';
    }
    return state.poolArmed ? 'pool' : 'circuit';
  });

  // Where inside the source card the thumb grabbed it; keeps that point
  // under the thumb (not reactive - only ghostX/Y derive from it).
  let grabOffsetX = 0;
  let grabOffsetY = 0;

  // The finger that lifted the card. Document-level listeners see every
  // pointer on the glass; a stray second touch must not steer the ghost,
  // end the session, or start a second one (multi-touch is an ordinary
  // accident on a phone, and this drag's drop can DELETE a workout).
  let sessionPointerId: number | null = null;

  // The zone boundaries, frozen at grab time (see the measure options).
  let poolTopAtGrab = Number.POSITIVE_INFINITY;
  let forgeTopAtGrab = Number.POSITIVE_INFINITY;

  // Hysteresis (Schmitt trigger) on each zone seam: arm AT the boundary,
  // disarm only after retreating this far back above it. A thumb resting
  // on a hard line has natural tremor; without the band every wobble
  // toggles the zones and replays the list restructure.
  const SEAM_SLACK_PX = 16;

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
    poolTopAtGrab = options.measurePoolTop();
    forgeTopAtGrab = options.measureForgeTop();
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
    // Exactly one zone is armed at a time (STYLEGUIDE drop-zone rule),
    // bottom-up: the forge, then the pool, else the circuit.
    const y = event.clientY;
    const overForge = state.forgeArmed ? y >= forgeTopAtGrab - SEAM_SLACK_PX : y >= forgeTopAtGrab;
    const overPool =
      !overForge && (state.poolArmed ? y >= poolTopAtGrab - SEAM_SLACK_PX : y >= poolTopAtGrab);
    state.forgeArmed = overForge;
    state.poolArmed = overPool;
    state.circuitArmed = !overForge && !overPool;
    state.gapIndex = state.circuitArmed
      ? insertionIndex(options.measureSlotMidpoints(state.draggingId), y)
      : null;
  }

  // The preview is the contract: release applies exactly the state the
  // user was shown, with NO re-track from the pointerup coordinates. A
  // lifting finger rolls its contact point a few px as it leaves the
  // glass, so the release event routinely lands off the held position -
  // re-tracking here shifted the insertion by a slot (a visible reshuffle
  // after letting go) and, near a seam, could even flip a reorder into
  // a remove.
  function drop(event: PointerEvent): void {
    const draggedId = state.draggingId;
    if (!draggedId || !isSessionPointer(event)) {
      return;
    }
    const origin = state.origin;
    const trashing = state.forgeArmed;
    const pooling = state.poolArmed;
    const insertAt = state.gapIndex;
    reset();
    if (trashing) {
      options.onTrash(draggedId);
      return;
    }
    if (pooling) {
      // A circuit card released over the pool leaves the circuit; a pool
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
    state.poolArmed = false;
    state.forgeArmed = false;
    sessionPointerId = null;
  }

  onScopeDispose(reset);

  return { state, begin, armedZone };
}
