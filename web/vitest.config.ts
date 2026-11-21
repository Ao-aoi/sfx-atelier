import { defineConfig } from "vitest/config";

// Node で動くテスト（編集の操作・履歴・時間軸・読み書き）。画面のテストは vitest.browser.config.ts
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/**/*.browser.test.ts"] },
});
