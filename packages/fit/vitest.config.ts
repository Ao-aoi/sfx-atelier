import { defineConfig } from "vitest/config";

// Node で動くテスト（compile など）。Web Audio を使うテストは vitest.browser.config.ts
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.browser.test.ts"] },
});
