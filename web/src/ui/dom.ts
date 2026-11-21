// 小さな DOM の組み立て。on〜 はイベント、class・style・その他は属性、value・checked などは property。
type Child = Node | string | null | undefined | false;
type Attrs = Record<string, unknown>;

const PROPS = new Set(["value", "checked", "disabled", "selected", "indeterminate"]);

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (PROPS.has(k)) (el as unknown as Record<string, unknown>)[k] = v;
    else if (k === "html") el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** アイコンだけのボタン（aria-label と title に同じ名前） */
export function iconButton(icon: string, label: string, onclick: (e: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  return h("button", { type: "button", class: "icon", "aria-label": label, title: label, html: icon, onclick, ...attrs });
}

/** 数値の入力。確定（change）で onChange。空欄は optional のときだけ undefined として渡す */
export function numberInput(
  value: number | undefined,
  onChange: (v: number | undefined) => void,
  opts: { min?: number; max?: number; step?: number | "any"; optional?: boolean; placeholder?: string; label: string },
): HTMLInputElement {
  const el = h("input", {
    type: "number",
    inputmode: "decimal",
    step: opts.step ?? "any",
    min: opts.min,
    max: opts.max,
    placeholder: opts.placeholder,
    "aria-label": opts.label,
    value: value === undefined ? "" : String(round(value)),
  });
  el.addEventListener("change", () => {
    if (el.value.trim() === "") {
      if (opts.optional) onChange(undefined);
      else el.value = value === undefined ? "" : String(round(value));
      return;
    }
    let v = Number(el.value);
    if (!Number.isFinite(v)) return;
    if (opts.min !== undefined) v = Math.max(opts.min, v);
    if (opts.max !== undefined) v = Math.min(opts.max, v);
    onChange(v);
  });
  return el;
}

/** スライダー。動かしている間ずっと onInput（履歴は key でまとめる） */
export function slider(value: number, onInput: (v: number) => void, opts: { min: number; max: number; step: number; label: string }) {
  const el = h("input", { type: "range", min: opts.min, max: opts.max, step: opts.step, value: String(value), "aria-label": opts.label });
  el.addEventListener("input", () => onInput(Number(el.value)));
  return el;
}

export function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void, label: string) {
  const el = h("select", { "aria-label": label }, ...options.map(([v, text]) => h("option", { value: v, selected: v === value }, text)));
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

/** ラベル付きの欄 */
export const field = (label: string, ...inputs: Child[]) => h("label", { class: "field" }, h("span", {}, label), ...inputs);

const round = (v: number) => Math.round(v * 1e6) / 1e6;
