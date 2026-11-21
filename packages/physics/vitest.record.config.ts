import { defineConfig } from "vitest/config";

// 物理の録音を recordings/ に書き出す（npm run record -w @sfx-atelier/physics）
export default defineConfig({ test: { include: ["scripts/record.ts"] } });
