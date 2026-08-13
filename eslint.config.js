import js from '@eslint/js';
import pluginQuery from '@tanstack/eslint-plugin-query';
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const javascriptAndTypeScriptFiles = ['**/*.{js,mjs,cjs,ts,mts,cts}'];
const webScriptFiles = ['apps/web/**/*.{js,mjs,ts,mts}'];
const webVueFiles = ['apps/web/**/*.vue'];

export default tseslint.config(
  {
    name: 'aether/ignores',
    ignores: [
      '**/.nuxt/**',
      '**/.output/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  {
    name: 'aether/javascript-and-typescript',
    files: javascriptAndTypeScriptFiles,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    name: 'aether/node-shell',
    files: ['*.{js,mjs,cjs,ts,mts,cts}', 'apps/engine/**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    name: 'aether/web-browser',
    files: [...webScriptFiles, ...webVueFiles],
    languageOptions: {
      globals: globals.browser,
    },
  },
  ...pluginVue.configs['flat/recommended'].map((config) => ({
    ...config,
    name: `aether/web/${config.name ?? 'vue'}`,
    files: webVueFiles,
  })),
  {
    name: 'aether/web/vue-typescript',
    files: webVueFiles,
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      'vue/attribute-hyphenation': ['error', 'never'],
      'vue/html-self-closing': [
        'error',
        {
          html: {
            void: 'always',
            normal: 'always',
            component: 'always',
          },
          svg: 'always',
          math: 'always',
        },
      ],
    },
  },
  ...pluginQuery.configs['flat/recommended'].map((config) => ({
    ...config,
    name: `aether/web/${config.name ?? 'tanstack-query'}`,
    files: [...webScriptFiles, ...webVueFiles],
  })),
  skipFormatting,
);
