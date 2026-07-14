import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

import MenuButton from './MenuButton.vue';

describe('MenuButton', () => {
  it('renders the slot label', () => {
    const wrapper = mount(MenuButton, { slots: { default: 'Build Circuit' } });

    expect(wrapper.text()).toContain('Build Circuit');
  });

  it('forwards clicks to the parent listener via fallthrough', async () => {
    // The component deliberately has no emit of its own. This guards the
    // refactors that WOULD break fallthrough: a multi-root template
    // (attrs land nowhere) or inheritAttrs: false without manual binding.
    // A single wrapper root would keep working (clicks bubble to it).
    const onClick = vi.fn();
    const wrapper = mount(MenuButton, {
      attrs: { onClick },
      slots: { default: 'Build Circuit' },
    });

    await wrapper.trigger('click');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the native button when the disabled prop is set', () => {
    const wrapper = mount(MenuButton, {
      props: { disabled: true },
      slots: { default: 'Stats' },
    });

    expect(wrapper.attributes('disabled')).toBeDefined();
  });

  it('keeps the chevron out of the accessibility tree', () => {
    const wrapper = mount(MenuButton, { slots: { default: 'Build Circuit' } });

    expect(wrapper.find('.menu-button__arrow').attributes('aria-hidden')).toBe('true');
  });
});
