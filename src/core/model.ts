// Sirube のデータモデル。
//
// 設計の要点（詳細は Vault の `Works/plans/Sirube/00_Sirube_MOC.md`）:
//
//  1. エッジは `requires` / `contains` の2種類だけ。判別基準は
//     「必要なものが全部揃ったあと、まだ自分でやることが残っているか」——
//     残っていれば `requires`（前提）、残っていなければ `contains`（構成・分担）。
//
//  2. 保存する状態は `satisfied: boolean` ただ1つ。SATISFIED/ACTIONABLE/
//     BLOCKED/CYCLIC の4値は `engine.ts` の `resolveState()` が読むたびに
//     グラフを辿って導出する。ノードに状態を保存しない。
//
//  3. ノードの種別（type）は持たない。ノードは全部同じで、差異は
//     「位置（ルートか末端か）」と「状態」だけ。ルート判定も型ではなく
//     入次数0（誰からも参照されていない）という構造から導出する。
//
//  4. 優先度もタグも持たない。優先度は合流点の入次数が構造として表し、
//     分類・横断的な括りはエッジ（子孫関係・複数親）で表現できるため。
//     同じことを2通りで書けるようにすると分解の流れが止まる。

import { z } from "zod";

/** frontmatter に実際に書き込まれるフィールドだけを定義したスキーマ。
 *
 * 人間もエージェントも手でこれを書くので、実行時検証がそのまま
 * 「壊れた入力を弾く」役に立つ。欠損は `.default()` で吸収し、
 * 「ファイルは読めるが値が変」を「ファイルが壊れている」に
 * 格上げしない（1ノードの欠損でグラフ全体を落とさないため）。 */
export const NodeFrontmatterSchema = z.object({
  /** 表示名。ファイル名（id）が意味を持たない ULID になったので、人が読む
   * 名前はここに置く。省略されていればファイル名を名前として扱う——
   * 移行前の vault と、手で作られたファイルを、そのまま読めるようにするため。 */
  name: z.string().optional(),
  satisfied: z.boolean().default(false),
  requires: z.array(z.string()).default([]),
  contains: z.array(z.string()).default([]),
  /** 外部要因で本当に日付があるノード用（確定申告・契約更新など）。
   * 警告表示や催促はしない——放置すると全部赤くなってノイズ化し、
   * 「中断耐性」という売りと衝突するため。 */
  due: z.string().optional(),
});
export type NodeFrontmatter = z.infer<typeof NodeFrontmatterSchema>;

/** メモリ上のノード。`id` はファイル名（拡張子なし）そのもの。
 *
 * **id はファイル名にしか置かない。** frontmatter に `id:` を書くと2箇所に
 * 同じものを持つことになり、ずれたときに正が決まらなくなる。1箇所に寄せて
 * あるおかげで、ノードファイルを手でコピーしてもファイルシステムが同名を
 * 拒み、2台の vault を git でマージしても add/add コンフリクトになる——
 * どちらも id の重複が自動的に検出される。
 *
 * `name` は表示名で、frontmatter の `name` から読む（無ければ id）。
 * 改名は `name` の1行を書き換えるだけで済み、参照は id のままなので切れない。
 *
 * `mtimeMs` はファイルシステム由来で、ファイルには書かれない。
 * 整合性の自動解決が「変更時刻の新しい方を正とする」ために使う。
 * frontmatter の `updated` を持たせない理由は、アプリ以外（エディタ・
 * エージェント・git merge）が書いたときに更新されず誤判定するから。 */
export interface Node extends NodeFrontmatter {
  id: string;
  name: string;
  /** Markdown 本文（frontmatter を除いた部分）。自由記述メモ。 */
  note: string;
  /** ファイルの最終更新時刻（epoch ms）。永続化されない。 */
  mtimeMs: number;
}

export interface Graph {
  nodes: Record<string, Node>;
}

/** 読むたびに導出される4値。ノードには保存しない。
 *
 * `CYCLIC` は Warframe 版から増えた値。あちらは循環を `BLOCKED` に
 * 潰していたため「前提待ち」と「輪になっていて永久に進めない」が
 * 区別できず、横断ビューで枝が理由も出さずに消えていた。状態は
 * 導出であって保存していないので、値を増やしてもファイル形式は
 * 1バイトも変わらない。 */
export const NODE_STATES = ["SATISFIED", "ACTIONABLE", "BLOCKED", "CYCLIC"] as const;
export type NodeState = (typeof NODE_STATES)[number];

export function newGraph(): Graph {
  return { nodes: {} };
}

/** ファイル名から作る、まだ内容を読んでいない空ノード。
 * DSL や一括追加で「参照されているが実体がないノード」を
 * 起こすときにも使う。 */
export function newNode(id: string, mtimeMs = 0): Node {
  return {
    id,
    name: id,
    satisfied: false,
    requires: [],
    contains: [],
    note: "",
    mtimeMs,
  };
}
