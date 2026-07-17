import { nextTick } from 'vue';

// Waits out the re-render after the caller closed any open fold: drag
// measurements must describe settled geometry. The finger keeps moving
// during the tick with no session listening yet, so the freshest move
// is carried across (beginning from the original event would paint the
// ghost frames behind the finger). A release during the tick returns
// null: the flick ended before the drag could begin, and starting
// anyway would leave the ghost stuck. A plain async helper, not a
// composable - it holds no reactive state.
export async function settlePointer(event: PointerEvent): Promise<PointerEvent | null> {
  let released = false;
  let liveEvent = event;
  const onEarlyRelease = (releaseEvent: PointerEvent): void => {
    if (releaseEvent.pointerId === event.pointerId) {
      released = true;
    }
  };
  const onEarlyMove = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId === event.pointerId) {
      liveEvent = moveEvent;
    }
  };
  document.addEventListener('pointerup', onEarlyRelease);
  document.addEventListener('pointercancel', onEarlyRelease);
  document.addEventListener('pointermove', onEarlyMove);
  await nextTick();
  document.removeEventListener('pointerup', onEarlyRelease);
  document.removeEventListener('pointercancel', onEarlyRelease);
  document.removeEventListener('pointermove', onEarlyMove);
  return released ? null : liveEvent;
}
