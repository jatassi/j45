import js from '@eslint/js'
import prettierConfig from 'eslint-config-prettier'
import importX from 'eslint-plugin-import-x'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unicorn from 'eslint-plugin-unicorn'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['**/dist', '.claude', 'data', 'node_modules']),

  // ── Repo-wide TypeScript (domain, server, client, scripts) ──────
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/test/**/*.{ts,tsx}', 'packages/*/migrations/**/*.ts', 'e2e/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      unicorn.configs['flat/recommended'],
      prettierConfig,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'import-x': importX,
    },
    rules: {
      // ── Structural constraints ─────────────────────────────────
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-depth': ['error', 3],
      'max-params': ['error', 3],
      complexity: ['error', 10],
      // 3, not SlipStream's 2: Effect.gen(function* () {...}) burns a callback
      // level before any real nesting happens.
      'max-nested-callbacks': ['error', 3],

      // ── TypeScript ─────────────────────────────────────────────
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-confusing-void-expression': [
        'error',
        { ignoreArrowShorthand: true },
      ],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // ── Import sorting (auto-fixable) ──────────────────────────
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^react', '^react-dom'],
            ['^@?\\w'],
            ['^@/'],
            ['^\\.'],
            ['^.+\\.css$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',

      // ── Import hygiene ─────────────────────────────────────────
      'import-x/no-duplicates': 'error',
      'import-x/no-cycle': ['error', { maxDepth: 4 }],

      // ── Code quality ───────────────────────────────────────────
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
      'no-else-return': ['error', { allowElseIf: false }],
      'no-lonely-if': 'error',
      'no-unneeded-ternary': 'error',
      'no-nested-ternary': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSEnumDeclaration',
          message: 'Use `as const` objects instead of enums.',
        },
      ],

      // ── Unicorn overrides ──────────────────────────────────────
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-array-reduce': 'off',
      'unicorn/no-array-for-each': 'off',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/filename-case': ['error', { case: 'kebabCase' }],
      'unicorn/prefer-query-selector': 'off',
      // Effect's data-first combinators (Effect.map(self, f), Config.map…)
      // look like Array#map(callback, thisArg) to these rules.
      'unicorn/no-array-callback-reference': 'off',
      'unicorn/no-array-method-this-argument': 'off',
    },
  },

  // ── @effect/sql Migrator loads migrations by the `NNNN_name.ts`
  // convention; the underscore is the loader's parser, not a style choice.
  {
    files: ['packages/*/migrations/**/*.ts'],
    rules: {
      'unicorn/filename-case': 'off',
    },
  },

  // ── Tests: it.effect + Effect.gen start two callback levels deep, and
  // test bodies enumerate scenarios rather than decompose into helpers.
  {
    files: ['packages/*/test/**/*.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-nested-callbacks': ['error', 4],
    },
  },

  // ── Client-only: React, a11y, fast-refresh, browser globals ────
  {
    files: ['packages/client/src/**/*.{ts,tsx}'],
    extends: [
      react.configs.flat.recommended,
      react.configs.flat['jsx-runtime'],
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
      prettierConfig,
    ],
    languageOptions: {
      globals: globals.browser,
      // Re-stated: the react flat presets above reset parserOptions, losing
      // the project service inherited from the base block.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: { version: 'detect' },
      'import-x/resolver': {
        typescript: {
          project: './packages/client/tsconfig.json',
        },
      },
    },
    rules: {
      'react/no-array-index-key': 'error',
      'react/jsx-no-leaked-render': 'error',
      'react/hook-use-state': 'error',
      // allowAsProps: Result.match / render-prop callbacks return JSX from
      // object properties; they're invoked inline, not mounted as components.
      'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
      'react/jsx-curly-brace-presence': ['error', { props: 'never', children: 'never' }],
      'react/self-closing-comp': 'error',
      'react/jsx-boolean-value': ['error', 'never'],
      'react/jsx-no-useless-fragment': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // ── shadcn/ui generated components: variants exported alongside
  // components is the generator's idiom; fast-refresh purity doesn't apply.
  {
    files: ['packages/client/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // ── Server & scripts run under Bun: node-style globals ─────────
  {
    files: ['packages/server/**/*.ts', 'packages/domain/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // ── Last word on the parser: several React flat presets replace
  // parserOptions wholesale, dropping the project service; re-assert it
  // after every preset has had its say.
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'packages/*/test/**/*.{ts,tsx}', 'packages/*/migrations/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
