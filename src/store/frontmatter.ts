// 1ノード = 1 Markdown ファイル の読み書き。
//
// ファイル形式:
//
//     ---
//     satisfied: false
//     requires:
//       - 領収書整理
//       - e-Tax開設
//     contains: []
//     ---
//
//     去年は freee で出した。今年は医療費控除も入れる。
//
// この形式を選んだ理由（MOC「永続化方針」）:
//  - `git diff` が「誰がどのノードを完了したか」そのものになる。単一 JSON を
//    毎回書き戻す方式は1タップで全行が動くので Git と最悪に相性が悪い
//  - Obsidian でそのまま開ける。本文が普通のノートになり既存 Vault に同居できる
//  - ツールが死んでもデータは Markdown として残る
//
// `requires` / `contains` をブロックスタイル（1行1要素）で書き出すのは、
// 前提を1つ足したときの git diff が1行で済むから。フロースタイルだと
// 配列全体が1行なので、何が増えたのか diff から読み取りにくい。

import yaml from "js-yaml";
import { NodeFrontmatterSchema, newNode, type Node } from "../core/model.ts";
import { isUlid } from "../core/ulid.ts";

const FENCE = "---";

export interface ParsedFile {
  frontmatter: unknown;
  body: string;
}

/** `---` で囲まれた先頭ブロックを frontmatter として切り出す。
 * ブロックが無いファイルは「frontmatter 無し・全部が本文」として扱う
 * （手で作ったメモをそのままノードにできる）。 */
export function splitFrontmatter(text: string): ParsedFile {
  // BOM と行頭の空白を許容する。エディタや別ツールが付けることがあるため。
  const normalized = text.replace(/^﻿/, "");
  if (!normalized.startsWith(FENCE)) return { frontmatter: {}, body: normalized.trim() };

  const afterOpen = normalized.slice(FENCE.length);
  // 開始フェンスの直後は改行でなければならない（`----` のような別物を誤認しない）
  if (!/^\r?\n/.test(afterOpen)) return { frontmatter: {}, body: normalized.trim() };

  const closeMatch = afterOpen.match(/\r?\n---[ \t]*(\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    // 閉じフェンスが無い。壊れているが、全部を本文として扱えばデータは失われない。
    return { frontmatter: {}, body: normalized.trim() };
  }

  const yamlText = afterOpen.slice(afterOpen.indexOf("\n") + 1, closeMatch.index);
  const body = afterOpen.slice(closeMatch.index + closeMatch[0].length);
  let parsed: unknown = {};
  try {
    // CORE_SCHEMA を使う理由: 既定スキーマは `due: 2027-03-15` のような
    // 無引用の日付を **Date オブジェクト**に暗黙変換してしまう。frontmatter は
    // 人間とエージェントが素直に書く場所なので、書いたとおりの文字列で
    // 受け取れないと型が合わなくなる（実際にテストで踏んだ）。
    // CORE_SCHEMA は bool / int / float / null / str だけを解決するので、
    // このスキーマに必要なものは全部揃った上で暗黙変換が起きない。
    parsed = yaml.load(yamlText, { schema: yaml.CORE_SCHEMA }) ?? {};
  } catch {
    // YAML が壊れている。ノードは失わず、既定値で起こして lint に拾わせる。
    parsed = {};
  }
  return { frontmatter: parsed, body: body.trim() };
}

export interface ParseNodeResult {
  node: Node;
  /** スキーマに合わなかった箇所。ノード自体は既定値で成立させ、ここに理由を残す。 */
  issues: string[];
}

/** ファイル内容 → Node。`id` はファイル名（拡張子なし）から与える。
 *
 * 1ノードの欠損でグラフ全体を落とさないのが方針。壊れた値は既定値に
 * 落として `issues` に記録し、lint / 自動解決の入力にする。 */
export function parseNodeFile(id: string, text: string, mtimeMs: number): ParseNodeResult {
  const { frontmatter, body } = splitFrontmatter(text);
  const issues: string[] = [];

  const result = NodeFrontmatterSchema.safeParse(frontmatter);
  const fm = result.success
    ? result.data
    : (() => {
        for (const issue of result.error.issues) {
          issues.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
        }
        // 部分的にでも救えるものは救う（satisfied だけ壊れていて requires は
        // 正しい、というケースで前提関係まで失いたくない）。
        const loose = frontmatter as Record<string, unknown>;
        return {
          name: typeof loose?.name === "string" ? loose.name : undefined,
          satisfied: typeof loose?.satisfied === "boolean" ? loose.satisfied : false,
          requires: asStringArray(loose?.requires),
          contains: asStringArray(loose?.contains),
          due: typeof loose?.due === "string" ? loose.due : undefined,
        };
      })();

  const node = newNode(id, mtimeMs);
  // 名前が無ければファイル名を名前として使う。移行前の vault はこれで動く。
  const name = fm.name?.trim();
  if (name !== undefined && name !== "") node.name = name;
  node.satisfied = fm.satisfied;
  node.requires = dedupe(fm.requires);
  node.contains = dedupe(fm.contains);
  if (fm.due !== undefined) node.due = fm.due;
  node.note = body;
  return { node, issues };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map((s) => s.trim()).filter(Boolean))];
}

/** 配列要素の ULID に `# 名前` を添える。人名のまま書かれている要素には付けない
 * （`- 領収書整理  # 領収書整理` はただのノイズなので）。 */
function annotate(yamlText: string, nameOf?: (id: string) => string | undefined): string {
  if (nameOf === undefined) return yamlText;
  return yamlText.replace(/^(\s+- )(\S+)$/gm, (line, indent: string, value: string) => {
    if (!isUlid(value)) return line;
    const name = nameOf(value);
    if (name === undefined || name === "" || name === value) return line;
    // 改行を含む名前は YAML を壊すので1行に潰す。表示のためのコメントなので
    // 情報が多少落ちても構わない。
    const oneLine = name.split("\n").join(" ").split("\r").join(" ");
    return `${indent}${value}  # ${oneLine}`;
  });
}

/** Node → ファイル内容。キー順を固定して git diff を安定させる。
 *
 * `nameOf` を渡すと、`requires` / `contains` の id にコメントで名前を添える。
 * id が ULID になると `- 01J8X2...` だけでは何のことか分からず、Markdown を
 * 手で編集できるという前提が崩れるため。毎回書き直すので古くならないし、
 * YAML のコメントは読み側が読み飛ばすので往復しても消えるだけ。 */
export function serializeNodeFile(node: Node, nameOf?: (id: string) => string | undefined): string {
  const fm: Record<string, unknown> = {};
  // 名前が id と同じなら書かない。移行前の vault のファイルを無意味に
  // 書き換えないための判断で、読み側は名前が無ければ id を名前として使う。
  if (node.name !== node.id) fm.name = node.name;
  fm.satisfied = node.satisfied;
  fm.requires = node.requires;
  fm.contains = node.contains;
  if (node.due !== undefined && node.due !== "") fm.due = node.due;

  const yamlText = annotate(
    yaml.dump(fm, {
      schema: yaml.CORE_SCHEMA, // 読み側と揃える。日付を余計にクォートしない
      sortKeys: false,
      lineWidth: -1, // 折り返さない。長いノード名が途中で折れると diff が読みにくい
      noRefs: true,
    }),
    nameOf,
  );

  const body = node.note.trim();
  return `${FENCE}\n${yamlText}${FENCE}\n${body ? `\n${body}\n` : ""}`;
}
