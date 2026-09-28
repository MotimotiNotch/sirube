// 焼き込んだマニュアルが古くなっていないかの見張り（`agents-doc.test.ts` と同じ形）と、
// 本文がアプリの中で崩れずに描けるかの見張り。

import { expect, test } from "bun:test";
import { ensureDom } from "./test-dom.ts";
import { MANUAL_DOC } from "./manual-doc.ts";

ensureDom();
const { renderNote } = await import("./note-view.ts");

test("焼き込んだマニュアルが docs/manual.md と一致する", async () => {
  // ずれていたら `bun run manual-doc` を実行する。
  const source = (await Bun.file("docs/manual.md").text()).replace(/\r\n/g, "\n");
  expect(MANUAL_DOC).toBe(source);
});

// マニュアルはメモと同じ `renderNote` で描く。GitHub では描ける書き方でも、こちらでは
// 崩れるものがある——表のセルに縦棒やバッククォートの入れ子を書くと列がずれた
// （2026-09-28、4章を書いたときに踏んだ）。
test("マニュアルの表はどれも列の数が揃っている", () => {
  const c = document.createElement("div");
  renderNote(c, MANUAL_DOC);
  const tables = Array.from(c.querySelectorAll("table"));
  expect(tables.length).toBeGreaterThan(0); // 陽性対照: 表が描けている
  for (const tb of tables) {
    const rows = Array.from(tb.querySelectorAll("tr"));
    const n = rows[0]!.children.length;
    for (const r of rows) expect(r.children.length).toBe(n);
  }
});

test("描いたあとに生の強調・コード記法が残らない", () => {
  const c = document.createElement("div");
  renderNote(c, MANUAL_DOC);
  expect(c.querySelectorAll("code").length).toBeGreaterThan(0); // 陽性対照: コードは描けている
  const leftovers = Array.from(c.querySelectorAll(".note-p, li, td, th"))
    .map((e) => e.textContent ?? "")
    .filter((s) => s.includes("**") || s.includes("`"));
  expect(leftovers).toEqual([]);
});
