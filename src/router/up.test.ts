import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router';

import { minimizeApp } from '@/native';

import router from './index';
import { goUp, resolveUpTo, setUpOverride } from './up';

const nativeState = { isNative: true };

vi.mock('@/native', () => ({
  get isNative() {
    return nativeState.isNative;
  },
  minimizeApp: vi.fn().mockResolvedValue(undefined),
}));

// router.resolve()'s return type is RouteLocationResolved, not the
// RouteLocationNormalizedLoaded resolveUpTo/goUp consume (the same
// shape router.currentRoute.value carries at runtime) - structurally
// close enough to use here, but nominally distinct in vue-router's
// types, hence the cast.
function asLoaded(resolved: ReturnType<Router['resolve']>): RouteLocationNormalizedLoaded {
  return resolved as unknown as RouteLocationNormalizedLoaded;
}

// resolveUpTo over the REAL router's routes: this pins the map table
// against the actual route records, not a hand-copied fixture, so a
// route meta edit that drifts from the table fails here.
describe('resolveUpTo over the real router', () => {
  it('home has no structural up: hardware back minimizes instead', () => {
    const resolved = router.resolve({ name: 'home' });
    expect(resolveUpTo(asLoaded(resolved))).toBeNull();
    expect(resolved.meta.upLabel).toBeUndefined();
  });

  it('gallery has no structural up: dev-only, exempt', () => {
    const resolved = router.resolve({ name: 'gallery' });
    expect(resolveUpTo(asLoaded(resolved))).toBeNull();
    expect(resolved.meta.upLabel).toBeUndefined();
  });

  it('circuits goes up to home', () => {
    const resolved = router.resolve({ name: 'circuits' });
    expect(resolveUpTo(asLoaded(resolved))).toEqual({ name: 'home' });
    expect(resolved.meta.upLabel).toBe('Home');
  });

  it('circuit-workbench goes up to circuits', () => {
    const resolved = router.resolve({ name: 'circuit-workbench', params: { id: 'c-1' } });
    expect(resolveUpTo(asLoaded(resolved))).toEqual({ name: 'circuits' });
    expect(resolved.meta.upLabel).toBe('Circuits');
  });

  it('workout-start goes up to home', () => {
    const resolved = router.resolve({ name: 'workout-start' });
    expect(resolveUpTo(asLoaded(resolved))).toEqual({ name: 'home' });
    expect(resolved.meta.upLabel).toBe('Home');
  });

  it('workout-set goes up to workout-start', () => {
    const resolved = router.resolve({ name: 'workout-set', params: { exerciseId: 'ex-1' } });
    expect(resolveUpTo(asLoaded(resolved))).toEqual({ name: 'workout-start' });
    expect(resolved.meta.upLabel).toBe('Workout');
  });

  it('not-found goes up to home', () => {
    const resolved = router.resolve({ path: '/this/route/does/not/exist' });
    expect(resolved.name).toBe('not-found');
    expect(resolveUpTo(asLoaded(resolved))).toEqual({ name: 'home' });
    expect(resolved.meta.upLabel).toBe('Home');
  });

  it('every route declares upTo AND upLabel unless exempt: a new screen must join the map', () => {
    // The stranded-screen enforcer: a route missing its meta silently
    // minimizes on Android and renders no affordance at all on iOS.
    // Exempt: home (back minimizes by design) and gallery (dev-only).
    const exempt = new Set(['home', 'gallery']);
    for (const record of router.getRoutes()) {
      const name = String(record.name);
      if (exempt.has(name)) {
        continue;
      }
      expect(record.meta.upTo, `route "${name}" is missing meta.upTo`).toBeDefined();
      expect(record.meta.upLabel, `route "${name}" is missing meta.upLabel`).toBeTruthy();
    }
  });

  it("rest's up is a function that carries the routed exerciseId, never a fixed target", () => {
    const resolved = router.resolve({
      name: 'rest',
      params: { exerciseId: 'ex-1', setIndex: '3' },
    });

    expect(resolveUpTo(asLoaded(resolved))).toEqual({
      name: 'workout-set',
      params: { exerciseId: 'ex-1' },
    });
    expect(resolved.meta.upLabel).toBe('Roll Back Set');

    const other = router.resolve({ name: 'rest', params: { exerciseId: 'ex-2', setIndex: '1' } });
    expect(resolveUpTo(asLoaded(other))).toEqual({
      name: 'workout-set',
      params: { exerciseId: 'ex-2' },
    });
  });
});

function fakeRouter(meta: Record<string, unknown> = {}): Router {
  return {
    currentRoute: { value: { meta } },
    replace: vi.fn().mockResolvedValue(undefined),
  } as unknown as Router;
}

describe('goUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeState.isNative = true;
    // Register-then-dispose empties the module-level slot: an override
    // leaked by an earlier test's assertion failure (dispose calls at
    // test end never run then) must not swallow this test's press.
    setUpOverride(() => {})();
  });

  it('an override wins outright: no replace, no minimize', () => {
    const fake = fakeRouter({ upTo: { name: 'home' } });
    const handler = vi.fn();
    setUpOverride(handler);

    goUp(fake);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fake.replace).not.toHaveBeenCalled();
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it('replaces with the resolved destination when no override is registered', () => {
    const fake = fakeRouter({ upTo: { name: 'circuits' } });

    goUp(fake);

    expect(fake.replace).toHaveBeenCalledExactlyOnceWith({ name: 'circuits' });
  });

  it('minimizes on native with no upTo and no override', () => {
    const fake = fakeRouter();

    goUp(fake);

    expect(minimizeApp).toHaveBeenCalledTimes(1);
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it('no-ops on web with no upTo: minimizeApp must never be called there', () => {
    nativeState.isNative = false;
    const fake = fakeRouter();

    goUp(fake);

    expect(minimizeApp).not.toHaveBeenCalled();
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it('a dispose only clears the slot if it still holds that exact handler (race-proof)', () => {
    const first = vi.fn();
    const disposeFirst = setUpOverride(first);
    const second = vi.fn();
    // A newer screen's mount registers before the old screen's unmount
    // runs its dispose: mount/unmount order across a route swap is not
    // guaranteed.
    const disposeSecond = setUpOverride(second);

    disposeFirst();
    const fake = fakeRouter();
    goUp(fake);

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    // Its OWN dispose does clear the slot: the next press falls through
    // to the structural map, pinned here rather than by test order.
    disposeSecond();
    goUp(fake);

    expect(second).toHaveBeenCalledTimes(1);
    expect(minimizeApp).toHaveBeenCalledTimes(1);
  });
});
