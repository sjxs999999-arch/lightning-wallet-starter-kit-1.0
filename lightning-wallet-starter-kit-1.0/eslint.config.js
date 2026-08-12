import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = ['**/*.{ts,tsx}'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/.vercel/**', 'wallet-studio-pro/**', 'Wallet Studio Pro.app/**'] },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs}'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
    rules: { ...js.configs.recommended.rules, 'no-unused-vars': 'off', 'no-empty': ['error', { allowEmptyCatch: true }] },
  },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: typescriptFiles })),
  {
    files: typescriptFiles,
    languageOptions: { globals: { ...globals.node, ...globals.browser, WorkerGlobalScope: 'readonly' } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
);
