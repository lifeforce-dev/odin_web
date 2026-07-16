import { useDragHandle } from './useDragHandle';

// The row-body half of the grip rule, shared by every draggable row:
// when the row's list has nothing to scroll (`dragAnywhere`), the body
// becomes a second drag handle - its own useDragHandle session, because
// the grip and the body can be pressed independently. A body drag still
// ends in a click on the head whenever the finger releases back over it
// (nothing scrolled to swallow it), and that click must not also fire
// the tap action; the swallow flag is cleared by the next press, so a
// release that lands elsewhere cannot poison a later tap.

export interface BodyHandleOptions {
  // Live, not captured: the parent flips it as its list gains/loses
  // scroll mid-session.
  dragAnywhere(): boolean;
  // Gate checked when a press matures into a drag (default: always
  // draggable). WorkoutCard locks the body while a rename is open: the
  // press that matured INTO the rename is still tracked on document,
  // and walking it further must not lift the card from under the entry.
  canDrag?(): boolean;
  onDragStart(event: PointerEvent): void;
  onTap(): void;
}

export function useBodyHandle(options: BodyHandleOptions) {
  let bodyLifted = false;

  const drag = useDragHandle({
    onDragStart: (event) => {
      if (options.canDrag && !options.canDrag()) {
        return;
      }
      bodyLifted = true;
      options.onDragStart(event);
    },
  });

  function onPointerDown(event: PointerEvent): void {
    bodyLifted = false;
    if (options.dragAnywhere()) {
      drag.onPointerDown(event);
    }
  }

  function onClick(): void {
    if (bodyLifted) {
      return;
    }
    options.onTap();
  }

  return { onPointerDown, onClick };
}
