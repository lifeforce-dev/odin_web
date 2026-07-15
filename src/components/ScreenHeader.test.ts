import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryState } from 'vue-router';

import ScreenHeader from './ScreenHeader.vue';

// The back fallback reads the router's history position via
// router.options.history.state, so the router is stubbed at the
// composable seam: createMemoryHistory never writes a back entry, which
// would make the pop-history branch untestable with a real router.
const router = {
  back: vi.fn(),
  replace: vi.fn().mockResolvedValue(undefined),
  options: { history: { state: {} as HistoryState } },
};

vi.mock('vue-router', () => ({
  useRouter: () => router,
}));

function mountHeader() {
  return mount(ScreenHeader, {
    props: {
      title: 'Circuits',
      eyebrow: 'Rotation // Order',
      backTo: { name: 'home' },
    },
  });
}

describe('ScreenHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    router.options.history.state = {};
  });

  it('renders the title and eyebrow', () => {
    const wrapper = mountHeader();

    expect(wrapper.get('h1').text()).toBe('Circuits');
    expect(wrapper.text()).toContain('Rotation // Order');
  });

  it('appends the eyebrow value when passed as separate data', () => {
    const wrapper = mount(ScreenHeader, {
      props: {
        title: 'Workbench',
        eyebrow: 'Circuit',
        eyebrowValue: 'abc-123',
        backTo: { name: 'circuits' },
      },
    });

    expect(wrapper.text()).toContain('Circuit // abc-123');
  });

  it('omits the eyebrow element when the prop is not passed', () => {
    const wrapper = mount(ScreenHeader, {
      props: { title: 'Circuits', backTo: { name: 'home' } },
    });

    expect(wrapper.find('p').exists()).toBe(false);
  });

  it('renders slot-provided eyebrow content for fully computed copy', () => {
    const wrapper = mount(ScreenHeader, {
      props: { title: 'Legs', backTo: { name: 'circuits' } },
      slots: { eyebrow: '3 Workouts' },
    });

    expect(wrapper.get('.screen-header__eyebrow').text()).toBe('3 Workouts');
  });

  it('pops history when there is an entry to go back to', async () => {
    router.options.history.state = { back: '/' };
    const wrapper = mountHeader();

    await wrapper.get('button').trigger('click');

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('replaces to the declared parent at the history bottom', async () => {
    // vue-router writes back: null on a fresh load of the route; hardware
    // back minimizes there, so the on-screen button must not be a no-op.
    router.options.history.state = { back: null };
    const wrapper = mountHeader();

    await wrapper.get('button').trigger('click');

    expect(router.replace).toHaveBeenCalledWith({ name: 'home' });
    expect(router.back).not.toHaveBeenCalled();
  });
});
