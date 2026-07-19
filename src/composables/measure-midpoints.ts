// Vertical midpoints of every non-dragged row in a scroll zone, top to
// bottom, in viewport coordinates - the drag sessions' insertion-test
// input. dataAttr is the dataset key carrying the row id ('slotId' for
// the workbench, 'queueId' for the circuits queue); the selector derives
// from it.
//
// Measured from offsetTop, never getBoundingClientRect: rects include
// the in-flight FLIP transforms, so measuring mid-animation feeds
// animating positions back into the insertion test and the gap flaps.
// Measured on the row wrappers, not the cards inside: the wrappers
// carry the FLIP transform, offsetTop only ignores the measured
// element's own transform, and a transformed ancestor becomes its
// descendants' offsetParent, so a card inside a sliding wrapper
// measures ~0.
//
// INVARIANT: the zone must be the rows' offsetParent (give it
// position: relative). offsetTop is relative to the offsetParent, so a
// zone outside the offset chain makes every midpoint read low by the
// height of everything above the zone - on device that is a constant
// drag-down overshoot while drag-up feels normal. jsdom has no layout
// (offsetParent is always null there), so only the dev warning below
// and a device pass can catch a violation.
export function measureRowMidpoints(
  zone: HTMLElement,
  dataAttr: string,
  draggedId: string,
): number[] {
  const kebab = dataAttr.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const rows = [...zone.querySelectorAll<HTMLElement>(`[data-${kebab}]`)];
  if (import.meta.env.DEV) {
    const stray = rows.find(
      (element) => element.offsetParent !== null && element.offsetParent !== zone,
    );
    if (stray) {
      console.warn(
        `[odin] measureRowMidpoints: rows in .${zone.className} do not offset against the zone; ` +
          'every midpoint reads low. Give the zone position: relative.',
      );
    }
  }
  const zoneTop = zone.getBoundingClientRect().top - zone.scrollTop;
  return rows
    .filter((element) => element.dataset[dataAttr] !== draggedId)
    .map((element) => zoneTop + element.offsetTop + element.offsetHeight / 2);
}
