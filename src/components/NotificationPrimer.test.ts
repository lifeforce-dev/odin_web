import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import NotificationPrimer from './NotificationPrimer.vue';

// The app's first modal, so its focus contract is the precedent: opening it
// moves focus into the card, Tab is trapped to the two actions, and focus
// returns to the trigger on close. These pin that aria-modal="true" is
// honoured rather than merely asserted. attachTo document is required for
// real focus/activeElement behaviour in jsdom.
const COPY = { headline: 'Know when rest is over', body: 'Get a heads-up at 0:00.' };

function mountPrimer() {
  return mount(NotificationPrimer, { props: COPY, attachTo: document.body });
}

describe('NotificationPrimer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus into the dialog card on open', () => {
    const wrapper = mountPrimer();

    expect(document.activeElement).toBe(wrapper.get('.notification-primer__card').element);

    wrapper.unmount();
  });

  it('restores focus to the trigger on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = mountPrimer();
    expect(document.activeElement).not.toBe(trigger);

    wrapper.unmount();

    expect(document.activeElement).toBe(trigger);
  });

  it('wraps Tab from the last action back to the first, trapping focus in the card', async () => {
    const wrapper = mountPrimer();
    const dismiss = wrapper.get('.notification-primer__dismiss').element as HTMLElement;
    const enable = wrapper.get('.notification-primer__enable').element as HTMLElement;
    enable.focus();

    await wrapper.get('.notification-primer').trigger('keydown', { key: 'Tab' });

    expect(document.activeElement).toBe(dismiss);

    wrapper.unmount();
  });

  it('emits enable and dismiss from the two actions', async () => {
    const wrapper = mountPrimer();

    await wrapper.get('.notification-primer__enable').trigger('click');
    await wrapper.get('.notification-primer__dismiss').trigger('click');

    expect(wrapper.emitted('enable')).toHaveLength(1);
    expect(wrapper.emitted('dismiss')).toHaveLength(1);

    wrapper.unmount();
  });
});
