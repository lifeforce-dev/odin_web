import { onMounted, onUnmounted, readonly, ref } from 'vue';

// The single device-awareness door (STYLEGUIDE section 10). Every other file
// is ESLint-banned from reading window dimensions or calling matchMedia.
export function useViewport() {
  const width = ref(window.innerWidth);
  const height = ref(window.innerHeight);

  function update() {
    width.value = window.innerWidth;
    height.value = window.innerHeight;
  }

  onMounted(() => window.addEventListener('resize', update));
  onUnmounted(() => window.removeEventListener('resize', update));

  return { width: readonly(width), height: readonly(height) };
}
