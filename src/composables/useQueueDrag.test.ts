import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { useQueueDrag } from './useQueueDrag';
import type { QueueDragOptions } from './useQueueDrag';

// Modeled on useWorkbenchDrag.test.ts: geometry is injected
// (measureMidpoints), three rows at synthetic midpoints 100/200/300.
// Every synthetic event carries a pointerId (the session must ignore
// other fingers); the drag finger is pointer 1 unless a test says
// otherwise. Pointer events are plain Events with coordinate expandos -
// jsdom has no PointerEvent constructor.

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

// The source row's rect at grab time; only left/top/width/height are read.
function rowRect(left: number, top: number, width: number): DOMRect {
  return { left, top, width, height: 56, right: left + width, bottom: top + 56 } as DOMRect;
}

const scopes: Array<ReturnType<typeof effectScope>> = [];

function makeDrag(overrides: Partial<QueueDragOptions> = {}) {
  const options: QueueDragOptions = {
    measureMidpoints: vi.fn(() => [100, 200, 300]),
    onDrop: vi.fn(),
    ...overrides,
  };
  const scope = effectScope();
  scopes.push(scope);
  const drag = scope.run(() => useQueueDrag(options));
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

describe('useQueueDrag', () => {
  it('captures the session and opens the landing gap over the rows', () => {
    const { drag } = makeDrag();

    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));

    expect(drag.state.draggingId).toBe('row-1');
    expect(drag.state.gapIndex).toBe(1);
  });

  it('anchors the full-size ghost row to the grab point and follows the pointer', () => {
    const { drag } = makeDrag();

    // Grabbed 20px right of / 10px under the row's top-left corner.
    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));

    expect(drag.state.ghostWidth).toBe(380);
    expect(drag.state.ghostHeight).toBe(56);
    expect(drag.state.ghostX).toBe(20);
    expect(drag.state.ghostY).toBe(140);

    firePointer('pointermove', { clientX: 140, clientY: 300 });
    expect(drag.state.ghostX).toBe(120);
    expect(drag.state.ghostY).toBe(290);
  });

  it('clamps the grab point into the row when the measured rect shifted', () => {
    const { drag } = makeDrag();

    // The row was re-measured after something above it collapsed: the
    // pointer now sits 30px BELOW the row. Unclamped, the ghost would ride
    // 86px above the thumb; clamped, its bottom edge stays under it.
    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 230 }), rowRect(20, 140, 380));

    expect(drag.state.ghostY).toBe(230 - 56);
    expect(drag.state.ghostX).toBe(20);
  });

  it('refuses to begin a second session while one is active', () => {
    const { drag } = makeDrag();

    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));
    drag.begin('row-2', pointerEvent({ clientX: 40, clientY: 250 }, 2), rowRect(20, 240, 380));

    expect(drag.state.draggingId).toBe('row-1');
  });

  it('ignores every event from fingers other than the drag finger', () => {
    const { drag, options } = makeDrag();

    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));
    const heldGhostY = drag.state.ghostY;

    // A second finger moves, cancels, and lifts: the ghost must not jump
    // to it, the session must not end, and above all its lift must not
    // fire a drop.
    firePointer('pointermove', { clientX: 300, clientY: 750 }, 2);
    expect(drag.state.ghostY).toBe(heldGhostY);

    firePointer('pointercancel', { clientX: 300, clientY: 750 }, 2);
    expect(drag.state.draggingId).toBe('row-1');

    firePointer('pointerup', { clientX: 300, clientY: 750 }, 2);
    expect(drag.state.draggingId).toBe('row-1');
    expect(options.onDrop).not.toHaveBeenCalled();

    // The drag finger still works after all of it.
    firePointer('pointerup', { clientX: 40, clientY: 150 });
    expect(options.onDrop).toHaveBeenCalledWith('row-1', 1);
  });

  it('does nothing on pointercancel: no drop, no lingering session', () => {
    const { drag, options } = makeDrag();

    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));
    firePointer('pointercancel', { clientX: 40, clientY: 150 });

    expect(options.onDrop).not.toHaveBeenCalled();
    expect(drag.state.draggingId).toBeNull();

    // The session detached its document listeners: a later pointerup is dead.
    firePointer('pointerup', { clientX: 40, clientY: 250 });
    expect(options.onDrop).not.toHaveBeenCalled();
  });

  it('applies the previewed gap on release, ignoring lift-off jitter (the release-roll rule)', () => {
    const { drag, options } = makeDrag();

    // Held preview: gap at index 2.
    drag.begin('row-1', pointerEvent({ clientX: 40, clientY: 150 }), rowRect(20, 140, 380));
    firePointer('pointermove', { clientX: 40, clientY: 250 });
    expect(drag.state.gapIndex).toBe(2);

    // The lifting finger rolls: the release lands far outside the list.
    // Single-zone semantics - there is nowhere else to drop, so the last
    // previewed gap still commits, never a re-track from the release
    // coordinates.
    firePointer('pointerup', { clientX: 40, clientY: 900 });

    expect(options.onDrop).toHaveBeenCalledWith('row-1', 2);
    expect(drag.state.draggingId).toBeNull();
  });
});
