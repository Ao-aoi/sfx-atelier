import { defineConfig } from "vitest/config";

// テスト。録音の書き出し（scripts/record.ts）は npm run record で別に動かす
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
