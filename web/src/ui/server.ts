// 「作品」の欄（M7）：サーバの作品を開く・保存する。開いた版が前に見た版より新しければ、差分と A/B を出す。
// 前に見た版は作品ごとに localStorage に覚える（無い・使えないときは、変更案から作られた版なら 1 つ前と比べる）。
import type { Bank, Score } from "@sfx-atelier/format";
import type { App, Remote } from "../app";
import { changeText, diffDocs } from "../model/diff";
import { parseJson, scoreFromBank } from "../model/io";
import { Server, ServerError, type RemoteSummary, type RemoteVersion } from "../model/server";
import { field, h, iconButton } from "./dom";
import { ICON } from "./icons";

/** 差分は多くてもこの行数まで見せる */
const MAX_LINES = 30;
const SEEN = "sfx-atelier:seen:";

function seenOf(id: string): number | null {
  try {
    const v = Number(localStorage.getItem(SEEN + id));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function setSeen(id: string, version: number) {
  try {
    localStorage.setItem(SEEN + id, String(version));
  } catch {
    // 使えなくても困らない
  }
}

export class ServerPanel {
  readonly el: HTMLElement;
  private list = h("select", { "aria-label": "作品" });
  private name = h("input", { type: "text", "aria-label": "名前", maxlength: 80 });
  private info = h("output", { "data-k": "remote" });
  private diffOut = h("div", { class: "diff", hidden: true });
  private items: RemoteSummary[] = [];
  /** 差分の A（前に見た版の、いまの音） */
  private before: Score | null = null;
  pending: Promise<unknown> = Promise.resolve();

  constructor(
    private app: App,
    private say: (text: string, error?: boolean) => void,
    private summaryText: () => Promise<string>,
    readonly server = new Server(),
  ) {
    this.el = h(
      "details",
      { open: true, "data-k": "server" },
      h(
        "summary",
        {},
        h("span", { class: "title" }, "作品"),
        h(
          "span",
          { class: "actions" },
          iconButton(ICON.refresh, "一覧を読み直す", () => (this.pending = this.refresh())),
          iconButton(ICON.upload, "サーバに保存", () => (this.pending = this.save())),
        ),
      ),
      h(
        "div",
        { class: "body" },
        h("div", { class: "row" }, this.list, iconButton(ICON.open, "作品を開く", () => (this.pending = this.open(this.list.value)))),
        h("div", { class: "grid" }, field("名前", this.name), field("版", this.info)),
        this.diffOut,
      ),
    );
    app.on((c) => {
      if (c === "source") this.sync();
    });
    this.sync();
    this.pending = this.refresh();
  }

  private sync() {
    const r = this.app.remote;
    this.info.textContent = r ? String(r.version) : "—";
    this.name.value = r?.name ?? this.app.source?.label.replace(/^preset:/, "").replace(/\.(sfx(bank|score)\.)?json$/i, "") ?? this.app.baseName;
    this.name.disabled = !!r;
    if (!r) {
      this.diffOut.hidden = true;
      this.before = null;
    }
  }

  private fail(e: unknown) {
    if (e instanceof ServerError) this.say(e.message, true);
    else throw e;
  }

  async refresh() {
    try {
      this.items = await this.server.list();
      this.list.replaceChildren(...this.items.map((s) => h("option", { value: s.id }, `${s.name}（${s.version}）`)));
    } catch (e) {
      this.items = [];
      this.list.replaceChildren();
      // 開いた直後に届かないのはよくある（ローカル・Access の外）。知らせない
      if (!(e instanceof ServerError)) throw e;
    }
  }

  /** いま保存する中身（バンクから開いていればバンク全体） */
  private body(): { kind: "score" | "bank"; body: Score | Bank } {
    const bank = this.app.currentBank();
    return bank ? { kind: "bank", body: bank } : { kind: "score", body: this.app.score };
  }

  async open(id: string) {
    if (!id) return;
    try {
      const v = await this.server.get(id);
      const seen = seenOf(v.id) ?? (v.patch && v.version > 1 ? v.version - 1 : v.version);
      const old = seen < v.version ? await this.server.get(v.id, seen) : null;
      this.load(v);
      this.showDiff(old, v);
      setSeen(v.id, v.version);
    } catch (e) {
      this.fail(e);
    }
  }

  private load(v: RemoteVersion) {
    const r = parseJson(JSON.stringify(v.body));
    if (r.kind === "error") throw new ServerError(400, r.errors.join("\n"));
    const remote: Remote = { id: v.id, name: v.name, kind: v.kind, version: v.version };
    if (r.kind === "bank") this.app.openBank(r.bank, v.name, undefined, remote);
    else this.app.openScore(r.score, v.name, remote);
  }

  private showDiff(old: RemoteVersion | null, v: RemoteVersion) {
    if (!old) {
      this.diffOut.hidden = true;
      this.before = null;
      return;
    }
    const changes = diffDocs(old.body, v.body);
    const lines = changes.slice(0, MAX_LINES).map((c) => h("li", {}, changeText(c)));
    if (changes.length > MAX_LINES) lines.push(h("li", {}, `ほか ${changes.length - MAX_LINES} 件`));
    // A：前に見た版の、いま開いている音
    const r = parseJson(JSON.stringify(old.body));
    const name = this.app.source?.name;
    this.before = r.kind === "score" ? r.score : r.kind === "bank" && name && r.bank.sounds[name] ? scoreFromBank(r.bank, name) : null;
    this.diffOut.replaceChildren(
      h("div", { class: "row" }, h("span", {}, `${old.version} → ${v.version}`), v.author !== "editor" ? h("span", {}, v.author) : null, v.note ? h("span", {}, v.note) : null),
      h("ul", { "data-k": "changes" }, ...lines),
      h(
        "div",
        { class: "row" },
        h("button", { type: "button", class: "ab", "aria-label": "前の版を鳴らす", disabled: !this.before, onclick: () => this.before && this.app.player.preview(this.before) }, "A"),
        h("button", { type: "button", class: "ab", "aria-label": "いまの版を鳴らす", onclick: () => this.app.player.preview(this.app.score) }, "B"),
      ),
    );
    this.diffOut.hidden = false;
  }

  async save() {
    const { kind, body } = this.body();
    const r = this.app.remote;
    try {
      const analysis = await this.summaryText().catch(() => undefined);
      if (r && r.kind === kind) {
        const res = await this.server.save(r.id, body, r.version, analysis);
        this.app.remote = { ...r, version: res.version };
        setSeen(r.id, res.version);
      } else {
        const name = this.name.value.trim();
        if (!name) return this.say("名前を入れてください", true);
        const res = await this.server.create(name, body, analysis);
        this.app.remote = { id: res.id, name, kind, version: res.version };
        setSeen(res.id, res.version);
      }
      this.sync();
      this.say("保存しました");
      await this.refresh();
    } catch (e) {
      this.fail(e);
    }
  }
}
