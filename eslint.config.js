import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    /* Every workspace package lints its whole directory (`eslint .`) rather
       than a hand-listed set of source folders, so a new folder is covered the
       day it appears. That only works if the generated trees are ignored here:
       `.next` alone carries ~2,700 problems and was what made a whole-package
       lint look impossible. Each entry below is a tree something else writes —
       `.gitignore` names them too — never a folder of ours we would rather not
       look at. */
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/temp/**",
      "**/coverage/**",
      "**/node_modules/**",
      "playwright-report/**",
      "status/snapshots/*.tgz",
      "status/changeset-status.json",
      "test-results/**",
    ],
  },
  {
    ...js.configs.recommended,
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "module",
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ...config.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  })),
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      /* A leading underscore marks a parameter the signature requires and the
         body deliberately ignores — a stub that must match a DOM callback's
         arity, a handler that only wants its second argument. Deleting such a
         parameter loses the type annotation that documents what is being
         ignored, so the convention earns its keep.

         Scoped to ARGUMENTS on purpose. `varsIgnorePattern` is left alone, so
         a dead local binding is still an error: that is the class that hides
         a test control which was computed and never asserted on, which is
         exactly what this rule caught in the website suite when the lint
         scripts were widened to the whole package. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/website/app/**/*.{ts,tsx}"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    files: ["packages/react/src/**/*.tsx"],
    rules: {
      /* Rule options replace rather than merge, so the `^_` argument
         convention above has to be restated here or these files would quietly
         lose it. */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^(?:createElement|Fragment)$",
        },
      ],
    },
  },
);
