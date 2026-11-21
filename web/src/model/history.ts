// 元に戻す・やり直し。値は書き換えずに作り直す前提（同じ参照なら変更なし）。
// ドラッグの途中は preview で今の値だけ差し替え、指を離したら commit で 1 手として積む。
// 数値の入力のように細かく続く変更は、同じ key なら 1 手にまとめる。

export class History<T> {
  past: T[] = [];
  future: T[] = [];
  present: T;
  private anchor: T | null = null;
  private lastKey: string | null = null;

  constructor(
    initial: T,
    readonly limit = 200,
  ) {
    this.present = initial;
  }

  get canUndo() {
    return this.past.length > 0 || (this.anchor !== null && this.anchor !== this.present);
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** 1 手として積む。key が直前と同じなら直前の手にまとめる */
  push(next: T, key?: string) {
    this.commit();
    if (next === this.present) return;
    if (key === undefined || key !== this.lastKey) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.present = next;
    this.lastKey = key ?? null;
  }

  /** 積まずに今の値を差し替える（ドラッグの途中） */
  preview(next: T) {
    if (this.anchor === null) this.anchor = this.present;
    this.present = next;
  }

  /** preview を 1 手として確定する */
  commit() {
    if (this.anchor === null) return;
    const a = this.anchor;
    this.anchor = null;
    this.lastKey = null;
    if (a === this.present) return;
    this.past.push(a);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** preview を取り消す */
  cancel() {
    if (this.anchor === null) return;
    this.present = this.anchor;
    this.anchor = null;
  }

  undo(): boolean {
    this.commit();
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.present);
    this.present = prev;
    this.lastKey = null;
    return true;
  }

  redo(): boolean {
    this.commit();
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.present);
    this.present = next;
    this.lastKey = null;
    return true;
  }

  /** 履歴を消して値を置く（別のファイルを開いたとき） */
  reset(value: T) {
    this.past = [];
    this.future = [];
    this.anchor = null;
    this.lastKey = null;
    this.present = value;
  }
}
