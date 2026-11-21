// 右（狭い画面では下）の編集欄：トラック・音符・楽器（層）・音全体。
// 欄の中で変えたときは描き直さない（入力中の欄が消えないように）。元に戻す・ピアノロールの変更では描き直す。
import { ENV_DEFAULT, FILTER_DEFAULT, SAMPLE_ENV_DEFAULT, type Envelope, type FilterType, type Layer, type Note, type Score } from "@sfx-atelier/format";
import type { App } from "../app";
import {
  addLayer,
  addTrack,
  deleteNotes,
  duplicateLayer,
  findNote,
  forkInstrument,
  newLayer,
  removeLayer,
  removeReverb,
  removeTrack,
  renameInstrument,
  setLayer,
  setNoteDur,
  setReverb,
  setTrack,
  updateNote,
  freshName,
} from "../model/ops";
import { isPitched } from "../model/pitch";
import { field, h, iconButton, numberInput, select, slider } from "./dom";
import { ICON } from "./icons";
import { TRACK_COLORS } from "./roll";

const SELF = Symbol("panel");

const WAVES: [string, string][] = [
  ["sine", "正弦波"],
  ["triangle", "三角波"],
  ["square", "矩形波"],
  ["sawtooth", "のこぎり波"],
];
const NOISES: [string, string][] = [
  ["white", "白"],
  ["pink", "ピンク"],
  ["brown", "ブラウン"],
];
const FILTERS: [FilterType | "", string][] = [
  ["", "なし"],
  ["lowpass", "ローパス"],
  ["highpass", "ハイパス"],
  ["bandpass", "バンドパス"],
  ["notch", "ノッチ"],
  ["peaking", "ピーキング"],
  ["lowshelf", "ローシェルフ"],
  ["highshelf", "ハイシェルフ"],
];
const CURVES: [string, string][] = [
  ["exp", "指数"],
  ["lin", "直線"],
];

export class Panels {
  readonly el: HTMLElement;

  constructor(private app: App) {
    this.el = h("aside", { class: "panels" });
    app.on((c, from) => {
      if (from === SELF) return;
      if (c === "doc" || c === "select" || c === "source") this.render();
    });
    this.render();
  }

  /** score を変える（欄からの変更。key が同じものは履歴で 1 手にまとめる） */
  private set(next: Score, key?: string, rerender = false) {
    this.app.edit(next, { key, from: rerender ? undefined : SELF });
  }

  private render() {
    // 開いている折りたたみと、縦のスクロール位置を保つ
    const open = new Map([...this.el.querySelectorAll("details")].map((d) => [d.dataset.k!, d.open]));
    const scroll = this.el.scrollTop;
    this.el.replaceChildren(this.trackSection(), this.noteSection(), this.instrumentSection(), this.soundSection());
    for (const d of this.el.querySelectorAll("details")) if (open.has(d.dataset.k!)) d.open = open.get(d.dataset.k!)!;
    this.el.scrollTop = scroll;
  }

  private section(key: string, title: string, actions: Node[], ...body: (Node | null)[]) {
    return h(
      "details",
      { open: true, "data-k": key },
      h("summary", {}, h("span", { class: "title" }, title), h("span", { class: "actions" }, ...actions)),
      h("div", { class: "body" }, ...body),
    );
  }

  // ---- トラック ----

  private trackSection() {
    const app = this.app;
    const s = app.score;
    const list = h(
      "div",
      { class: "tracks", role: "listbox", "aria-label": "トラック" },
      ...s.tracks.map((t, i) => {
        const muted = app.muted.has(t.id!);
        return h(
          "div",
          { class: `track${t.id === app.selTrack ? " sel" : ""}`, role: "option", "aria-selected": String(t.id === app.selTrack) },
          h("span", { class: "chip", style: `background:${TRACK_COLORS[i % TRACK_COLORS.length]}` }),
          h("button", { type: "button", class: "name", onclick: () => app.select(t.id!, []) }, t.instrument, h("small", {}, ` ${t.notes.length}`)),
          iconButton(muted ? ICON.mute : ICON.volume, muted ? "消音を解除" : "消音", () => {
            if (muted) app.muted.delete(t.id!);
            else app.muted.add(t.id!);
            this.render();
            app.emit("view");
          }, { "aria-pressed": String(muted) }),
        );
      }),
    );
    const track = s.tracks.find((t) => t.id === app.selTrack);
    const actions = [
      iconButton(ICON.plus, "トラックを追加", () => {
        const { score, id } = addTrack(s);
        app.selTrack = id;
        app.sel = [];
        this.set(score, undefined, true);
      }),
    ];
    if (track && s.tracks.length > 1) actions.push(iconButton(ICON.trash, "トラックを削除", () => this.set(removeTrack(s, track.id!), undefined, true)));
    let detail: HTMLElement | null = null;
    if (track) {
      const id = track.id!;
      const reverbs = Object.keys(s.reverb ?? {});
      detail = h(
        "div",
        { class: "grid" },
        field(
          "楽器",
          select(
            track.instrument,
            [...Object.keys(s.instruments ?? {}).map((k) => [k, k] as [string, string]), ["\u0000new", "新しい楽器"]],
            (v) => {
              if (v === "\u0000new") {
                const name = freshName(Object.keys(s.instruments ?? {}), "楽器");
                this.set(setTrack({ ...s, instruments: { ...s.instruments, [name]: { layers: [newLayer()] } } }, id, { instrument: name }), undefined, true);
              } else this.set(setTrack(s, id, { instrument: v }), undefined, true);
            },
            "楽器",
          ),
        ),
        field("音量", slider(track.gain ?? 1, (v) => this.set(setTrack(app.score, id, { gain: v }), `tg${id}`), { min: 0, max: 2, step: 0.01, label: "トラックの音量" })),
        field("左右", slider(track.pan ?? 0, (v) => this.set(setTrack(app.score, id, { pan: v }), `tp${id}`), { min: -1, max: 1, step: 0.01, label: "トラックの左右" })),
        ...reverbs.map((r) =>
          field(
            `残響 ${r}`,
            numberInput(track.send?.[r] ?? 0, (v) => this.set(setTrack(app.score, id, { send: { ...track.send, [r]: v ?? 0 } })), { min: 0, max: 4, step: 0.05, label: `残響 ${r} への送り` }),
          ),
        ),
        ...this.jitterFields(track.jitter, (j) => this.set(setTrack(app.score, id, { jitter: j })), "音符ごとの揺らぎ"),
      );
    }
    return this.section("tracks", "トラック", actions, list, detail);
  }

  private jitterFields(j: { tune?: number; gain?: number; time?: number } | undefined, onChange: (j: { tune: number; gain: number; time: number }) => void, label: string) {
    const cur = { tune: j?.tune ?? 0, gain: j?.gain ?? 0, time: j?.time ?? 0 };
    return [
      field("揺らぎ（セント）", numberInput(cur.tune, (v) => onChange({ ...cur, tune: v ?? 0 }), { min: 0, max: 2400, step: 1, label: `${label}：高さ` })),
      field("揺らぎ（音量）", numberInput(cur.gain, (v) => onChange({ ...cur, gain: v ?? 0 }), { min: 0, max: 1, step: 0.01, label: `${label}：音量` })),
      field("揺らぎ（秒）", numberInput(cur.time, (v) => onChange({ ...cur, time: v ?? 0 }), { min: 0, max: 1, step: 0.001, label: `${label}：時刻` })),
    ];
  }

  // ---- 音符 ----

  private noteSection() {
    const app = this.app;
    const s = app.score;
    if (app.sel.length === 0) return h("div");
    const del = iconButton(ICON.trash, "音符を削除", () => this.set(deleteNotes(s, app.sel), undefined, true));
    if (app.sel.length > 1) return this.section("note", `音符 ${app.sel.length}`, [del]);
    const ref = app.sel[0]!;
    const n = findNote(s, ref);
    const track = s.tracks.find((t) => t.id === ref.track);
    if (!n || !track) return h("div");
    const pitched = isPitched(s.instruments?.[track.instrument]);
    const up = (f: (x: Note) => Note, key?: string) => this.set(updateNote(app.score, ref, f), key);
    const unit = s.time?.unit === "beat" ? "拍" : "秒";
    return this.section(
      "note",
      "音符",
      [del],
      h(
        "div",
        { class: "grid" },
        field(`開始（${unit}）`, numberInput(n.t, (v) => this.set(updateNote(app.score, ref, (x) => ({ ...x, t: Math.max(0, v ?? 0) })), undefined, true), { min: 0, step: "any", label: "開始" })),
        field(
          `長さ（${unit}）`,
          numberInput(n.dur, (v) => this.set(setNoteDur(app.score, ref, v), undefined, true), { min: 0.001, optional: true, placeholder: "自動", label: "長さ" }),
        ),
        pitched
          ? field(
              "高さ",
              h("input", {
                type: "text",
                value: n.pitch === undefined ? "" : String(n.pitch),
                placeholder: "A4",
                "aria-label": "高さ（音名か Hz）",
                onchange: (e: Event) => {
                  const raw = (e.target as HTMLInputElement).value.trim();
                  const pitch = raw === "" ? undefined : /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
                  this.set(updateNote(app.score, ref, (x) => {
                    const { pitch: _p, ...rest } = x;
                    return pitch === undefined ? rest : { ...rest, pitch };
                  }), undefined, true);
                },
              }),
            )
          : null,
        field("ずらし（セント）", numberInput(n.tune ?? 0, (v) => this.set(updateNote(app.score, ref, (x) => ({ ...x, tune: v ?? 0 })), undefined, true), { step: 1, label: "ずらし（セント）" })),
        field("強さ", slider(n.vel ?? 1, (v) => up((x) => ({ ...x, vel: v }), `vel${ref.track}/${ref.note}`), { min: 0, max: 1, step: 0.01, label: "強さ" })),
      ),
    );
  }

  // ---- 楽器 ----

  private instrumentSection() {
    const app = this.app;
    const s = app.score;
    const track = s.tracks.find((t) => t.id === app.selTrack);
    const name = track?.instrument;
    const ins = name ? s.instruments?.[name] : undefined;
    if (!track || !name || !ins) return h("div");
    const users = s.tracks.filter((t) => t.instrument === name).length;
    const actions = [
      iconButton(ICON.copy, "楽器を複製してこのトラックに使う", () => this.set(forkInstrument(s, track.id!), undefined, true)),
    ];
    const nameInput = h("input", {
      type: "text",
      value: name,
      "aria-label": "楽器の名前",
      onchange: (e: Event) => this.set(renameInstrument(app.score, name, (e.target as HTMLInputElement).value), undefined, true),
    });
    const samples = Object.keys(s.samples ?? {});
    return this.section(
      "instrument",
      "楽器",
      actions,
      h("div", { class: "grid" }, field("名前", nameInput), users > 1 ? field("使っているトラック", h("output", {}, String(users))) : null),
      ...ins.layers.map((l, i) => this.layerCard(name, l, i, samples)),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "add", onclick: () => this.set(addLayer(app.score, name), undefined, true), html: `${ICON.plus}<span>発振器</span>` }),
        h(
          "button",
          {
            type: "button",
            class: "add",
            onclick: () => this.set(addLayer(app.score, name, { noise: "white", gain: 0.5, pan: 0, env: { ...ENV_DEFAULT, a: 0.001, d: 0.05 }, jitter: { tune: 0, gain: 0, time: 0 } }), undefined, true),
            html: `${ICON.plus}<span>雑音</span>`,
          },
        ),
      ),
    );
  }

  private layerCard(name: string, l: Layer, i: number, samples: string[]) {
    const app = this.app;
    const key = (k: string) => `L${name}/${i}/${k}`;
    const put = (next: Layer, k?: string, rerender = false) => this.set(setLayer(app.score, name, i, next), k && key(k), rerender);
    const cur = () => app.score.instruments![name]!.layers[i]!;

    const kind = "osc" in l ? "osc" : "noise" in l ? "noise" : "sample";
    const kinds: [string, string][] = [
      ["osc", "発振器"],
      ["noise", "雑音"],
    ];
    if (samples.length || kind === "sample") kinds.push(["sample", "録音"]);
    const common = (x: Layer) => {
      const { osc: _o, freq: _f, ratio: _r, noise: _n, sample: _s, ...rest } = x as Layer & Record<string, unknown>;
      return rest;
    };
    const kindSel = select(kind, kinds, (k) => {
      const base = common(cur());
      const next: Layer = k === "osc" ? { ...base, osc: "sine", ratio: 1 } : k === "noise" ? { ...base, noise: "white" } : { ...base, sample: samples[0]!, ratio: 1, env: { ...SAMPLE_ENV_DEFAULT } };
      put(next, undefined, true);
    }, "層の種類");

    const head: Node[] = [kindSel];
    const src: Node[] = [];
    if ("osc" in l) {
      head.push(select(l.osc, WAVES as [typeof l.osc, string][], (v) => put({ ...(cur() as typeof l), osc: v }), "波形"));
      const mode = l.freq !== undefined ? "freq" : "ratio";
      src.push(
        field(
          "高さ",
          select(mode, [["ratio", "倍率"], ["freq", "Hz"]], (m) => {
            const { freq: _f, ratio: _r, ...rest } = cur() as typeof l;
            put(m === "freq" ? { ...rest, freq: 440 } : { ...rest, ratio: 1 }, undefined, true);
          }, "高さの決め方"),
          mode === "freq"
            ? numberInput(l.freq, (v) => put({ ...(cur() as typeof l), freq: v ?? 440 }), { min: 1, max: 24000, label: "周波数（Hz）" })
            : numberInput(l.ratio ?? 1, (v) => put({ ...(cur() as typeof l), ratio: v ?? 1 }), { min: 0.001, max: 64, label: "音符の高さに対する倍率" }),
        ),
      );
    } else if ("noise" in l) {
      head.push(select(l.noise, NOISES as [typeof l.noise, string][], (v) => put({ ...(cur() as typeof l), noise: v }), "雑音の色"));
    } else {
      head.push(select(l.sample, samples.map((x) => [x, x] as [string, string]), (v) => put({ ...(cur() as typeof l), sample: v }), "録音"));
      src.push(field("速さ", numberInput(l.ratio ?? 1, (v) => put({ ...(cur() as typeof l), ratio: v ?? 1 }), { min: 0.01, max: 16, label: "再生の速さ" })));
    }

    const envDef = "sample" in l ? SAMPLE_ENV_DEFAULT : ENV_DEFAULT;
    const env: Required<Envelope> = { ...envDef, ...l.env } as Required<Envelope>;
    const setEnv = (patch: Partial<Envelope>, rerender = false) => put({ ...cur(), env: { ...env, ...cur().env, ...patch } }, undefined, rerender);

    const filter = l.filter;
    const pe = l.pitchEnv;
    const peMode = !pe ? "" : pe.toHz !== undefined ? "hz" : "cents";

    return h(
      "fieldset",
      { class: "layer" },
      h(
        "legend",
        {},
        h("span", { class: "num" }, String(i + 1)),
        ...head,
        iconButton(ICON.copy, "層を複製", () => this.set(duplicateLayer(app.score, name, i), undefined, true)),
        iconButton(ICON.trash, "層を削除", () => this.set(removeLayer(app.score, name, i), undefined, true), { disabled: app.score.instruments![name]!.layers.length <= 1 }),
      ),
      h(
        "div",
        { class: "grid" },
        ...src,
        field("音量", slider(l.gain ?? 1, (v) => put({ ...cur(), gain: v }, "gain"), { min: 0, max: 1.5, step: 0.01, label: "層の音量" })),
        field("左右", slider(l.pan ?? 0, (v) => put({ ...cur(), pan: v }, "pan"), { min: -1, max: 1, step: 0.01, label: "層の左右" })),
      ),
      envelopeView(env),
      h(
        "div",
        { class: "grid env" },
        field("立ち上がり", numberInput(env.a, (v) => setEnv({ a: v ?? 0 }), { min: 0, max: 10, step: 0.001, label: "立ち上がり（秒）" })),
        field("減衰", numberInput(env.d, (v) => setEnv({ d: v ?? 0 }), { min: 0, max: 20, step: 0.001, label: "減衰（秒）" })),
        field("持続", numberInput(env.s, (v) => setEnv({ s: v ?? 0 }, true), { min: 0, max: 1, step: 0.01, label: "持続の音量（0〜1）" })),
        field("余韻", numberInput(env.r, (v) => setEnv({ r: v ?? 0 }), { min: 0, max: 20, step: 0.001, label: "余韻（秒）" })),
        field("カーブ", select(env.curve, CURVES as [typeof env.curve, string][], (v) => setEnv({ curve: v }, true), "エンベロープのカーブ")),
      ),
      h(
        "div",
        { class: "grid" },
        field(
          "フィルタ",
          select(filter?.type ?? "", FILTERS, (t) => {
            const { filter: _f, ...rest } = cur();
            put(t === "" ? rest : { ...rest, filter: { ...FILTER_DEFAULT, freq: 1000, ...cur().filter, type: t } }, undefined, true);
          }, "フィルタの種類"),
        ),
        ...(filter
          ? [
              field("周波数", numberInput(filter.freq, (v) => put({ ...cur(), filter: { ...cur().filter!, freq: v ?? 1000 } }), { min: 10, max: 24000, label: "フィルタの周波数（Hz）" })),
              field("Q", numberInput(filter.q ?? 1, (v) => put({ ...cur(), filter: { ...cur().filter!, q: v ?? 1 } }), { min: 0.0001, max: 100, step: 0.1, label: "フィルタの Q" })),
              filter.type === "peaking" || filter.type.endsWith("shelf")
                ? field("増減（dB）", numberInput(filter.gain ?? 0, (v) => put({ ...cur(), filter: { ...cur().filter!, gain: v ?? 0 } }), { min: -40, max: 40, step: 0.5, label: "フィルタの増減（dB）" }))
                : null,
            ]
          : []),
      ),
      h(
        "div",
        { class: "grid" },
        field(
          "ピッチ変化",
          select(peMode, [["", "なし"], ["hz", "Hz へ"], ["cents", "セント"]], (m) => {
            const { pitchEnv: _p, ...rest } = cur();
            const time = cur().pitchEnv?.time ?? "decay";
            const curve = cur().pitchEnv?.curve ?? "exp";
            put(m === "" ? rest : m === "hz" ? { ...rest, pitchEnv: { toHz: 100, time, curve } } : { ...rest, pitchEnv: { cents: -1200, time, curve } }, undefined, true);
          }, "ピッチ変化"),
        ),
        ...(pe
          ? [
              pe.toHz !== undefined
                ? field("行き先（Hz）", numberInput(pe.toHz, (v) => put({ ...cur(), pitchEnv: { ...cur().pitchEnv!, toHz: v ?? 100 } }), { min: 1, max: 24000, label: "ピッチ変化の行き先（Hz）" }))
                : field("変化（セント）", numberInput(pe.cents ?? 0, (v) => put({ ...cur(), pitchEnv: { ...cur().pitchEnv!, cents: v ?? 0 } }), { min: -9600, max: 9600, step: 1, label: "ピッチ変化（セント）" })),
              field(
                "時間（秒）",
                numberInput(pe.time === "decay" ? undefined : pe.time, (v) => put({ ...cur(), pitchEnv: { ...cur().pitchEnv!, time: v ?? "decay" } }), {
                  min: 0.001,
                  max: 20,
                  optional: true,
                  placeholder: "減衰と同じ",
                  label: "ピッチ変化の時間（秒）。空欄で減衰と同じ",
                }),
              ),
              field("カーブ", select(pe.curve ?? "exp", CURVES as ["exp" | "lin", string][], (v) => put({ ...cur(), pitchEnv: { ...cur().pitchEnv!, curve: v } }), "ピッチ変化のカーブ")),
            ]
          : []),
      ),
      h("div", { class: "grid" }, ...this.jitterFields(l.jitter, (j) => put({ ...cur(), jitter: j }), "層の揺らぎ")),
    );
  }

  // ---- 音全体 ----

  private soundSection() {
    const app = this.app;
    const s = app.score;
    const v = s.variation ?? {};
    const reverbs = Object.entries(s.reverb ?? {});
    const comp = s.master?.compressor;
    return this.section(
      "sound",
      "音全体",
      [
        iconButton(ICON.plus, "残響を追加", () => {
          const name = freshName(Object.keys(s.reverb ?? {}), "room");
          this.set(setReverb(s, name, { seconds: 0.8, decay: 3, wet: 0.2 }), undefined, true);
        }),
      ],
      h(
        "div",
        { class: "grid" },
        field("音量", slider(s.gain ?? 1, (g) => this.set({ ...app.score, gain: g }, "sgain"), { min: 0, max: 2, step: 0.01, label: "音全体の音量" })),
        field("揺らぎ（セント）", numberInput(v.tune ?? 0, (x) => this.set({ ...app.score, variation: { ...app.score.variation, tune: x ?? 0 } }), { min: 0, max: 2400, step: 1, label: "鳴らすたびの揺らぎ：高さ" })),
        field("揺らぎ（音量）", numberInput(v.gain ?? 0, (x) => this.set({ ...app.score, variation: { ...app.score.variation, gain: x ?? 0 } }), { min: 0, max: 1, step: 0.01, label: "鳴らすたびの揺らぎ：音量" })),
        field("揺らぎ（秒）", numberInput(v.time ?? 0, (x) => this.set({ ...app.score, variation: { ...app.score.variation, time: x ?? 0 } }), { min: 0, max: 1, step: 0.001, label: "鳴らすたびの揺らぎ：遅れ" })),
      ),
      ...reverbs.map(([name, r]) =>
        h(
          "fieldset",
          { class: "layer" },
          h("legend", {}, h("span", { class: "title" }, `残響 ${name}`), iconButton(ICON.trash, `残響 ${name} を削除`, () => this.set(removeReverb(app.score, name), undefined, true))),
          h(
            "div",
            { class: "grid" },
            field("長さ（秒）", numberInput(r.seconds, (x) => this.set(setReverb(app.score, name, { ...app.score.reverb![name]!, seconds: x ?? 0.5 })), { min: 0.01, max: 10, step: 0.01, label: "残響の長さ（秒）" })),
            field("減衰", numberInput(r.decay, (x) => this.set(setReverb(app.score, name, { ...app.score.reverb![name]!, decay: x ?? 3 })), { min: 0.1, max: 20, step: 0.1, label: "残響の減衰の速さ" })),
            field("量", slider(r.wet ?? 1, (x) => this.set(setReverb(app.score, name, { ...app.score.reverb![name]!, wet: x }), `rw${name}`), { min: 0, max: 1, step: 0.01, label: "残響の量" })),
            r.early?.length ? field("早期反射", h("output", {}, String(r.early.length))) : null,
          ),
        ),
      ),
      h(
        "div",
        { class: "grid" },
        field("マスター", slider(s.master?.gain ?? 1, (g) => this.set({ ...app.score, master: { ...app.score.master, gain: g } }, "mgain"), { min: 0, max: 2, step: 0.01, label: "マスターの音量" })),
        field(
          "コンプレッサー",
          h("input", {
            type: "checkbox",
            checked: !!comp,
            "aria-label": "コンプレッサー",
            onchange: (e: Event) => {
              const on = (e.target as HTMLInputElement).checked;
              const { compressor: _c, ...rest } = app.score.master ?? {};
              this.set({ ...app.score, master: on ? { ...rest, compressor: { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 } } : rest }, undefined, true);
            },
          }),
        ),
        ...(comp
          ? (
              [
                ["threshold", "しきい値（dB）", -100, 0, 1],
                ["ratio", "比", 1, 20, 0.5],
                ["attack", "アタック（秒）", 0, 1, 0.001],
                ["release", "リリース（秒）", 0, 1, 0.01],
              ] as const
            ).map(([k, label, min, max, step]) =>
              field(label, numberInput(comp[k], (x) => this.set({ ...app.score, master: { ...app.score.master, compressor: { ...app.score.master!.compressor, [k]: x ?? 0 } } }), { min, max, step, label: `コンプレッサーの${label}` })),
            )
          : []),
      ),
    );
  }
}

/** エンベロープの形（1 秒を横幅いっぱい。長ければ縮める） */
function envelopeView(env: Required<Envelope>) {
  const W = 240;
  const H = 40;
  const hold = env.s > 0 ? Math.max(0.1, (env.a + env.d) * 0.5) : 0;
  const total = Math.max(0.05, env.a + env.d + hold + (env.s > 0 ? env.r : 0));
  const x = (t: number) => (t / total) * W;
  const y = (g: number) => H - 2 - g * (H - 4);
  const pts: [number, number][] = [[0, y(0)], [x(env.a), y(1)]];
  const exp = env.curve === "exp";
  const curve = (t0: number, t1: number, g0: number, g1: number) => {
    for (let k = 1; k <= 12; k++) {
      const f = k / 12;
      const g = exp && g0 > 0 ? g0 * Math.pow(Math.max(g1, 0.001) / g0, f) : g0 + (g1 - g0) * f;
      pts.push([x(t0 + (t1 - t0) * f), y(g)]);
    }
  };
  if (env.s > 0) {
    curve(env.a, env.a + env.d, 1, env.s);
    pts.push([x(env.a + env.d + hold), y(env.s)]);
    curve(env.a + env.d + hold, total, env.s, 0);
  } else curve(env.a, env.a + env.d, 1, 0);
  const d = pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
  const el = h("div", { class: "envview", "aria-hidden": "true" });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
  return el;
}
