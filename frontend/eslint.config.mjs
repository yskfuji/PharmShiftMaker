import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// The Next.js shared preset currently pulls a glob parser with an unresolved
// high-severity advisory. These direct presets retain the checks that protect
// this React/TypeScript UI without loading that vulnerable development-only path.
export default tseslint.config(
  {
    ignores: ['.next/**', '.next-*/**', 'node_modules/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {jsx: true},
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: {version: 'detect'},
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.flat.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      'react/prop-types': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // Programmatic focus targets need tabIndex=-1; they are not tab stops.
      'jsx-a11y/no-noninteractive-tabindex': 'off',
      'jsx-a11y/no-redundant-roles': 'off',
      // Nested native labels are valid; the rule also rejects composed controls.
      'jsx-a11y/label-has-associated-control': 'off',
    },
  },
  {
    files: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'jsx-a11y/aria-role': 'off',
    },
  },
  {
    files: [
      'src/components/ContextLink.tsx',
      'src/components/ui/Card.tsx',
      'src/components/ui/Label.tsx',
    ],
    rules: {
      'jsx-a11y/anchor-has-content': 'off',
      'jsx-a11y/heading-has-content': 'off',
    },
  },
  {
    files: ['src/lib/loginPath.ts'],
    rules: {'no-control-regex': 'off'},
  },
);
