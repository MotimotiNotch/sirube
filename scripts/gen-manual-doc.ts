// `docs/manual.md` を TS の定数に焼き込む生成スクリプト（2026-09-28）。
// マニュアルを直したら `bun run manual-doc` を実行する（`bun test` がずれを
// 検出して落ちるので、忘れたままにはならない）。
//
// なぜ焼き込むか: アプリの中で読ませるため（ヘッダーの「使い方」）。インストーラ
// で入れた人の手元にはリポジトリが無い。実行時にファイルを読む形にしないのは
// `AGENTS.md`（`gen-agents-doc.ts`）と同じ理由——dev / Tauri / テストで読み方が変わる。
//
// 本文の正は `docs/manual.md` 1本。GitHub でもそのまま読める。

const source = (await Bun.file("docs/manual.md").text()).replace(/\r\n/g, "\n");

const out = [
  "// 生成物。直接編集しない——`docs/manual.md` を直して `bun run manual-doc` を実行する。",
  "// 生成は scripts/gen-manual-doc.ts。ずれは `bun test` が検出する。",
  "",
  "/** `docs/manual.md` の全文。アプリの「使い方」で出すために焼き込んである。 */",
  `export const MANUAL_DOC = ${JSON.stringify(source)};`,
  "",
].join("\n");

await Bun.write("src/ui/manual-doc.ts", out);
console.log(`manual-doc.ts を書き出し: ${source.length} 文字`);
