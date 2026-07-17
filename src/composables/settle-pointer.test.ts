import { describe, expect, it } from 'vitest';

import { settlePointer } from './settle-pointer';

// Pointer events are plain Events with coordinate expandos - jsdom has
// no PointerEvent constructor. The settling finger is pointer 1 unless
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

describe('settlePointer', () => {
  it('resolves with the freshest pointermove carried across the tick', async () => {
    const pending = settlePointer(pointerEvent({ clientX: 40, clientY: 150 }));

    firePointer('pointermove', { clientX: 60, clientY: 200 });
    firePointer('pointermove', { clientX: 80, clientY: 260 });

    const settled = await pending;
    expect(settled).not.toBeNull();
    expect(settled?.clientX).toBe(80);
    expect(settled?.clientY).toBe(260);
  });

  it('resolves with the original event when nothing moved during the tick', async () => {
    const original = pointerEvent({ clientX: 40, clientY: 150 });

    expect(await settlePointer(original)).toBe(original);
  });

  it('returns null when the finger releases during the tick', async () => {
    const pending = settlePointer(pointerEvent({ clientX: 40, clientY: 150 }));

    firePointer('pointerup', { clientX: 40, clientY: 150 });

    expect(await pending).toBeNull();
  });

  it('returns null when the gesture cancels during the tick', async () => {
    const pending = settlePointer(pointerEvent({ clientX: 40, clientY: 150 }));

    firePointer('pointercancel', { clientX: 40, clientY: 150 });

    expect(await pending).toBeNull();
  });

  it('ignores moves and releases from a different pointerId', async () => {
    const pending = settlePointer(pointerEvent({ clientX: 40, clientY: 150 }));

    // A second finger moves and lifts: it must neither steer the carried
    // event nor abort the settle.
    firePointer('pointermove', { clientX: 300, clientY: 700 }, 2);
    firePointer('pointerup', { clientX: 300, clientY: 700 }, 2);

    const settled = await pending;
    expect(settled).not.toBeNull();
    expect(settled?.clientX).toBe(40);
    expect(settled?.clientY).toBe(150);
  });
});
