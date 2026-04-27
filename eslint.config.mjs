// Flat ESLint config (ESLint v9+). Linted by `pnpm lint`.
  import js from "@eslint/js";
  import tseslint from "typescript-eslint";
  import globals from "globals";

  export default tseslint.config(
    {
      ignores: ["**/dist/**", "**/node_modules/**", "pnpm-lock.yaml"],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: import.meta.dirname,
        },
        globals: {
          ...globals.node,
        },
      },
      rules: {
        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-non-null-assertion": "warn",
      },
    },
    {
      // Loosen type-checked rules on plain JS files (this config file itself, etc.)
      files: ["**/*.js", "**/*.mjs"],
      ...tseslint.configs.disableTypeChecked,
    },
  );
