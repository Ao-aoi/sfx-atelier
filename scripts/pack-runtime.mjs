// ランタイムの npm 公開用のフォルダを packages/runtime/npm/ に作る（公開は npm publish packages/runtime/npm）。
//   sfx-runtime.js      Vite でビルドした ESM 1 本（npm run build -w @sfx-atelier/runtime の出力）
//   types/              型定義。format の型（types・defaults・pitch）も types/format/ に入れ、import を相対に書き換える
//   package.json        packages/runtime/package.json の名前・版・説明から作る（private を外し、依存なし）
//   README.md・LICENSE
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "packages/runtime");
const out = join(pkgDir, "npm");
const tmp = join(pkgDir, "npm-tmp");

rmSync(out, { recursive: true, force: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(join(out, "types/format"), { recursive: true });

execFileSync("npm", ["run", "build", "-w", "@sfx-atelier/runtime"], { cwd: root, stdio: "inherit" });
cpSync(join(pkgDir, "dist/sfx-runtime.js"), join(out, "sfx-runtime.js"));

// 型定義：runtime の src と、format のうちランタイムが使う 3 つだけ
const tsconfig = join(pkgDir, "tsconfig.pack.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    extends: "../../tsconfig.base.json",
    compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: "..", outDir: "npm-tmp" },
    files: ["src/index.ts", "../format/src/types.ts", "../format/src/defaults.ts", "../format/src/pitch.ts"],
  }),
);
try {
  execFileSync("npx", ["tsc", "-p", tsconfig], { cwd: pkgDir, stdio: "inherit" });
} finally {
  rmSync(tsconfig, { force: true });
}

const rewrite = (text, toFormat) => text.replace(/(["'])@sfx-atelier\/format\/(types|defaults|pitch)\1/g, (_m, q, f) => `${q}${toFormat}${f}${q}`);
for (const f of readdirSync(join(tmp, "runtime/src"))) {
  writeFileSync(join(out, "types", f), rewrite(readFileSync(join(tmp, "runtime/src", f), "utf8"), "./format/"));
}
for (const f of ["types.d.ts", "defaults.d.ts", "pitch.d.ts"]) {
  writeFileSync(join(out, "types/format", f), rewrite(readFileSync(join(tmp, "format/src", f), "utf8"), "./"));
}
rmSync(tmp, { recursive: true, force: true });

const src = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const pkg = {
  name: src.name,
  version: src.version,
  description: src.description,
  license: "MIT",
  type: "module",
  main: "./sfx-runtime.js",
  types: "./types/index.d.ts",
  exports: { ".": { types: "./types/index.d.ts", import: "./sfx-runtime.js" } },
  files: ["sfx-runtime.js", "types", "README.md", "LICENSE"],
  sideEffects: false,
  repository: { type: "git", url: "git+https://github.com/Ao-aoi/sfx-atelier.git", directory: "packages/runtime" },
  keywords: ["webaudio", "sound-effects", "sfx", "game", "audio"],
};
writeFileSync(join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
cpSync(join(pkgDir, "README.md"), join(out, "README.md"));
cpSync(join(pkgDir, "LICENSE"), join(out, "LICENSE"));
console.log(`packages/runtime/npm/ に ${pkg.name}@${pkg.version} を用意しました`);
