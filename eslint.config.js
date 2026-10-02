import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default [
  { ignores: ["node_modules/**", "dist/**", "test-results/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: { quotes: ["error", "double", { avoidEscape: true }] },
  },
]
