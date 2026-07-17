import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setUpOverride } from '@/router/up';

import NavUpRow from './NavUpRow.vue';

const nativeState = { hasSystemBack: false };

vi.mock('@/native', () => ({
  get hasSystemBack() {
    return nativeState.hasSystemBack;
  },
  isNative: false,
  minimizeApp: vi.fn().mockResolvedValue(undefined),
}));

const route: { meta: Record<string, unknown> } = { meta: {} };
const router = {
  currentRoute: { value: route },
  replace: vi.fn().mockResolvedValue(undefined),
};

vi.mock('vue-router', () => ({
  useRoute: () => route,
  useRouter: () => router,
}));

beforeEach(() => {
  nativeState.hasSystemBack = false;
  route.meta = {};
  router.replace.mockClear();
  // Clears a stray override left by another suite sharing up.ts's
  // module-level slot: register-then-dispose always wins the race
  // check (dispose-if-still-mine), leaving the slot empty either way.
  setUpOverride(() => {})();
});

describe('NavUpRow', () => {
  it('renders the destination-named label from route meta', () => {
    route.meta = { upTo: { name: 'home' }, upLabel: 'Home' };
    const wrapper = mount(NavUpRow);

    expect(wrapper.find('.nav-up-row').exists()).toBe(true);
    expect(wrapper.text()).toContain('Home');
  });

  it('hides on a platform with a system back affordance', () => {
    nativeState.hasSystemBack = true;
    route.meta = { upTo: { name: 'home' }, upLabel: 'Home' };
    const wrapper = mount(NavUpRow);

    expect(wrapper.find('.nav-up-row').exists()).toBe(false);
  });

  it('renders nothing with no meta and no label prop', () => {
    const wrapper = mount(NavUpRow);

    expect(wrapper.find('.nav-up-row').exists()).toBe(false);
  });

  it('a label prop overrides the meta label and renders even with no meta at all', () => {
    const wrapper = mount(NavUpRow, { props: { label: 'Home' } });

    expect(wrapper.find('.nav-up-row').exists()).toBe(true);
    expect(wrapper.text()).toContain('Home');
  });

  it('a press resolves the meta destination through the real goUp', async () => {
    route.meta = { upTo: { name: 'circuits' }, upLabel: 'Circuits' };
    const wrapper = mount(NavUpRow);

    await wrapper.get('.nav-up-row').trigger('click');

    expect(router.replace).toHaveBeenCalledExactlyOnceWith({ name: 'circuits' });
  });
});
