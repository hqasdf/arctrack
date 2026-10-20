import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

// Separate from Next.js lint: native screens do not use DOM/Next.js rules.
// Keep compiler diagnostics enabled so existing findings remain visible.
export default defineConfig([
  {
    files: ["apps/mobile/app/**/*.{ts,tsx}", "apps/mobile/src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { __DEV__: "readonly" } },
  },
]);
