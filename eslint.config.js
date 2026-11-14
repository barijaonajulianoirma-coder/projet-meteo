import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'dist-server/**',
      'data/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      '_kit_extracted/**',
      'dagster_project/**',
      'public/**',
      '.venv/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // TypeScript vérifie déjà les identifiants globaux.
      'no-undef': 'off',
      // Les paramètres préfixés par _ sont volontairement inutilisés.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Les logs serveur sont le mécanisme de diagnostic actuel.
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
