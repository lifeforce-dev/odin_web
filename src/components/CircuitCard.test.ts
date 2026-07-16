import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import CircuitCard from './CircuitCard.vue';

describe('CircuitCard', () => {
  it('renders the exercise name and prescribed sets', () => {
    const wrapper = mount(CircuitCard, { props: { name: 'Lat Pulldown', sets: 4 } });

    expect(wrapper.text()).toContain('Lat Pulldown');
    expect(wrapper.text()).toContain('4 sets');
  });

  it('emits select on tap', async () => {
    const wrapper = mount(CircuitCard, { props: { name: 'Lat Pulldown', sets: 4 } });

    await wrapper.trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
  });

  it('stays tappable while in progress: done, and only done, is inert', async () => {
    const wrapper = mount(CircuitCard, {
      props: { name: 'Lat Pulldown', sets: 4, loggedSets: 2, progress: 'in-progress' as const },
    });

    await wrapper.trigger('click');

    expect(wrapper.attributes('disabled')).toBeUndefined();
    expect(wrapper.emitted('select')).toHaveLength(1);
  });

  it('shows the logged fraction while in progress', () => {
    const wrapper = mount(CircuitCard, {
      props: { name: 'Lat Pulldown', sets: 4, loggedSets: 2, progress: 'in-progress' as const },
    });

    expect(wrapper.text()).toContain('2/4');
  });

  it('is non-interactive when done: disabled, no emit, stamp shown', async () => {
    const wrapper = mount(CircuitCard, {
      props: { name: 'Lat Pulldown', sets: 4, loggedSets: 4, progress: 'done' as const },
    });

    await wrapper.trigger('click');

    expect(wrapper.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('select')).toBeUndefined();
    expect(wrapper.text()).toContain('Done');
    // The stamp is aria-hidden; the state must be spoken instead.
    expect(wrapper.attributes('aria-label')).toBe('Lat Pulldown, done');
  });

  it('shows no stamp before the exercise is done', () => {
    const wrapper = mount(CircuitCard, {
      props: { name: 'Lat Pulldown', sets: 4, loggedSets: 2, progress: 'in-progress' as const },
    });

    expect(wrapper.find('.circuit-card__stamp').exists()).toBe(false);
  });
});
