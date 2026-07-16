import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';

import { DRAG_THRESHOLD_PX, useDragHandle } from './useDragHandle';
import type { DragHandleOptions } from './useDragHandle';

// jsdom pointer pattern: plain Events with coordinate expandos. The
// pressing finger is pointer 1 unless a test says otherwise.

function pointerEvent(
  type: string,
  coords: { clientX: number; clientY: number },
  pointerId = 1,
): PointerEvent {
  const event = new Event(type);
  Object.assign(event, coords, { pointerId, button: 0 });
  return event as PointerEvent;
}

function firePointer(
  type: string,
  coords: { clientX: number; clientY: number },
  pointerId = 1,
): void {
  document.dispatchEvent(pointerEvent(type, coords, pointerId));
}

const scopes: Array<ReturnType<typeof effectScope>> = [];

function makeHandle() {
  const options: DragHandleOptions = { onDragStart: vi.fn() };
  const scope = effectScope();
  scopes.push(scope);
  const handle = scope.run(() => useDragHandle(options));
  if (!handle) {
    throw new Error('effect scope produced no composable');
  }
  return { handle, options };
}

afterEach(() => {
  for (const scope of scopes.splice(0)) {
    scope.stop();
  }
});

describe('useDragHandle', () => {
  it('lifts once past the threshold, handing over the live pointer', () => {
    const { handle, options } = makeHandle();

    handle.onPointerDown(pointerEvent('pointerdown', { clientX: 40, clientY: 600 }));
    firePointer('pointermove', { clientX: 40, clientY: 600 + DRAG_THRESHOLD_PX });
    firePointer('pointermove', { clientX: 40, clientY: 700 });

    expect(options.onDragStart).toHaveBeenCalledTimes(1);
    const lifted = (options.onDragStart as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as PointerEvent;
    expect(lifted.clientY).toBe(600 + DRAG_THRESHOLD_PX);
  });

  it('does nothing for a press that releases without travelling', () => {
    const { handle, options } = makeHandle();

    handle.onPointerDown(pointerEvent('pointerdown', { clientX: 40, clientY: 600 }));
    firePointer('pointermove', { clientX: 43, clientY: 603 });
    firePointer('pointerup', { clientX: 43, clientY: 603 });
    // Tracking detached: later movement is dead.
    firePointer('pointermove', { clientX: 40, clientY: 700 });

    expect(options.onDragStart).not.toHaveBeenCalled();
  });

  it('abandons the press on pointercancel', () => {
    const { handle, options } = makeHandle();

    handle.onPointerDown(pointerEvent('pointerdown', { clientX: 40, clientY: 600 }));
    firePointer('pointercancel', { clientX: 40, clientY: 600 });
    firePointer('pointermove', { clientX: 40, clientY: 700 });

    expect(options.onDragStart).not.toHaveBeenCalled();
  });

  it('ignores other fingers and refuses a second press while one is live', () => {
    const { handle, options } = makeHandle();

    handle.onPointerDown(pointerEvent('pointerdown', { clientX: 40, clientY: 600 }));
    // A second finger presses and sweeps far: it must not lift the row
    // nor steal the tracked press.
    handle.onPointerDown(pointerEvent('pointerdown', { clientX: 200, clientY: 700 }, 2));
    firePointer('pointermove', { clientX: 200, clientY: 800 }, 2);
    expect(options.onDragStart).not.toHaveBeenCalled();

    // The tracked finger still lifts.
    firePointer('pointermove', { clientX: 40, clientY: 700 });
    expect(options.onDragStart).toHaveBeenCalledTimes(1);
  });

  it('ignores non-primary buttons', () => {
    const { handle, options } = makeHandle();

    const rightClick = pointerEvent('pointerdown', { clientX: 40, clientY: 600 });
    Object.assign(rightClick, { button: 2 });
    handle.onPointerDown(rightClick);
    firePointer('pointermove', { clientX: 40, clientY: 700 });

    expect(options.onDragStart).not.toHaveBeenCalled();
  });
});
