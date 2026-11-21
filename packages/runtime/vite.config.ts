import { defineConfig } from "vite";

// ランタイムは依存なしの ESM 1 本にする。容量は scripts/check-size.mjs が gzip 後で測る
export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "sfx-runtime.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    minify: true,
    // lib モードの ES 出力は既定で空白を残すので、出力側でも縮める（ゲームに配るのはこのファイル）
    rolldownOptions: { output: { minify: true } },
    sourcemap: false,
  },
});
