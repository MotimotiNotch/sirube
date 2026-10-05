// 異常終了の記録（フロント側）。
//
// 守りたいのは2つ。**落ちた瞬間の手がかり（直前の操作）が古い順で残ること**と、
// **記録する処理そのものが投げないこと**——落ちた後の処理で落ちると、元の例外が
// 見えなくなる。

import { describe, expect, test } from "bun:test";

import { ensureDom } from "./test-dom.ts";

ensureDom();

const { Breadcrumbs, describeThrown, formatReport, installCrashCapture } = await import("./crash.ts");

describe("直前の操作", () => {
  test("上限を超えたら古いものから捨てる。並びは古い順のまま", () => {
    const c = new Breadcrumbs();
    for (let i = 0; i < 25; i++) c.add(`操作${i}`, i);
    const list = c.list();
    expect(list).toHaveLength(20);
    expect(list[0]!.what).toBe("操作5");
    expect(list.at(-1)!.what).toBe("操作24");
  });

  test("空白は1つに畳み、長いものは切る。空は数えない", () => {
    const c = new Breadcrumbs();
    c.add("   ");
    expect(c.revision).toBe(0);
    c.add(`click 「${"あ".repeat(100)}」`);
    expect(c.list()[0]!.what.length).toBeLessThanOrEqual(61);
    expect(c.list()[0]!.what.endsWith("…")).toBe(true);
    c.add("click\n\n  button");
    expect(c.list()[1]!.what).toBe("click button");
    expect(c.revision).toBe(2);
  });
});

describe("例外の取り出し", () => {
  test("Error 以外が投げられても文字にする", () => {
    expect(describeThrown(new TypeError("x is undefined")).message).toBe("TypeError: x is undefined");
    expect(describeThrown("文字列").message).toBe("文字列");
    expect(describeThrown(undefined).message).toBe("undefined");
    expect(describeThrown({ code: 1 }).message).toBe('{"code":1}');
    // 循環参照は JSON にできない。ここで投げないこと（陽性対照）。
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    expect(() => describeThrown(loop)).not.toThrow();
  });
});

describe("レポートの形", () => {
  test("見出し・メッセージ・スタック・直前の操作がそろう", () => {
    const text = formatReport({
      kind: "error",
      message: "TypeError: boom",
      stack: "at render (app.ts:1)",
      at: 0,
      window: "本窓",
      version: "0.3.4",
      crumbs: [{ at: 0, what: "click button 「追加」" }],
    });
    expect(text).toContain("種類: 画面側の例外");
    expect(text).toContain("版: 0.3.4");
    expect(text).toContain("TypeError: boom");
    expect(text).toContain("at render (app.ts:1)");
    expect(text).toContain("click button 「追加」");
  });
});

describe("拾う", () => {
  test("クリックしたボタンと未捕捉の例外が sink に届く", () => {
    const got: string[] = [];
    installCrashCapture({ window: "本窓", sink: (_r, text) => got.push(text) });

    const btn = document.createElement("button");
    btn.textContent = "追加";
    document.body.append(btn);
    btn.click();

    window.dispatchEvent(new ErrorEvent("error", { error: new Error("描画で落ちた"), message: "描画で落ちた" }));
    expect(got).toHaveLength(1);
    expect(got[0]).toContain("Error: 描画で落ちた");
    expect(got[0]).toContain("click button 「追加」");
    btn.remove();
  });

  test("sink が投げても外へ漏らさない", () => {
    installCrashCapture({
      window: "本窓",
      sink: () => {
        throw new Error("書けない");
      },
    });
    expect(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("x") }))).not.toThrow();
  });
});
