import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import InlineNameEntry from './InlineNameEntry.vue';

describe('InlineNameEntry', () => {
  it('opens with the caret collapsed at the end of the seed', () => {
    const wrapper = mount(InlineNameEntry, {
      attachTo: document.body,
      props: { seed: 'Upper Body', entryLabel: 'Circuit name', confirmLabel: 'Rename circuit' },
    });

    const entry = wrapper.get('.name-entry__entry').element;
    const selection = window.getSelection();

    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.focusNode).toBe(entry);
    expect(selection?.focusOffset).toBe(entry.childNodes.length);

    wrapper.unmount();
  });
});
