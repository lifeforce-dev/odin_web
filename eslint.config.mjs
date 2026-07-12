import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';
import pluginVue from 'eslint-plugin-vue';

export default withVueTs(
  {
    name: 'odin/ignores',
    ignores: [
      'dist/**',
      'android/**',
      'ios/**',
      'design_reference/**',
      'design_exploration/**',
      'character_designs/**',
      'new_designs/**',
      'copilot/**',
      'docs/**',
    ],
  },
  pluginVue.configs['flat/recommended'],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    // STYLEGUIDE section 10: useViewport() is the only file allowed to read
    // window dimensions or media queries. Everything else must consume it.
    name: 'odin/viewport-single-door',
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'innerWidth',
          message: 'Read viewport size through composables/useViewport.ts only.',
        },
        {
          name: 'innerHeight',
          message: 'Read viewport size through composables/useViewport.ts only.',
        },
        {
          name: 'matchMedia',
          message: 'Media queries in JS go through composables/useViewport.ts only.',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'innerWidth',
          message: 'Read viewport size through composables/useViewport.ts only.',
        },
        {
          object: 'window',
          property: 'innerHeight',
          message: 'Read viewport size through composables/useViewport.ts only.',
        },
        {
          object: 'window',
          property: 'matchMedia',
          message: 'Media queries in JS go through composables/useViewport.ts only.',
        },
      ],
    },
  },
  {
    name: 'odin/viewport-single-door-carveout',
    files: ['src/composables/useViewport.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  {
    // Bridge isolation backstop: dependency-cruiser enforces this for .ts
    // files but does not parse .vue SFCs, so ESLint covers components too.
    // Scoped to src/ so root config files (capacitor.config.ts) stay legal.
    name: 'odin/bridge-isolation',
    files: ['src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@capacitor-community/*'],
              message: 'Only src/native/ may import Capacitor plugins (bridge isolation).',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'odin/bridge-isolation-carveout',
    files: ['src/native/**'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
);
