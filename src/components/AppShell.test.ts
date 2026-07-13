import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import AppShell from './AppShell.vue';

describe('AppShell', () => {
  it('renders header, body, and action content in their regions', () => {
    const wrapper = mount(AppShell, {
      slots: {
        header: '<span id="h">title</span>',
        default: '<span id="b">content</span>',
        action: '<span id="a">cta</span>',
      },
    });

    expect(wrapper.find('.app-shell__header #h').exists()).toBe(true);
    expect(wrapper.find('.app-shell__body #b').exists()).toBe(true);
    expect(wrapper.find('.app-shell__action #a').exists()).toBe(true);
  });

  it('omits the header element when no header slot is given', () => {
    const wrapper = mount(AppShell, {
      slots: { default: '<p>content</p>' },
    });

    expect(wrapper.find('.app-shell__header').exists()).toBe(false);
    // The action bar always renders: its safe-area padding must reserve
    // the home-indicator strip even on screens without a docked action.
    expect(wrapper.find('.app-shell__action').exists()).toBe(true);
  });

  it('keeps the scanline overlay out of the accessibility tree', () => {
    const wrapper = mount(AppShell, {
      slots: { default: '<p>content</p>' },
    });

    expect(wrapper.find('.app-shell__scanlines').attributes('aria-hidden')).toBe('true');
  });
});
