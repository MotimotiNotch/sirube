// リポジトリの `AGENTS.md` を TS の定数に焼き込む生成スクリプト。
// `AGENTS.md` を直したら `bun run agents-doc` を実行する（`bun test` が
// ずれを検出して落ちるので、忘れたままにはならない）。
//
// なぜ焼き込むか: この本文を **vault にも書き出す**ため（`moc.ts`）。
// インストーラで入れた人の手元にはリポジトリが無く、`AGENTS.md` がどこにも
// 存在しない——「AI と同じ場で進める」を売りにしておきながら、開発者以外は
// 仕様書を受け取れない状態だった（2026-09-02 に他人の環境を洗って発覚）。
//
// 実行時にファイルを読む形にしないのは、dev / Tauri / テストで読み方が
// 変わってしまうから。ビルド時に1つの文字列に潰しておけば、どこでも同じ。

// 改行は LF に揃える。vault へ書き出す他の生成物（MOC）が LF なので、
// ここだけ CRLF だと差分がファイルごとにばらつく。
const source = (await Bun.file("AGENTS.md").text()).replace(/\r\n/g, "\n");

const out = [
  "// 生成物。直接編集しない——`AGENTS.md` を直して `bun run agents-doc` を実行する。",
  "// 生成は scripts/gen-agents-doc.ts。ずれは `bun test` が検出する。",
  "",
  "/** リポジトリの `AGENTS.md` の全文。vault へ書き出すために焼き込んである。 */",
  `export const AGENTS_DOC = ${JSON.stringify(source)};`,
  "",
].join("\n");

await Bun.write("src/core/agents-doc.ts", out);
console.log(`agents-doc.ts を書き出し: ${source.length} 文字`);
