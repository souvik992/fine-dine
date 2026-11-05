// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-*/**', '**/.tsbuild/**', '**/release/**', '**/.stage/**', '**/build-cache/**', '**/out/**', '**/coverage/**', '**/node_modules/**', '**/data/**', '**/.build/**', 'addons/*/scripts/*.d.mts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['*.js', '*.ts', 'apps/*/scripts/*.mjs', 'addons/*/scripts/*.mjs', 'apps/*/*.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Shared code must run in Node, the Electron renderer and PWAs: no platform modules.
    files: ['packages/shared/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: '@dinepos/shared must stay platform-neutral.' },
            {
              group: ['fs', 'path', 'os', 'net', 'crypto', 'child_process', 'better-sqlite3', 'electron'],
              message: '@dinepos/shared must stay platform-neutral.',
            },
          ],
        },
      ],
    },
  },
  {
    // Plain JS and build-tool configs: lint without type information.
    files: ['**/*.{js,mjs,cjs}', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // CommonJS config files (electron-builder) use require by design.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
