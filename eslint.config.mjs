// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['.vscode-test/', 'coverage/', 'dist/', 'out/']),
  {
    files: ['**/*.{ts,js,cjs,mjs}'],
    extends: [js.configs.recommended],
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error'
    }
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-console': 'error'
    }
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/extension.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              allowTypeImports: true,
              message:
                'Only src/extension.ts loads the VS Code API. Receive it as a parameter and import types only.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: globals.mocha },
    rules: {
      // Fakes implement Promise-returning APIs with async functions that have nothing to await.
      '@typescript-eslint/require-await': 'off'
    }
  },
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node }
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node }
  },
  prettier
);
