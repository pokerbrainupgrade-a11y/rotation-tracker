import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist/**', 'dev-dist/**', 'coverage/**', 'node_modules/**', 'design/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  /**
   * ENGINE PURITY.
   *
   * Everything under src/engine/ is a pure function over plain data. The clock
   * is always an injected argument.
   *
   * This is not architectural preference. Reading the clock inside the engine
   * makes DST, midnight and timezone-shift cases untestable — and those are
   * exactly where rolling-window counters break silently.
   */
  {
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'src/engine must be pure: Date.now() is banned. Pass the clock in as an argument.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'src/engine must be pure: bare new Date() is banned. Pass the clock in as an argument.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'src/engine must be deterministic: Math.random() is banned.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'indexedDB', message: 'src/engine must not touch storage.' },
        { name: 'document', message: 'src/engine must not touch the DOM.' },
        { name: 'window', message: 'src/engine must not touch the DOM.' },
        { name: 'localStorage', message: 'src/engine must not touch storage.' },
        { name: 'fetch', message: 'src/engine must not perform IO.' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/data/db',
                '**/data/repo',
                '**/data/backup',
                '**/data/seed',
                '**/data/persistence',
                '**/data/boot',
                '**/data/schema',
                '**/data/migrations',
                'idb',
                'preact*',
              ],
              message:
                'src/engine must be pure: no IO, storage or UI imports. ' +
                'src/data/dates.ts is allowed — it is pure and clock-injected.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['tests/**/*.ts', '*.config.ts', 'eslint.config.js', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
