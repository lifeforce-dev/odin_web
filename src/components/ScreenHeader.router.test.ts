import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

import ScreenHeader from './ScreenHeader.vue';

// The sibling suite mocks vue-router at the composable seam because
// memory history cannot produce the pop branch - but that mock
// hand-copies the shape of router.options.history.state, a third-party
// surface. This file smoke-tests that pinned contract against the REAL
// router over createWebHistory (jsdom implements the history API), so a
// vue-router upgrade that changes the state shape fails here instead of
// only in production. jsdom's window is shared across this file: each
// test resets the URL explicitly and they stay order-independent.

const Blank = defineComponent({ render: () => h('div') });

function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'home', component: Blank },
      { path: '/circuits', name: 'circuits', component: Blank },
    ],
  });
}

function mountHeader(router: ReturnType<typeof makeRouter>) {
  return mount(ScreenHeader, {
    props: { title: 'Circuits', backTo: { name: 'home' } },
    global: { plugins: [router] },
  });
}

describe('ScreenHeader against the real router', () => {
  it('replaces to the parent on a fresh load (vue-router writes back: null)', async () => {
    // A direct load onto the route: the history bottom.
    window.history.replaceState(null, '', '/circuits');
    const router = makeRouter();
    const wrapper = mountHeader(router);
    await router.isReady();

    // The contract the sibling suite mocks, verified against the real dep.
    expect(router.options.history.state.back).toBeNull();

    await wrapper.get('button').trigger('click');
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
  });

  it('pops real history after a push', async () => {
    window.history.replaceState(null, '', '/');
    const router = makeRouter();
    const wrapper = mountHeader(router);
    await router.isReady();
    await router.push({ name: 'circuits' });

    // The other half of the mocked contract: a pushed entry records its
    // predecessor in state.back.
    expect(router.options.history.state.back).toBe('/');

    await wrapper.get('button').trigger('click');
    // router.back() resolves through an async popstate in jsdom.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/'));
  });
});
