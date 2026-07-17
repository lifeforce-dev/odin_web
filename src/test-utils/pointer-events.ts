// Shared pointer-event dispatch for component tests: jsdom has no
// PointerEvent constructor, so every gesture test builds a plain Event
// with pointer-shaped expandos instead. One helper, so the four call
// sites (WorkoutCard, PoolElsewhereRow, LogSetControl, RestView) can't
// drift into slightly different defaults. Not a *.test.ts file on
// purpose: vitest would otherwise try to collect it as its own suite.

export interface PointerEventCoords {
  clientX?: number;
  clientY?: number;
  button?: number;
  pointerId?: number;
}

export function firePointer(
  target: EventTarget,
  type: string,
  coords: PointerEventCoords = {},
): void {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 1, button: 0, ...coords });
  target.dispatchEvent(event);
}
