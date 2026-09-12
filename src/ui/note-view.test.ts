// メモの閲覧モードの描画。
//
// 守りたいのは2つ。**書いたものが消えないこと**（解釈しなかった記法は素の
// 文字として残る）と、**文字列から HTML を起こさないこと**（本文は人が書いた
// ものがそのまま来る）。

import { describe, expect, test } from "bun:test";

// 登録はプロセスに1回だけ（`test-dom.ts` のコメント参照）。ここで直接
// `register()` を呼ぶと、app.test.ts と2つになった瞬間に読み込み順で落ちる。
import { ensureDom } from "./test-dom.ts";

ensureDom();

const { renderNote } = await import("./note-view.ts");

const draw = (text: string): HTMLElement => {
  const box = document.createElement("div");
  renderNote(box, text);
  return box;
};

describe("メモの閲覧モード", () => {
  test("見出しと段落を分ける", () => {
    const box = draw("## 買うもの\n\n本文です。");
    expect(box.querySelector(".note-h2")?.textContent).toBe("買うもの");
    expect(box.querySelector(".note-p")?.textContent).toBe("本文です。");
  });

  test("段落の中の改行は残す（空行だけが段落を割る）", () => {
    // メモは思いつきを並べる場所なので、1行ずつ書いたものが1行で出ないと困る。
    const box = draw("1行目\n2行目\n\n次の段落");
    expect(box.querySelectorAll(".note-p").length).toBe(2);
    expect(box.querySelectorAll(".note-p")[0]!.querySelectorAll("br").length).toBe(1);
  });

  test("箇条書きとチェックボックス。**印だけで、押せない**", () => {
    // 押せると、メモの中に「達成」がもう1つあることになる（状態は satisfied だけが持つ）。
    const box = draw("- [ ] まだ\n- [x] 済んだ\n- ただの行");
    expect(box.querySelectorAll("li").length).toBe(3);
    expect(box.querySelectorAll(".note-box").length).toBe(2);
    expect(box.querySelectorAll(".note-box.on").length).toBe(1);
    expect(box.querySelectorAll("li button").length).toBe(0);
    expect(box.textContent).toContain("ただの行");
  });

  test("表は見出し行を区切りで見分ける", () => {
    const box = draw("| 品目 | 目安 |\n| --- | --- |\n| ドライボックス | 3000円 |");
    expect(box.querySelectorAll("th").length).toBe(2);
    expect(box.querySelectorAll("td").length).toBe(2);
    expect(box.querySelector("th")?.textContent).toBe("品目");
  });

  test("区切りの無い表は全部が中身になる", () => {
    const box = draw("| a | b |\n| c | d |");
    expect(box.querySelectorAll("th").length).toBe(0);
    expect(box.querySelectorAll("td").length).toBe(4);
  });

  test("コードブロックの中は解釈しない", () => {
    const box = draw("```\n# これは見出しではない\n**強調でもない**\n```");
    expect(box.querySelector(".note-code")?.textContent).toBe("# これは見出しではない\n**強調でもない**");
    expect(box.querySelector(".note-h")).toBeNull();
    expect(box.querySelector("strong")).toBeNull();
  });

  test("閉じられていないコードブロックも、そこまでを出す", () => {
    const box = draw("```\nつづき");
    expect(box.querySelector(".note-code")?.textContent).toBe("つづき");
  });

  test("`code` の中の ** は強調にしない", () => {
    // 陽性対照つき。コードは「そのまま出す」ためのものなので、ここが崩れると意味が無い。
    const box = draw("`a ** b` と **強調**");
    expect(box.querySelector("code")?.textContent).toBe("a ** b");
    expect(box.querySelectorAll("strong").length).toBe(1);
    expect(box.querySelector("strong")?.textContent).toBe("強調");
  });

  test("裸の URL はリンクにする", () => {
    const box = draw("詳細は https://example.com/x を見る");
    const a = box.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com/x");
    expect(a?.getAttribute("rel")).toContain("noopener");
  });

  test("解釈しない記法は素の文字として残る（消さない）", () => {
    const box = draw("![[画像.png]] と ==ハイライト==");
    expect(box.textContent).toContain("![[画像.png]]");
    expect(box.textContent).toContain("==ハイライト==");
  });

  test("本文の HTML は文字として出す（組み立てで作るので、そもそも起きない）", () => {
    const box = draw("<b>太字</b><script>alert(1)</script>");
    expect(box.querySelector("b")).toBeNull();
    expect(box.querySelector("script")).toBeNull();
    expect(box.textContent).toContain("<script>alert(1)</script>");
  });

  test("描き直すと前の中身は残らない", () => {
    const box = draw("最初");
    renderNote(box, "次");
    expect(box.textContent).toBe("次");
  });
});
