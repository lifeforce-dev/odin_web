import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import ScreenHeader from './ScreenHeader.vue';

describe('ScreenHeader', () => {
  it('renders the title and eyebrow', () => {
    const wrapper = mount(ScreenHeader, {
      props: { title: 'Circuits', eyebrow: 'Rotation // Order' },
    });

    expect(wrapper.get('h1').text()).toBe('Circuits');
    expect(wrapper.text()).toContain('Rotation // Order');
  });

  it('appends the eyebrow value when passed as separate data', () => {
    const wrapper = mount(ScreenHeader, {
      props: { title: 'Workbench', eyebrow: 'Circuit', eyebrowValue: 'abc-123' },
    });

    expect(wrapper.text()).toContain('Circuit // abc-123');
  });

  it('omits the eyebrow element when the prop is not passed', () => {
    const wrapper = mount(ScreenHeader, { props: { title: 'Circuits' } });

    expect(wrapper.find('p').exists()).toBe(false);
  });

  it('renders slot-provided eyebrow content for fully computed copy', () => {
    const wrapper = mount(ScreenHeader, {
      props: { title: 'Legs' },
      slots: { eyebrow: '3 Workouts' },
    });

    expect(wrapper.get('.screen-header__eyebrow').text()).toBe('3 Workouts');
  });
});
