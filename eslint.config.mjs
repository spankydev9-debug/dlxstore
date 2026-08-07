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
  ]),
  {
    rules: {
      // French text contains apostrophes — safe to allow in JSX
      "react/no-unescaped-entities": "off",
      // Supabase dynamic query results + localStorage data don't have static types
      "@typescript-eslint/no-explicit-any": "warn",
      // Next.js App Router pattern: syncing URL search params to state in effects is idiomatic
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
