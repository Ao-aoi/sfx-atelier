import { defineConfig } from "vite";

// A/B のページ。ルートの npm run build が dist/ab に写す
export default defineConfig({
  root: "ab",
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true },
});
