import { describe, expect, it } from 'vitest';

import { measureRowMidpoints } from './measure-midpoints';

// jsdom has no layout, so the offsetParent invariant (the constant
// drag-down overshoot this helper's comment documents) is untestable
// here - a device pass owns it. What jsdom CAN pin: the dragged row's
// exclusion, DOM-order mapping, and the dataAttr->selector derivation
// matching both call sites' attributes. Row geometry is stubbed via
// defineProperty since jsdom reports every offset as 0.

function buildZone(attribute: string, ids: string[]): HTMLElement {
  const zone = document.createElement('div');
  ids.forEach((id, index) => {
    const row = document.createElement('div');
    row.setAttribute(attribute, id);
    Object.defineProperty(row, 'offsetTop', { value: index * 100 });
    Object.defineProperty(row, 'offsetHeight', { value: 50 });
    zone.append(row);
  });
  return zone;
}

describe('measureRowMidpoints', () => {
  it('maps rows to midpoints in DOM order', () => {
    const zone = buildZone('data-queue-id', ['a', 'b', 'c']);

    expect(measureRowMidpoints(zone, 'queueId', 'none')).toEqual([25, 125, 225]);
  });

  it('excludes the dragged row', () => {
    const zone = buildZone('data-queue-id', ['a', 'b', 'c']);

    expect(measureRowMidpoints(zone, 'queueId', 'b')).toEqual([25, 225]);
  });

  it('shifts every midpoint by rect.top minus scrollTop', () => {
    const zone = buildZone('data-queue-id', ['a', 'b']);
    zone.getBoundingClientRect = () => ({ top: 50 }) as DOMRect;
    Object.defineProperty(zone, 'scrollTop', { value: 30 });

    // Unshifted (zoneTop 0) the rows would read [25, 125]; the
    // rect.top - scrollTop compensation (50 - 30 = 20) that jsdom
    // otherwise leaves at 0 shifts both by exactly +20.
    expect(measureRowMidpoints(zone, 'queueId', 'none')).toEqual([45, 145]);
  });

  it("derives the selector from the dataset key, matching both call sites' attributes", () => {
    // The workbench passes 'slotId' over data-slot-id wrappers, the
    // circuits screen 'queueId' over data-queue-id; a derivation drift
    // would silently empty a midpoint list.
    const slotZone = buildZone('data-slot-id', ['a', 'b']);
    expect(measureRowMidpoints(slotZone, 'slotId', 'none')).toHaveLength(2);
    expect(measureRowMidpoints(slotZone, 'slotId', 'a')).toEqual([125]);

    const queueZone = buildZone('data-queue-id', ['a', 'b']);
    expect(measureRowMidpoints(queueZone, 'queueId', 'none')).toHaveLength(2);

    // The wrong key finds nothing: the selector really is derived, not
    // a permissive match-anything.
    expect(measureRowMidpoints(queueZone, 'slotId', 'none')).toEqual([]);
  });
});
