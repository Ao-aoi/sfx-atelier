/**
 * MCP のツール。読み取り量を増やさないよう、返り値はここで短い文章と縮めた JSON に絞る。
 * 書き込みは作品（save_sound）・変更案（apply_patch）・用途と好みの記憶（update_context）だけ。
 * 音の描画は Workers ではできないので、聞こえ方の数字はエディタが付けた分析の要約（get_analysis）だけを返す。
 */
import { normalizeBank, normalizeScore, shrinkBank, shrinkScore, type Bank, type Score, type Sound } from "@sfx-atelier/format";
import {
  applyPatchToSound,
  createSound,
  findSound,
  getAnalysis,
  getContext,
  getSound,
  HttpError,
  LIMITS,
  listSounds,
  listVersions,
  saveVersion,
  updateContext,
  type SoundVersion,
} from "@sfx-atelier/store";
import type { McpEnv } from "./env";

export interface ToolAccess {
  canWrite: boolean;
  /** 接続元アプリの名前（OAuth のクライアント名）。無いこともある */
  clientName?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 書き込むツールは false（tools/list の readOnlyHint） */
  readOnly?: boolean;
  run(env: McpEnv, userId: string, args: Record<string, unknown>, access: ToolAccess): Promise<string>;
}

/** 引数が正しくないとき。MCP ではツールのエラー（isError）として返す */
export class ToolInputError extends Error {}

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v === "") throw new ToolInputError(`${key} が必要です`);
  return v;
}

function optInt(args: Record<string, unknown>, key: string, min = 1): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min) throw new ToolInputError(`${key} は ${min} 以上の整数です`);
  return n;
}

/** JSON で渡されたもの（オブジェクトか、JSON の文字列） */
function jsonArg(args: Record<string, unknown>, key: string): unknown {
  const v = args[key];
  if (v === undefined) throw new ToolInputError(`${key} が必要です`);
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new ToolInputError(`${key} が JSON として読めません`);
  }
}

/** 版の書き手：接続元アプリの名前（小文字、40 文字まで）。分からなければ mcp */
export function authorOf(clientName: string | undefined): string {
  const n = clientName?.trim().toLowerCase().slice(0, 40);
  return n || "mcp";
}

// ---- 縮めた JSON に id を戻す ----

/** 縮めた形に、正規化で振られる id（トラック t1…、音符 n1…）を書き戻す。変更案の path で指せるように */
function soundWithIds(shrunk: Sound, normalized: Sound): Sound {
  return {
    ...shrunk,
    tracks: shrunk.tracks.map((t, i) => {
      const nt = normalized.tracks[i]!;
      return { id: nt.id, ...t, notes: t.notes.map((n, j) => ({ id: nt.notes[j]!.id, ...n })) };
    }),
  };
}

export function compactWithIds(body: Score | Bank, part?: string): Score | Bank {
  if (body.format === "sfx-score/1") {
    const norm = normalizeScore(body as Score);
    return soundWithIds(shrinkScore(norm), norm) as Score;
  }
  const norm = normalizeBank(body as Bank);
  const shrunk = shrinkBank(norm);
  const names = part ? [part] : Object.keys(shrunk.sounds);
  if (part && !shrunk.sounds[part]) throw new ToolInputError(`バンクに「${part}」がありません（${Object.keys(shrunk.sounds).join("・")}）`);
  const sounds = Object.fromEntries(names.map((k) => [k, soundWithIds(shrunk.sounds[k]!, norm.sounds[k]!)]));
  if (!part) return { ...shrunk, sounds };
  // 1 音だけ：その音が使う楽器・残響・録音だけを持たせる（path はバンクと同じ形のまま）
  const s = sounds[part]!;
  const used = new Set(s.tracks.map((t) => t.instrument));
  const sends = new Set(s.tracks.flatMap((t) => Object.keys(t.send ?? {})));
  const pick = <T>(o: Record<string, T> | undefined, keep: (k: string) => boolean) => (o ? Object.fromEntries(Object.entries(o).filter(([k]) => keep(k))) : undefined);
  const instruments = pick(shrunk.instruments, (k) => used.has(k));
  const samples = new Set(Object.values(instruments ?? {}).flatMap((i) => i.layers.flatMap((l) => ("sample" in l ? [l.sample] : []))));
  const out: Bank = { format: shrunk.format, sounds };
  if (shrunk.master) out.master = shrunk.master;
  if (instruments && Object.keys(instruments).length) out.instruments = instruments;
  const reverb = pick(shrunk.reverb, (k) => sends.has(k));
  if (reverb && Object.keys(reverb).length) out.reverb = reverb;
  const sm = pick(shrunk.samples, (k) => samples.has(k));
  if (sm && Object.keys(sm).length) out.samples = sm;
  return out;
}

function header(v: SoundVersion): string {
  const tags = v.tags.length ? ` タグ:${v.tags.join("・")}` : "";
  const latest = v.version === v.latestVersion ? "最新" : `最新は ${v.latestVersion}`;
  return `${v.name}（${v.kind}、id ${v.id}）版 ${v.version}（${latest}、base_version ${v.latestVersion}）${tags} 書き手:${v.author} ${v.createdAt.slice(0, 16).replace("T", " ")}`;
}

const soundProp = { type: "string", description: "作品の id か名前（list_sounds の id・名前）" };
const versionProp = { type: "integer", minimum: 1, description: "版（省略すると最新）" };
const baseProp = { type: "integer", minimum: 1, description: "読んだときの版（get_sound の base_version）。最新でなければ断られる" };
const noteProp = { type: "string", maxLength: LIMITS.maxNoteChars, description: "何を変えたか（人が読む短い説明）" };

export const TOOLS: ToolDef[] = [
  {
    name: "get_context",
    description: "用途と好みの記憶（どのゲームの音か、好きな音・避けたい音など。60 行以内）と、その base_version。最初に呼ぶ",
    inputSchema: { type: "object", properties: {} },
    async run(env, userId) {
      const c = await getContext(env, userId);
      return [`=== 用途と好み base_version ${c.version}${c.updatedAt ? `（${c.updatedAt.slice(0, 10)} 更新）` : "（まだありません）"} ===`, c.markdown || "（まだありません）"].join("\n");
    },
  },
  {
    name: "update_context",
    description: "用途と好みの記憶を書き換える（全文。60 行以内）。base_version は get_context の版（まだ無ければ 0）",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { markdown: { type: "string" }, base_version: { type: "integer", minimum: 0 } },
      required: ["markdown", "base_version"],
    },
    async run(env, userId, args) {
      const c = await updateContext(env, userId, { markdown: args.markdown, baseVersion: optInt(args, "base_version", 0) });
      return `保存しました（base_version ${c.version}）`;
    },
  },
  {
    name: "list_sounds",
    description: "作品の一覧（新しく更新した順）。1 行に id・名前・種類・版・タグ・書き手・更新日",
    inputSchema: {
      type: "object",
      properties: { tag: { type: "string", description: "このタグの作品だけ" }, limit: { type: "integer", minimum: 1, maximum: LIMITS.maxList } },
    },
    async run(env, userId, args) {
      const list = await listSounds(env, userId, { tag: typeof args.tag === "string" && args.tag ? args.tag : undefined, limit: optInt(args, "limit") ?? 30 });
      if (!list.length) return "作品はまだありません";
      return list
        .map((s) => `${s.id} | ${s.name} | ${s.kind} | 版 ${s.version} | ${s.tags.join("・") || "-"} | ${s.author} | ${s.updatedAt.slice(0, 10)}`)
        .join("\n");
    },
  },
  {
    name: "get_sound",
    description:
      "作品の 1 つの版。1 行目が見出し（版・base_version）、2 行目からが縮めた JSON（既定値は省略、トラックと音符の id 付き。変更案の path にそのまま使える）。バンクは part で 1 音だけにできる",
    inputSchema: {
      type: "object",
      properties: { sound: soundProp, version: versionProp, part: { type: "string", description: "バンクのとき：この音だけ（その音が使う楽器・残響も付く）" } },
      required: ["sound"],
    },
    async run(env, userId, args) {
      const v = await getSound(env, userId, str(args, "sound"), optInt(args, "version"));
      const part = typeof args.part === "string" && args.part ? args.part : undefined;
      if (part && v.kind !== "bank") throw new ToolInputError("part はバンクのときだけ使えます");
      const lines = [header(v)];
      if (v.note) lines.push(`説明：${v.note}`);
      lines.push(JSON.stringify(compactWithIds(v.body, part)));
      return lines.join("\n");
    },
  },
  {
    name: "list_versions",
    description: "作品の版の一覧（新しい順）。版・書き手・変更案からか・説明",
    inputSchema: { type: "object", properties: { sound: soundProp, limit: { type: "integer", minimum: 1, maximum: LIMITS.maxList } }, required: ["sound"] },
    async run(env, userId, args) {
      const vs = await listVersions(env, userId, str(args, "sound"), optInt(args, "limit") ?? 20);
      return vs.map((v) => `版 ${v.version} | ${v.author}${v.fromPatch ? "（変更案）" : ""} | ${v.createdAt.slice(0, 16).replace("T", " ")} | ${v.note ?? ""}`).join("\n");
    },
  },
  {
    name: "get_analysis",
    description: "エディタが描画して測った分析の要約（analysis-report/1、80 行以内）。音の長さ・明るさ・立ち上がりなどの根拠はこれだけ",
    inputSchema: { type: "object", properties: { sound: soundProp, version: versionProp }, required: ["sound"] },
    async run(env, userId, args) {
      const a = await getAnalysis(env, userId, str(args, "sound"), optInt(args, "version"));
      return a.analysis ?? `版 ${a.version} には分析の要約がありません（エディタで開いて保存すると付きます）`;
    },
  },
  {
    name: "apply_patch",
    description:
      "変更案（sfx-patch/1：{ format, note?, ops: [{ op: set|add|remove, path, value?, at? }] }）を最新の版に当てて、新しい版として保存する。path はオブジェクトのキーと、配列の id（文字列）か番号。全部当たるか何も変えないか。エディタで開くと差分が出る",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { sound: soundProp, patch: { type: "object", description: "sfx-patch/1" }, base_version: baseProp, note: noteProp },
      required: ["sound", "patch", "base_version"],
    },
    async run(env, userId, args, access) {
      const r = await applyPatchToSound(env, userId, str(args, "sound"), {
        patch: jsonArg(args, "patch"),
        baseVersion: optInt(args, "base_version"),
        note: args.note,
        author: authorOf(access.clientName),
      });
      return `版 ${r.version} として保存しました（base_version ${r.version}）。元に戻す変更案：${JSON.stringify(r.inverse)}`;
    },
  },
  {
    name: "save_sound",
    description:
      "作品を丸ごと保存する。base_version が無ければ新しい作品（name は未使用のもの）、あればその作品の新しい版。部分的に直すときは apply_patch を使う",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "新しい作品の名前、または上書きする作品の id か名前" },
        body: { type: "object", description: "sfx-score/1 か sfx-bank/1" },
        base_version: baseProp,
        tags: { type: "array", items: { type: "string" }, description: "新しい作品のタグ" },
        note: noteProp,
      },
      required: ["name", "body"],
    },
    async run(env, userId, args, access) {
      const name = str(args, "name");
      const body = jsonArg(args, "body");
      const author = authorOf(access.clientName);
      if (args.base_version === undefined || args.base_version === null) {
        const r = await createSound(env, userId, { name, body, tags: args.tags, note: args.note, author });
        return `新しい作品「${name}」を作りました（id ${r.id}、base_version ${r.version}）`;
      }
      const s = await findSound(env, userId, name);
      const r = await saveVersion(env, userId, s.id, { body, baseVersion: optInt(args, "base_version"), note: args.note, author });
      return `「${s.name}」を版 ${r.version} として保存しました（base_version ${r.version}）`;
    },
  },
];

export async function callTool(
  env: McpEnv,
  userId: string,
  name: string,
  args: Record<string, unknown>,
  access: ToolAccess,
): Promise<{ text: string; isError: boolean }> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { text: `${name} というツールはありません`, isError: true };
  if (tool.readOnly === false && !access.canWrite) {
    return { text: "この接続には書き込みの許可がありません。コネクタを接続し直して、許可の画面で許可してください", isError: true };
  }
  try {
    return { text: await tool.run(env, userId, args, access), isError: false };
  } catch (e) {
    if (e instanceof ToolInputError || e instanceof HttpError) return { text: e.message, isError: true };
    throw e;
  }
}
