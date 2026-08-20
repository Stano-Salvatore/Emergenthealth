import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design handoff bundle — HTML prototypes and their runtime, reference
    // material only, never imported by the app.
    "design/**",
  ]),
  {
    rules: {
      // A leading underscore is this codebase's way of saying "required by the
      // signature, deliberately unused" — a route handler that ignores its
      // request, a stub that has to match an interface. Without this, the only
      // way to silence the warning is to delete a parameter the caller still
      // passes, which is worse.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
