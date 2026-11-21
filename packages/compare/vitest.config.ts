import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// OfflineAudioContext に描画するテスト。Chromium（Playwright）で動かす。
// PLAYWRIGHT_CHROMIUM_PATH があればそのブラウザを使う（入っている Chromium の版が違う環境向け）
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(executablePath ? { launchOptions: { executablePath } } : {}),
      instances: [{ browser: "chromium" }],
    },
  },
});
