// テストの一覧を Markdown に起こす生成スクリプト。
//
//   bun run test-doc                    → リポジトリの TESTS.md
//   bun run test-doc <出力先のパス>     → 任意の場所（Vault へ吐くときに使う）
//
// なぜ生成するか: テスト名は日本語で「何を守っているか」を書いてあるので、
// 並べればそのまま仕様の一覧になる。ただし**手で書くと必ず古くなる**——
// テストは足すたびに増え、消すたびに減るのに、一覧の方は誰も直さない。
// 一次情報はテストコードのままにして、読む形だけをここで作る。
//
// 抽出は正規表現で行う。テストランナーから拾う方が正確に見えるが、
// (1) 実行に依存すると落ちているときに一覧が作れない
// (2) `describe` の入れ子はソースの見た目そのものが正
// の2点で、ソースを読む方がこの用途には合っている。

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** `describe("...", ` / `test("...", ` の第1引数を拾う。
 *
 * 名前の中の `"` は `\"` で書かれる（テンプレートリテラルのテスト名は使って
 * いない）。閉じ引用符を探すときにエスケープを飛ばす必要があるので、
 * `[^"\\]*(?:\\.[^"\\]*)*` の形にしてある。 */
const ENTRY = /^(\s*)(describe|test)\(\s*"((?:[^"\\]|\\.)*)"/gm;

interface Entry {
  kind: "describe" | "test";
  name: string;
}

function parse(source: string): Entry[] {
  const entries: Entry[] = [];
  for (const m of source.matchAll(ENTRY)) {
    entries.push({
      kind: m[2] as Entry["kind"],
      // ソース上のエスケープを表示用に戻す。
      name: m[3]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    });
  }
  return entries;
}

/** ファイル先頭の連続するコメント行。**そのファイルが何を担保しているか**は
 *  たいていここに書いてあるので、見出しの下に添える。 */
function leadingComment(source: string): string[] {
  const lines: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line === "") {
      if (lines.length > 0) break; // 冒頭の空行は読み飛ばし、途切れたら終わり
      continue;
    }
    if (!line.startsWith("//")) break;
    lines.push(line.replace(/^\/\/ ?/, ""));
  }
  return lines;
}

async function testFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name).replace(/\\/g, "/");
    if (e.isDirectory()) found.push(...(await testFiles(p)));
    else if (e.name.endsWith(".test.ts")) found.push(p);
  }
  return found.sort();
}

const files = await testFiles("src");
const out: string[] = [
  "<!-- 生成物。直接編集しない——テストを直して `bun run test-doc` を実行する。 -->",
  "<!-- 生成は scripts/gen-test-doc.ts。一次情報は src/**/*.test.ts の側。 -->",
  "",
  "# Sirube のテスト一覧",
  "",
  "テスト名がそのまま「何を守っているか」の一覧になっている。**実装を変えて",
  "ここに書いてあることが崩れたら、それは仕様が変わったということ**なので、",
  "テストを直す前にそれでいいのかを見る。",
  "",
];

let total = 0;
const counts: string[] = [];

for (const file of files) {
  const source = await Bun.file(file).text();
  const entries = parse(source);
  const count = entries.filter((e) => e.kind === "test").length;
  total += count;
  counts.push(`| \`${file}\` | ${count} |`);
}

out.push("| ファイル | 件数 |", "| --- | --- |", ...counts, `| **合計** | **${total}** |`, "");

for (const file of files) {
  const source = await Bun.file(file).text();
  out.push("---", "", `## \`${file}\``, "");

  const comment = leadingComment(source);
  if (comment.length > 0) out.push(...comment.map((l) => (l === "" ? ">" : `> ${l}`)), "");

  // `describe` は見出し、`test` は箇条書き。**入れ子の深さは見ていない**——
  // 今あるテストは describe 1段までで、それ以上を扱う分岐を先に書くと、
  // 使われないまま実装とコメントがずれていく。深くしたくなったときに足す。
  for (const e of parse(source)) {
    if (e.kind === "describe") {
      // 見出しの前は必ず空ける。箇条書きの直後に `###` が来ると、
      // レンダラによっては見出しとして読まれない。
      if (out[out.length - 1] !== "") out.push("");
      out.push(`### ${e.name}`, "");
      continue;
    }
    out.push(`- ${e.name}`);
  }
  out.push("");
}

const dest = process.argv[2] ?? "TESTS.md";
await Bun.write(dest, out.join("\n"));
console.log(`${dest} を書き出し: ${total} 件 / ${files.length} ファイル`);
