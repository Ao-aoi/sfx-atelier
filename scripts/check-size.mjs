// ランタイムのビルド結果が gzip 後 10KB 以下かを確かめる。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const LIMIT = 10 * 1024;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "packages/runtime/dist/sfx-runtime.js");

const raw = readFileSync(file);
const gz = gzipSync(raw, { level: 9 }).length;
console.log(`sfx-runtime.js: ${raw.length} B（gzip 後 ${gz} B / 上限 ${LIMIT} B）`);
if (gz > LIMIT) {
  console.error("ランタイムが gzip 後 10KB を超えています");
  process.exit(1);
}
