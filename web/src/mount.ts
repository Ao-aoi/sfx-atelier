// 画面を組み立てる。最初はプリセットの最初の音を開く
import { App } from "./app";
import { parseJson } from "./model/io";
import { PRESETS } from "./model/presets";
import { Panels } from "./ui/panels";
import { Roll } from "./ui/roll";
import { Toolbar } from "./ui/toolbar";
import { h } from "./ui/dom";

export interface Mounted {
  app: App;
  roll: Roll;
  toolbar: Toolbar;
  panels: Panels;
}

export function mount(root: HTMLElement): Mounted {
  const app = new App();
  const first = PRESETS[0];
  const r = first && parseJson(JSON.stringify(first.bank));
  if (r?.kind === "bank") app.openBank(r.bank, `preset:${first!.name}`);

  const rollHost = h("div", { class: "roll-host" });
  let roll!: Roll;
  const toolbar = new Toolbar(app, () => roll);
  const panels = new Panels(app);
  root.replaceChildren(h("div", { class: "editor" }, toolbar.el, h("main", { class: "work" }, rollHost, panels.el), toolbar.status));
  roll = new Roll(app, rollHost);
  return { app, roll, toolbar, panels };
}
