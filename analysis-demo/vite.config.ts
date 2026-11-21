import { defineConfig } from "vite";

// 音響分析デモ。ルートの npm run build が dist/analysis-demo に写す
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
