// 焼き込んだマニュアルが古くなっていないかの見張り（`agents-doc.test.ts` と同じ形）と、
// 本文がアプリの中で崩れずに描けるかの見張り。日本語版と英語版（2026-10-06）の両方を見る。

import { describe, expect, test } from "bun:test";
import { ensureDom } from "./test-dom.ts";
import { MANUAL_DOC, MANUAL_DOC_EN } from "./manual-doc.ts";

ensureDom();
const { renderNote } = await import("./note-view.ts");

const DOCS = [
  { lang: "日本語", path: "docs/manual.md", doc: MANUAL_DOC },
  { lang: "英語", path: "docs/manual.en.md", doc: MANUAL_DOC_EN },
];

for (const { lang, path, doc } of DOCS) {
  describe(`マニュアル（${lang}）`, () => {
    test(`焼き込んだマニュアルが ${path} と一致する`, async () => {
      // ずれていたら `bun run manual-doc` を実行する。
      const source = (await Bun.file(path).text()).replace(/\r\n/g, "\n");
      expect(doc).toBe(source);
    });

    // マニュアルはメモと同じ `renderNote` で描く。GitHub では描ける書き方でも、こちらでは
    // 崩れるものがある——表のセルに縦棒やバッククォートの入れ子を書くと列がずれた
    // （2026-09-28、4章を書いたときに踏んだ）。
    test("マニュアルの表はどれも列の数が揃っている", () => {
      const c = document.createElement("div");
      renderNote(c, doc);
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
      renderNote(c, doc);
      expect(c.querySelectorAll("code").length).toBeGreaterThan(0); // 陽性対照: コードは描けている
      const leftovers = Array.from(c.querySelectorAll(".note-p, li, td, th"))
        .map((e) => e.textContent ?? "")
        .filter((s) => s.includes("**") || s.includes("`"));
      expect(leftovers).toEqual([]);
    });
  });
}

// 英語版は日本語版の訳。章（`##`）と節（`###`）の数、表の数が揃っていれば、片方だけ
// 直して置いていかれた章があると気づける（中身の一致までは見られない）。
describe("英語版が日本語版と同じ形をしている", () => {
  const shape = (doc: string) => {
    const c = document.createElement("div");
    renderNote(c, doc);
    return {
      h2: c.querySelectorAll(".note-h2").length,
      h3: c.querySelectorAll(".note-h3").length,
      tables: c.querySelectorAll("table").length,
    };
  };

  test("章・節・表の数が同じ", () => {
    const ja = shape(MANUAL_DOC);
    expect(ja.h2).toBeGreaterThan(5); // 陽性対照: 見出しを数えられている
    expect(shape(MANUAL_DOC_EN)).toEqual(ja);
  });

  test("章の番号が同じ順に並ぶ", () => {
    const nums = (doc: string) => Array.from(doc.matchAll(/^## (\d+)\./gm), (x) => x[1]);
    expect(nums(MANUAL_DOC_EN)).toEqual(nums(MANUAL_DOC));
  });

  // かな・漢字の範囲。エディタやツールが \u エスケープを実際の文字に変えてしまうので、
  // 文字コードから組み立てる。
  const range = (a: number, b: number) => `${String.fromCharCode(a)}-${String.fromCharCode(b)}`;
  const JAPANESE = new RegExp(`[${range(0x3040, 0x30ff)}${range(0x4e00, 0x9fff)}]`);

  test("英語版の本文に日本語が残っていない（意図して残したものは除く）", () => {
    // 許すのは3つ: 日本語のまま書き出される生成物の名前、言語メニューの「日本語」
    // （言語名はその言語で書く）、用語集で英語の後ろに括弧で添えた日本語の見出し語
    // （英語の読者も生成物や AGENTS.md で日本語の語に出会うため）。
    const glossaryNote = new RegExp(`^\\| [A-Za-z][A-Za-z -]* \\([^)]*\\) \\|`);
    const strip = (l: string): string =>
      l.replace(/00_Sirube_MOC|90_達成済み|“日本語”/g, "").replace(glossaryNote, "| term |");
    const lines = MANUAL_DOC_EN.split("\n")
      .map((l, i) => ({ i: i + 1, l: strip(l) }))
      .filter(({ l }) => JAPANESE.test(l));
    expect(lines.map(({ i, l }) => `${i}: ${l}`)).toEqual([]);
  });

  test("陽性対照: 日本語版は上の検出に掛かる", () => {
    expect(JAPANESE.test(MANUAL_DOC)).toBe(true);
  });
});
