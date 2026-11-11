// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * O código de medição (service worker, código injetado e funções compartilhadas)
 * nunca pode depender do framework de interface. Ver design da fase 0.
 */
const isolamentoDaInterface = {
  patterns: [
    {
      regex: '^@angular(/|$)',
      message: 'Código de medição não pode importar Angular.',
    },
    {
      regex: '(^|/)ui(/|$)',
      message: 'Código de medição não pode importar de extensao/ui.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['extensao/shared/gerado/**', 'dist/**', 'node_modules/**', 'extensao/ui/.angular/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['scripts/**', '*.config.*', 'testes/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: [
      'extensao/background/**/*.{ts,js,mjs}',
      'extensao/injected/**/*.{ts,js,mjs}',
      'extensao/shared/**/*.{ts,js,mjs}',
    ],
    rules: {
      'no-restricted-imports': ['error', isolamentoDaInterface],
    },
  },
);
