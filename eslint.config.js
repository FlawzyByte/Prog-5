// @ts-check
import js from "@eslint/js";
export default [
  js.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {},
  },
];

