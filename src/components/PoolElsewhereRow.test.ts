import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import PoolElsewhereRow from './PoolElsewhereRow.vue';

// Render + emit wiring only; the grip's press-to-drag decision logic is
// pinned in useDragHandle.test.ts. Pointer interactions use the jsdom
// expando pattern (see WorkoutCard.test.ts).

function firePointer(
  target: EventTarget,
  type: string,
  coords: { clientX: number; clientY: number },
  pointerId = 1,
): void {
  const event = new Event(type);
  Object.assign(event, coords, { pointerId, button: 0 });
  target.dispatchEvent(event);
}

describe('PoolElsewhereRow', () => {
  it('renders the muted name with the owner pill and a grip', () => {
    const wrapper = mount(PoolElsewhereRow, { props: { name: 'Pushups', owner: 'Upper Body' } });

    expect(wrapper.get('.pool-elsewhere__name').text()).toBe('Pushups');
    expect(wrapper.get('.pool-elsewhere__owner').text()).toBe('Upper Body');
    expect(wrapper.find('.grip-handle').exists()).toBe(true);
    expect(wrapper.find('.pool-elsewhere__strip').exists()).toBe(false);
  });

  it('shows the steal strip when open: consequence, named-copy tip, both actions', () => {
    const wrapper = mount(PoolElsewhereRow, {
      props: { name: 'Pushups', owner: 'Upper Body', open: true },
    });

    const strip = wrapper.get('.pool-elsewhere__strip');
    expect(strip.text()).toContain('out of Upper Body');
    expect(strip.text()).toContain('History follows the name');
    expect(strip.text()).toContain('"Pushups // Upper"');
    expect(strip.text()).toContain('Leave it');
    expect(strip.text()).toContain('Move here');
  });

  it('emits toggle on a body click', async () => {
    const wrapper = mount(PoolElsewhereRow, { props: { name: 'Pushups', owner: 'Upper Body' } });

    await wrapper.get('.pool-elsewhere__head').trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });

  it('emits steal from MOVE HERE and close from LEAVE IT', async () => {
    const wrapper = mount(PoolElsewhereRow, {
      props: { name: 'Pushups', owner: 'Upper Body', open: true },
    });

    await wrapper.get('.pool-elsewhere__move').trigger('click');
    await wrapper.get('.pool-elsewhere__keep').trigger('click');

    expect(wrapper.emitted('steal')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('emits drag-start from the grip once past the threshold', () => {
    const wrapper = mount(PoolElsewhereRow, { props: { name: 'Pushups', owner: 'Upper Body' } });

    firePointer(wrapper.get('.grip-handle').element, 'pointerdown', {
      clientX: 40,
      clientY: 600,
    });
    firePointer(document, 'pointermove', { clientX: 40, clientY: 560 });

    expect(wrapper.emitted('drag-start')).toHaveLength(1);
    expect(wrapper.emitted('toggle')).toBeUndefined();
  });

  it('a body swipe scrolls while the pool has scroll to lose, and drags once it does not', () => {
    const scrolling = mount(PoolElsewhereRow, { props: { name: 'Pushups', owner: 'Upper Body' } });

    firePointer(scrolling.get('.pool-elsewhere__head').element, 'pointerdown', {
      clientX: 40,
      clientY: 600,
    });
    firePointer(document, 'pointermove', { clientX: 40, clientY: 560 });
    expect(scrolling.emitted('drag-start')).toBeUndefined();

    const settled = mount(PoolElsewhereRow, {
      props: { name: 'Pushups', owner: 'Upper Body', dragAnywhere: true },
    });

    firePointer(settled.get('.pool-elsewhere__head').element, 'pointerdown', {
      clientX: 40,
      clientY: 600,
    });
    firePointer(document, 'pointermove', { clientX: 40, clientY: 560 });
    expect(settled.emitted('drag-start')).toHaveLength(1);
  });

  it('a body drag that releases back over the head does not also fold the strip open', async () => {
    const wrapper = mount(PoolElsewhereRow, {
      props: { name: 'Pushups', owner: 'Upper Body', dragAnywhere: true },
    });
    const head = wrapper.get('.pool-elsewhere__head');

    firePointer(head.element, 'pointerdown', { clientX: 40, clientY: 600 });
    firePointer(document, 'pointermove', { clientX: 40, clientY: 560 });
    firePointer(document, 'pointerup', { clientX: 40, clientY: 560 });
    await head.trigger('click');

    expect(wrapper.emitted('toggle')).toBeUndefined();

    // ...and the swallow is spent: the next plain tap still opens it.
    firePointer(head.element, 'pointerdown', { clientX: 40, clientY: 600 });
    firePointer(document, 'pointerup', { clientX: 40, clientY: 600 });
    await head.trigger('click');

    expect(wrapper.emitted('toggle')).toHaveLength(1);
  });
});
