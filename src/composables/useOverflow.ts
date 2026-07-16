import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue';

// Does this scroll container overflow right now - is there anything to
// scroll at all? The workbench's drag rule keys off it: a zone whose
// list scrolls needs the swipe for scrolling, so only grips lift a
// card there; a zone whose content fits has no scroll to protect, and
// the thumb expects to just grab the card.
//
// The answer has to be reactive BEFORE the press rather than measured
// during it: it decides `touch-action`, which the browser reads at
// pointerdown and which cannot change once a gesture is underway.
//
// `content` is observed purely as a change signal. ResizeObserver
// reports box resizes, and a scroll container's own box does NOT change
// when its content grows, so observing the content wrapper too is what
// makes the answer re-derive itself when a card lands, an editor folds
// open, or a rename entry swaps in. The measurement always comes from
// the container.
export function useOverflow(
  container: Ref<HTMLElement | null>,
  content: Ref<HTMLElement | null>,
): Readonly<Ref<boolean>> {
  const overflowing = ref(false);

  function measure(): void {
    const box = container.value;
    overflowing.value = box !== null && box.scrollHeight > box.clientHeight;
  }

  // jsdom implements no ResizeObserver (the scrollIntoView precedent):
  // feature-check rather than crash under vitest.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;

  watch(
    [container, content],
    ([box, inner]) => {
      observer?.disconnect();
      if (observer && box && inner) {
        observer.observe(box);
        observer.observe(inner);
      }
      measure();
    },
    { immediate: true, flush: 'post' },
  );

  onScopeDispose(() => observer?.disconnect());

  return readonly(overflowing);
}
