// ファイル名＝ノード名 の vault を、ファイル名＝ULID + `name` frontmatter へ移す。
//
//   bun run scripts/migrate-ids.ts <vaultのパス>            # 下見だけ（既定）
//   bun run scripts/migrate-ids.ts <vaultのパス> --apply     # 実行
//
// 移す理由は改名のしやすさではなく、ファイル名を id にしていると**静かに
// データが壊れる**こと（Windows 実機で確認済み）:
//   - `リリース: v1.0` は保存すると `リリース v1.0.md` になり `:` が消える。
//     id が書いたとおりに往復しないので他ファイルからの参照が全部切れる
//   - `Ruv` と `ruv` は同じファイルに潰れ、片方が黙って消える
//
// 手順は「新しいファイルを全部作りきってから、古いファイルを消す」。
// 途中で失敗しても古い方は残るので、データが消えた状態で止まることはない。
// 新規作成は排他作成（既に在れば失敗）なので、採番が衝突したら気付く。

import { readdir, readFile, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseNodeFile, serializeNodeFile } from "../src/store/frontmatter.ts";
import { isUlid, ulid } from "../src/core/ulid.ts";
import { newGraph, type Node } from "../src/core/model.ts";
import { normalizeForDuplicateCheck } from "../src/core/reconcile.ts";

const EXT = ".md";

const vaultRoot = resolve(process.argv[2] ?? "./vault");
const nodesDir = join(vaultRoot, "nodes");
const apply = process.argv.includes("--apply");

const graph = newGraph();
for (const file of (await readdir(nodesDir)).filter((f) => f.endsWith(EXT))) {
  const id = file.slice(0, -EXT.length);
  const abs = join(nodesDir, file);
  const { node } = parseNodeFile(id, await readFile(abs, "utf8"), (await stat(abs)).mtimeMs);
  graph.nodes[id] = node;
}

const oldIds = Object.keys(graph.nodes);
const pending = oldIds.filter((id) => !isUlid(id));
if (pending.length === 0) {
  console.log(`移行済みです（${oldIds.length} ノード、すべて ULID）。`);
  process.exit(0);
}

// 同じ名前が2つ以上あると、参照を id に直すときにどちらへ繋ぐか決められない。
// 勝手にどちらかへ繋ぐと、間違った方に繋がったことが誰にも分からないまま残る。
const byName = new Map<string, string[]>();
for (const id of oldIds) {
  const key = normalizeForDuplicateCheck(graph.nodes[id]!.name);
  byName.set(key, [...(byName.get(key) ?? []), id]);
}
const ambiguous = [...byName.values()].filter((ids) => ids.length > 1);
if (ambiguous.length > 0) {
  console.error("同じ名前のノードがあるため移行できません。先に名前を分けてください:");
  for (const ids of ambiguous) console.error(`  - ${ids.join(" / ")}`);
  process.exit(1);
}

/** 旧 id（＝名前） → 新 id。既に ULID のものはそのまま。 */
const idMap = new Map<string, string>();
const used = new Set(oldIds);
for (const id of oldIds) {
  if (isUlid(id)) {
    idMap.set(id, id);
    continue;
  }
  let fresh = ulid();
  while (used.has(fresh)) fresh = ulid(); // まず起きないが、採り直しは安い
  used.add(fresh);
  idMap.set(id, fresh);
}

/** 参照を新 id へ。解決できないもの（リンク切れ）はそのまま残す。 */
const remap = (ref: string): string => idMap.get(ref) ?? ref;

const nameOf = (id: string): string | undefined => {
  for (const [oldId, newId] of idMap) if (newId === id) return graph.nodes[oldId]?.name;
  return undefined;
};

const writes: { path: string; content: string; from: string; mtimeMs: number }[] = [];
for (const oldId of oldIds) {
  const node = graph.nodes[oldId]!;
  const newId = idMap.get(oldId)!;
  const migrated: Node = {
    ...node,
    id: newId,
    // ファイル名が意味を失うので、表示名を frontmatter へ移す。
    name: node.name,
    requires: [...new Set(node.requires.map(remap))],
    contains: [...new Set(node.contains.map(remap))],
  };
  writes.push({
    path: join(nodesDir, `${newId}${EXT}`),
    content: serializeNodeFile(migrated, nameOf),
    from: oldId,
    // 元の最終更新時刻を持ち越す。移行で全ファイルが「今」になると、
    // 自動解決の「新しい方を正」が全部「同着」に潰れて判断が人へ戻り、
    // 目的の並び順（最後にいた場所）も失われる。移行は作業ではない。
    mtimeMs: node.mtimeMs,
  });
}

const renamed = writes.filter((w) => !isUlid(w.from));
console.log(`${oldIds.length} ノード中 ${renamed.length} 件を採番します。`);
for (const w of renamed.slice(0, 10)) console.log(`  ${w.from}  →  ${idMap.get(w.from)}`);
if (renamed.length > 10) console.log(`  ほか ${renamed.length - 10} 件`);

const dangling = new Set<string>();
for (const node of Object.values(graph.nodes)) {
  for (const ref of [...node.requires, ...node.contains]) if (!idMap.has(ref)) dangling.add(ref);
}
if (dangling.size > 0) {
  console.log(`\n解決できない参照が ${dangling.size} 件あります（そのまま残します）: ${[...dangling].join(", ")}`);
}

if (!apply) {
  console.log("\n下見だけです。実行するには --apply を付けてください。");
  process.exit(0);
}

// 新しいファイルを全部作りきってから、古いファイルを消す。途中で失敗しても
// 古い方が残るので、データが消えた状態で止まることはない。
for (const w of writes) {
  if (isUlid(w.from)) {
    await writeFile(w.path, w.content, "utf8"); // 既に ULID。参照だけ直して上書き
    continue;
  }
  await writeFile(w.path, w.content, { encoding: "utf8", flag: "wx" }); // 排他作成
}
for (const w of writes) {
  const when = new Date(w.mtimeMs);
  await utimes(w.path, when, when);
}
for (const w of renamed) await unlink(join(nodesDir, `${w.from}${EXT}`));

console.log(`\n完了しました。${renamed.length} 件を採番し、古いファイルを削除しました。`);
console.log("入口ファイル（MOC）は次にアプリを開いたとき作り直されます。");
