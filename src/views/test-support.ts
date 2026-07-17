import type { mount } from '@vue/test-utils';

// Shared locators for view tests (test files are the only importers;
// no .test suffix, so vitest never collects this as a suite).

// The home CTA whose label flips between Start Workout and Resume.
// Throws instead of returning undefined so a markup change fails the
// locator loudly in every consuming test.
export function workoutCta(wrapper: ReturnType<typeof mount>) {
  const button = wrapper
    .findAll('button')
    .find((candidate) => /Start Workout|Resume/.test(candidate.text()));
  if (!button) {
    throw new Error('workout CTA not rendered');
  }
  return button;
}
