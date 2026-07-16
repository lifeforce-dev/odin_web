import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useOverflow } from './useOverflow';

// jsdom implements neither ResizeObserver nor layout, so both are
// supplied here: the stub records what got observed and hands back a
// fire() so a test can play the "content grew" callback, and the sizes
// are defined onto the elements directly.

type Overflow = ReturnType<typeof useOverflow>;

interface ObserverStub {
  observed: Element[];
  disconnects: number;
  fire(): void;
}

function stubResizeObserver(): ObserverStub {
  const stub: ObserverStub = { observed: [], disconnects: 0, fire: () => {} };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private readonly callback: () => void) {
        stub.fire = () => this.callback();
      }
      observe(element: Element): void {
        stub.observed.push(element);
      }
      disconnect(): void {
        stub.disconnects += 1;
        stub.observed = [];
      }
      unobserve(): void {}
    },
  );
  return stub;
}

function sizedBox(scrollHeight: number, clientHeight: number): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: clientHeight, configurable: true });
  return element;
}

function growContent(element: HTMLElement, scrollHeight: number): void {
  Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true });
}

// Every case wants a live scope (the composable disposes with it) and
// one post-flush tick for the watcher.
async function run(body: () => Overflow): Promise<{ overflowing: Overflow; stop(): void }> {
  const scope = effectScope();
  const overflowing = scope.run(body)!;
  await nextTick();
  return { overflowing, stop: () => scope.stop() };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useOverflow', () => {
  it('answers by comparing the container against what it can show', async () => {
    stubResizeObserver();
    const content = ref<HTMLElement | null>(document.createElement('div'));

    const fits = await run(() => useOverflow(ref(sizedBox(200, 400)), content));
    const spills = await run(() => useOverflow(ref(sizedBox(900, 400)), content));

    expect(fits.overflowing.value).toBe(false);
    expect(spills.overflowing.value).toBe(true);
    fits.stop();
    spills.stop();
  });

  it('re-answers when the content grows inside a container that never resizes', async () => {
    // The reason the content wrapper is observed at all: a scroll
    // container's own box does not move when a card lands in it, so an
    // observer watching only the container would answer "fits" forever.
    const observer = stubResizeObserver();
    const container = ref<HTMLElement | null>(sizedBox(200, 400));
    const content = ref<HTMLElement | null>(document.createElement('div'));

    const { overflowing, stop } = await run(() => useOverflow(container, content));
    expect(overflowing.value).toBe(false);
    expect(observer.observed).toEqual([container.value, content.value]);

    growContent(container.value!, 900);
    observer.fire();

    expect(overflowing.value).toBe(true);
    stop();
  });

  it('stops observing when its scope is torn down', async () => {
    const observer = stubResizeObserver();
    const { stop } = await run(() =>
      useOverflow(ref(sizedBox(900, 400)), ref(document.createElement('div'))),
    );

    stop();

    expect(observer.disconnects).toBeGreaterThan(0);
  });

  it('still measures once where ResizeObserver does not exist, it just never re-measures', async () => {
    // The jsdom path (and any WebView old enough to lack it): the first
    // answer is real, later content changes simply go unnoticed.
    vi.stubGlobal('ResizeObserver', undefined);
    const container = ref<HTMLElement | null>(sizedBox(900, 400));

    const { overflowing, stop } = await run(() =>
      useOverflow(container, ref(document.createElement('div'))),
    );

    expect(overflowing.value).toBe(true);
    stop();
  });
});
