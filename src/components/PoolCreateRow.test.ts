import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PoolCreateRow from './PoolCreateRow.vue';

describe('PoolCreateRow', () => {
  it('idles as the ghost row and swaps to the name entry on tap', async () => {
    const wrapper = mount(PoolCreateRow);

    expect(wrapper.text()).toContain('+ New workout');
    expect(wrapper.find('.pool-create__entry').exists()).toBe(false);

    await wrapper.get('button').trigger('click');

    expect(wrapper.find('.pool-create__entry').exists()).toBe(true);
    expect(wrapper.get('.pool-create__entry').attributes('data-placeholder')).toBe('Name');
  });

  it('commits the trimmed name on Enter and folds back to idle', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    const entry = wrapper.get('.pool-create__entry');
    entry.element.textContent = '  Goblet Squat  ';
    await entry.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('create')).toEqual([['Goblet Squat']]);
    expect(wrapper.find('.pool-create__entry').exists()).toBe(false);
    expect(wrapper.text()).toContain('+ New workout');
  });

  it('commits via the confirm check', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    wrapper.get('.pool-create__entry').element.textContent = 'Kb Swing';
    await wrapper.get('.pool-create__confirm').trigger('click');

    expect(wrapper.emitted('create')).toEqual([['Kb Swing']]);
  });

  it('treats a blank commit as a cancel: no emit, back to idle', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    wrapper.get('.pool-create__entry').element.textContent = '   ';
    await wrapper.get('.pool-create__entry').trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('.pool-create__entry').exists()).toBe(false);
  });

  it('cancels on Escape without emitting', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    wrapper.get('.pool-create__entry').element.textContent = 'Dead Bug';
    await wrapper.get('.pool-create__entry').trigger('keydown', { key: 'Escape' });

    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('.pool-create__entry').exists()).toBe(false);
  });

  it('abandons the entry when focus leaves the row (tap-off)', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    wrapper.get('.pool-create__entry').element.textContent = 'Dead Bug';
    await wrapper.get('.pool-create__row--entering').trigger('focusout', { relatedTarget: null });

    expect(wrapper.emitted('create')).toBeUndefined();
    expect(wrapper.find('.pool-create__entry').exists()).toBe(false);
    expect(wrapper.text()).toContain('+ New workout');
  });

  it('keeps the entry open while focus moves within the row', async () => {
    const wrapper = mount(PoolCreateRow);
    await wrapper.get('button').trigger('click');

    const confirm = wrapper.get('.pool-create__confirm').element;
    await wrapper.get('.pool-create__row--entering').trigger('focusout', {
      relatedTarget: confirm,
    });

    expect(wrapper.find('.pool-create__entry').exists()).toBe(true);
  });

  it('renders the parent verdict when a name was rejected', () => {
    const wrapper = mount(PoolCreateRow, {
      props: { notice: "'Cat Cow' already exists as a stretch exercise" },
    });

    expect(wrapper.get('.pool-create__notice').text()).toContain('already exists as a stretch');
  });
});
