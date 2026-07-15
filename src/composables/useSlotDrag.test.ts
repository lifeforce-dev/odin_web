import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { insertionIndex, orderAfterDrop, useSlotDrag } from './useSlotDrag';
import type { SlotDragOptions } from './useSlotDrag';

// Geometry is injected (measure callbacks), so the whole session runs on
// synthetic numbers: three slots with midpoints at 100/200/300 and the
// pool starting at y=500. Every synthetic event carries a pointerId (the
// session must ignore other fingers); the drag finger is pointer 1 unless
// a test says otherwise.

function firePointer(
  type: string,
  coords: { clientX: number; clientY: number },
  pointerId = 1,
): void {
  const event = new Event(type);
  Object.assign(event, coords, { pointerId });
  document.dispatchEvent(event);
}

function pointerEvent(coords: { clientX: number; clientY: number }, pointerId = 1): PointerEvent {
  const event = new Event('pointerdown');
  Object.assign(event, coords, { pointerId });
  return event as PointerEvent;
}

// The source card's rect at grab time; only left/top/width/height are read.
function cardRect(left: number, top: number, width: number): DOMRect {
  return { left, top, width, height: 56, right: left + width, bottom: top + 56 } as DOMRect;
}

const scopes: Array<ReturnType<typeof effectScope>> = [];

function makeDrag(overrides: Partial<SlotDragOptions> = {}) {
  const options: SlotDragOptions = {
    measureSlotMidpoints: vi.fn(() => [100, 200, 300]),
    measurePoolTop: vi.fn(() => 500),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  const scope = effectScope();
  scopes.push(scope);
  const drag = scope.run(() => useSlotDrag(options));
  if (!drag) {
    throw new Error('effect scope produced no composable');
  }
  return { drag, options };
}

afterEach(() => {
  for (const scope of scopes.splice(0)) {
    scope.stop();
  }
});

describe('insertionIndex', () => {
  it('places the pointer before the first midpoint below it', () => {
    expect(insertionIndex([100, 200, 300], 50)).toBe(0);
    expect(insertionIndex([100, 200, 300], 150)).toBe(1);
    expect(insertionIndex([100, 200, 300], 250)).toBe(2);
  });

  it('appends when the pointer is under every midpoint', () => {
    expect(insertionIndex([100, 200, 300], 350)).toBe(3);
  });

  it('appends into an empty list', () => {
    expect(insertionIndex([], 10)).toBe(0);
  });
});

describe('orderAfterDrop', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('moves a card down: the gap index counts the remaining rows', () => {
    // Dragging 'a' with the gap after 'b' and 'c' (index 2 of b/c/d).
    expect(orderAfterDrop(ids, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(orderAfterDrop(ids, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('moves a card up', () => {
    expect(orderAfterDrop(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(orderAfterDrop(ids, 'c', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('returns the original order when dropped back in place', () => {
    expect(orderAfterDrop(ids, 'b', 1)).toEqual(ids);
    expect(orderAfterDrop(ids, 'a', 0)).toEqual(ids);
    expect(orderAfterDrop(ids, 'd', 3)).toEqual(ids);
  });
});

describe('useSlotDrag', () => {
  it('arms the circuit zone and opens the landing gap over the slots', () => {
    const { drag } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));

    expect(drag.state.draggingId).toBe('item-1');
    expect(drag.state.circuitArmed).toBe(true);
    expect(drag.state.poolArmed).toBe(false);
    expect(drag.state.gapIndex).toBe(1);
  });

  it('anchors the full-size ghost card to the grab point', () => {
    const { drag } = makeDrag();

    // Grabbed 20px right of / 10px under the card's top-left corner.
    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));

    expect(drag.state.ghostWidth).toBe(380);
    expect(drag.state.ghostHeight).toBe(56);
    expect(drag.state.ghostX).toBe(20);
    expect(drag.state.ghostY).toBe(140);

    // The grabbed point stays under the thumb as it moves.
    firePointer('pointermove', { clientX: 140, clientY: 300 });
    expect(drag.state.ghostX).toBe(120);
    expect(drag.state.ghostY).toBe(290);
  });

  it('clamps the grab point into the card when the measured rect shifted', () => {
    const { drag } = makeDrag();

    // The card was re-measured after an editor above it collapsed: the
    // pointer now sits 30px BELOW the card. Unclamped, the ghost would
    // ride 86px above the thumb; clamped, its bottom edge stays under it.
    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 230 }), cardRect(20, 140, 380));

    expect(drag.state.ghostY).toBe(230 - 56);
    expect(drag.state.ghostX).toBe(20);
  });

  it('refuses to begin a second session while one is active', () => {
    const { drag } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    drag.begin('item-2', pointerEvent({ clientX: 40, clientY: 250 }, 2), cardRect(20, 240, 380));

    expect(drag.state.draggingId).toBe('item-1');
  });

  it('ignores every event from fingers other than the drag finger', () => {
    const { drag, options } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    const heldGhostY = drag.state.ghostY;

    // A second finger moves, cancels, and lifts deep in the pool: the
    // ghost must not jump to it, the session must not end, and above all
    // its lift must not fire the (destructive) drop.
    firePointer('pointermove', { clientX: 300, clientY: 550 }, 2);
    expect(drag.state.ghostY).toBe(heldGhostY);
    expect(drag.state.poolArmed).toBe(false);

    firePointer('pointercancel', { clientX: 300, clientY: 550 }, 2);
    expect(drag.state.draggingId).toBe('item-1');

    firePointer('pointerup', { clientX: 300, clientY: 550 }, 2);
    expect(drag.state.draggingId).toBe('item-1');
    expect(options.onRemove).not.toHaveBeenCalled();
    expect(options.onReorder).not.toHaveBeenCalled();

    // The drag finger still works after all of it.
    firePointer('pointerup', { clientX: 40, clientY: 150 });
    expect(options.onReorder).toHaveBeenCalledWith('item-1', 1);
  });

  it('arms the pool (remove) at its top edge, exactly one zone at a time', () => {
    const { drag } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    firePointer('pointermove', { clientX: 40, clientY: 500 });

    expect(drag.state.poolArmed).toBe(true);
    expect(drag.state.circuitArmed).toBe(false);
    expect(drag.state.gapIndex).toBeNull();
  });

  it('disarms the pool through hysteresis, not at the same line it armed', () => {
    const { drag } = makeDrag();
    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));

    firePointer('pointermove', { clientX: 40, clientY: 500 });
    expect(drag.state.poolArmed).toBe(true);

    // Thumb tremor back above the boundary stays inside the band: armed.
    firePointer('pointermove', { clientX: 40, clientY: 495 });
    expect(drag.state.poolArmed).toBe(true);
    expect(drag.state.gapIndex).toBeNull();

    // A deliberate retreat past the band disarms and reopens the gap.
    firePointer('pointermove', { clientX: 40, clientY: 480 });
    expect(drag.state.poolArmed).toBe(false);
    expect(drag.state.circuitArmed).toBe(true);
    expect(drag.state.gapIndex).not.toBeNull();
  });

  it('freezes the pool boundary at grab time so state swaps cannot move it', () => {
    const measurePoolTop = vi.fn(() => 500);
    const { drag } = makeDrag({ measurePoolTop });

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    // The list restructure after arming would report a shifted boundary;
    // a live re-measure here would oscillate at the seam.
    measurePoolTop.mockReturnValue(560);
    firePointer('pointermove', { clientX: 40, clientY: 520 });

    expect(measurePoolTop).toHaveBeenCalledTimes(1);
    expect(drag.state.poolArmed).toBe(true);
  });

  it('reorders on drop inside the circuit zone', () => {
    const { drag, options } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    firePointer('pointermove', { clientX: 40, clientY: 250 });
    firePointer('pointerup', { clientX: 40, clientY: 250 });

    expect(options.onReorder).toHaveBeenCalledWith('item-1', 2);
    expect(options.onRemove).not.toHaveBeenCalled();
    expect(drag.state.draggingId).toBeNull();
  });

  it('removes on drop over the pool', () => {
    const { drag, options } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    firePointer('pointermove', { clientX: 40, clientY: 550 });
    firePointer('pointerup', { clientX: 40, clientY: 550 });

    expect(options.onRemove).toHaveBeenCalledWith('item-1');
    expect(options.onReorder).not.toHaveBeenCalled();
  });

  it('applies the previewed state on release, ignoring lift-off jitter', () => {
    const { drag, options } = makeDrag();

    // Held preview: gap at index 2, circuit armed.
    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    firePointer('pointermove', { clientX: 40, clientY: 250 });

    // The lifting finger rolls: the release event lands deep in the pool.
    // The preview is the contract - reorder at 2, never a remove.
    firePointer('pointerup', { clientX: 40, clientY: 550 });

    expect(options.onReorder).toHaveBeenCalledWith('item-1', 2);
    expect(options.onRemove).not.toHaveBeenCalled();
  });

  it('does nothing on pointercancel', () => {
    const { drag, options } = makeDrag();

    drag.begin('item-1', pointerEvent({ clientX: 40, clientY: 150 }), cardRect(20, 140, 380));
    firePointer('pointercancel', { clientX: 40, clientY: 150 });

    expect(options.onReorder).not.toHaveBeenCalled();
    expect(options.onRemove).not.toHaveBeenCalled();
    expect(drag.state.draggingId).toBeNull();

    // The session detached its document listeners: a later pointerup is dead.
    firePointer('pointerup', { clientX: 40, clientY: 250 });
    expect(options.onReorder).not.toHaveBeenCalled();
  });
});
