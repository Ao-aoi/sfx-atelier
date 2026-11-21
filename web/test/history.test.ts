import { describe, expect, it } from "vitest";
import { History } from "../src/model/history";

describe("元に戻す・やり直し", () => {
  it("積んだ順に戻り、戻した分だけやり直せる", () => {
    const h = new History("a");
    h.push("b");
    h.push("c");
    expect(h.undo()).toBe(true);
    expect(h.present).toBe("b");
    expect(h.undo()).toBe(true);
    expect(h.present).toBe("a");
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(true);
    expect(h.present).toBe("b");
  });
  it("戻した後に積むと、やり直しは消える", () => {
    const h = new History(1);
    h.push(2);
    h.undo();
    h.push(3);
    expect(h.canRedo).toBe(false);
    expect(h.past).toEqual([1]);
  });
  it("同じ値は積まない", () => {
    const h = new History("a");
    h.push("a");
    expect(h.canUndo).toBe(false);
  });
  it("ドラッグ：preview を何回しても commit で 1 手", () => {
    const h = new History(0);
    h.preview(1);
    h.preview(2);
    h.preview(3);
    expect(h.present).toBe(3);
    h.commit();
    expect(h.past).toEqual([0]);
    h.undo();
    expect(h.present).toBe(0);
  });
  it("ドラッグの取り消し：preview の前に戻り、履歴は増えない", () => {
    const h = new History("x");
    h.preview("y");
    h.cancel();
    expect(h.present).toBe("x");
    expect(h.canUndo).toBe(false);
  });
  it("同じ key の変更は 1 手にまとめる。違う key や key なしは別の手", () => {
    const h = new History(0);
    h.push(1, "gain");
    h.push(2, "gain");
    h.push(3, "gain");
    h.push(4, "pan");
    h.push(5);
    expect(h.past).toEqual([0, 3, 4]);
    h.undo();
    h.undo();
    expect(h.present).toBe(3);
  });
  it("上限を超えたら古い手から捨てる", () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 5; i++) h.push(i);
    expect(h.past).toEqual([2, 3, 4]);
  });
});
