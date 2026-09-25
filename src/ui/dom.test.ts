// 画面の小さな部品。

import { beforeEach, describe, expect, test } from "bun:test";

// 登録はプロセスに1回だけ（`test-dom.ts` のコメント参照）。
import { ensureDom } from "./test-dom.ts";

ensureDom();

const { toast } = await import("./dom.ts");

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const shown = (): string[] =>
  Array.from(document.querySelectorAll("#toast-stack .toast")).map((t) => t.textContent ?? "");

beforeEach(() => {
  document.body.innerHTML = '<div class="toast-stack" id="toast-stack"></div>';
});

describe("お知らせ（トースト）", () => {
  test("出して、時間が来たら消える", async () => {
    toast("消しました", 20);
    expect(shown()).toEqual(["消しました"]);
    await wait(50);
    expect(shown()).toEqual([]);
  });

  test("続けて出しても、前のものも残らずに消える（2026-09-25 の不具合）", async () => {
    toast("1件目を消しました", 30);
    await wait(10);
    toast("2件目を消しました", 30);
    expect(shown()).toEqual(["1件目を消しました", "2件目を消しました"]);
    await wait(25);
    // 1件目は自分の時間で先に消え、2件目はまだ出ている
    expect(shown()).toEqual(["2件目を消しました"]);
    await wait(30);
    expect(shown()).toEqual([]);
  });
});
