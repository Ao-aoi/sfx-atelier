import { defineConfig } from "vite";

// Pages では dist/editor/ に置く（scripts/build-site.mjs が写す）。相対パスで書き出す
export default defineConfig({
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
