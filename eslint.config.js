import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // The underscore-prefixed folders are local scratch copies of this repo, not
  // part of the app. Leaving them linted makes the parser resolve several
  // candidate tsconfig roots and the whole run fails before it reads a file.
  { ignores: ['dist', 'node_modules', 'apps', '_*-clean'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Data-fetching effects fetch async + setState in callbacks; the compiler-mode
      // rule flags even `void load()` where effect -> async -> setState. It is noise here.
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // lib/ files export hooks + providers next to components; fast-refresh rule is irrelevant there.
    files: ['src/lib/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
)