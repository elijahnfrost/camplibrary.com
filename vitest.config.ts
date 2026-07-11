import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Default env is node — fast, and covers the pure lib/server suites. A test
    // that needs a DOM (component render or a hook via renderHook) opts in with a
    // `// @vitest-environment happy-dom` pragma at the top of the file, so the
    // node suites never pay for a DOM they don't use.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
