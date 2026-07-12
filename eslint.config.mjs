import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      '**/*.d.ts',
      'node_modules/**',
      'src/test/**',
      'src/__tests__/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      // Plain browser JS (webview scripts) and config files are not linted,
      // matching the previous `--ext ts` behavior.
      '**/*.js',
      '**/*.mjs',
      'playwright.config.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      '@typescript-eslint/no-invalid-void-type': 'off',
    },
  },
);
