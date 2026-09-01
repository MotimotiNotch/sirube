// Markdown ノードストア。ファイル群 ⇄ メモリ上のグラフ。
//
// Warframe 版の `GraphStore` は1タップのトグルでも `graph.json` 全体を
// 読んで全体を書き戻していた。ここでは**変更されたノードのファイルだけ**を
// 書く。git diff が「誰がどのノードを完了したか」そのものになるのが狙い。

import { analyzeCycles, buildReverseIndex, toggleSatisfied, type ReverseIndex } from "../core/engine.ts";
import { parseBulkRequires, parseDsl, type DslParseResult } from "../core/dsl.ts";
import { newGraph, newNode, type Graph, type Node } from "../core/model.ts";
import { GOALS_DIR, renderMocs } from "../core/moc.ts";
import { applyPlan, planReconcile, type ReconcilePlan } from "../core/reconcile.ts";
import { parseNodeFile, serializeNodeFile } from "./frontmatter.ts";
import type { SirubeFs } from "./fs.ts";

export interface LoadResult {
  graph: Graph;
  /** ファイルごとのスキーマ違反。lint / 自動解決の入力。 */
  issues: { id: string; problems: string[] }[];
}

export class MarkdownGraphStore {
  constructor(private readonly fs: SirubeFs) {}

  /** `nodes/` を全部読んでグラフを組む。
   *
   * サーバを持たない構成なので「起動時に1回」と「file watch で外部変更を
   * 検知したとき」に呼ぶ。数百ファイルなら十分速い。 */
  async load(): Promise<LoadResult> {
    const graph = newGraph();
    const issues: { id: string; problems: string[] }[] = [];
    for (const entry of await this.fs.listNodes()) {
      let text: string;
      try {
        text = await this.fs.readNode(entry.id);
      } catch {
        issues.push({ id: entry.id, problems: ["ファイルを読めませんでした"] });
        continue;
      }
      const { node, issues: problems } = parseNodeFile(entry.id, text, entry.mtimeMs);
      graph.nodes[entry.id] = node;
      if (problems.length > 0) issues.push({ id: entry.id, problems });
    }
    return { graph, issues };
  }

  /** 指定 id のノードだけ書き戻し、mtime をメモリ側にも反映する。 */
  async persist(graph: Graph, ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      const node = graph.nodes[id];
      if (!node) continue;
      await this.fs.writeNode(id, serializeNodeFile(node));
      node.mtimeMs = await this.fs.statNode(id);
    }
  }

  async createNode(graph: Graph, id: string): Promise<Node> {
    if (graph.nodes[id]) return graph.nodes[id];
    const node = newNode(id);
    graph.nodes[id] = node;
    await this.persist(graph, [id]);
    return node;
  }

  async deleteNode(graph: Graph, id: string): Promise<string[]> {
    delete graph.nodes[id];
    await this.fs.deleteNode(id);
    // 参照だけ残ると「リンク切れ」になる。自動解決が空ノードを作り直して
    // しまうので、消すときに参照側からも外しておく。
    const touched: string[] = [];
    for (const [otherId, other] of Object.entries(graph.nodes)) {
      const before = other.requires.length + other.contains.length;
      other.requires = other.requires.filter((r) => r !== id);
      other.contains = other.contains.filter((c) => c !== id);
      if (other.requires.length + other.contains.length !== before) touched.push(otherId);
    }
    await this.persist(graph, touched);
    return touched;
  }

  /** ワンタップトグル。カスケードで巻き込まれたノードも一緒に書く。 */
  async toggle(graph: Graph, id: string): Promise<string[]> {
    const rev = buildReverseIndex(graph);
    const changed = toggleSatisfied(graph, id, rev);
    await this.persist(graph, changed);
    return changed;
  }

  /** 前提の一括追加（`requires` のみ・改行区切り・フラット1段）。 */
  async addBulkRequires(graph: Graph, targetId: string, lines: string): Promise<BulkResult> {
    return this.applyDslResult(graph, parseBulkRequires(targetId, lines));
  }

  /** DSL 一括生成。 */
  async importDsl(graph: Graph, text: string): Promise<BulkResult> {
    return this.applyDslResult(graph, parseDsl(text));
  }

  private async applyDslResult(graph: Graph, parsed: DslParseResult): Promise<BulkResult> {
    if (parsed.errors.length > 0) return { created: [], updated: [], errors: parsed.errors };
    const { created, updated } = mergeNodes(graph, parsed.nodes);
    await this.persist(graph, [...created, ...updated]);
    return { created, updated, errors: [] };
  }

  /** 入口ファイル（MOC 3層）を書き直す。
   *
   * 生成物なので**全部書き直して、二度と読み返さない**。読み返した瞬間に
   * 第二の真実になり、`nodes/` との食い違いを解決する仕事が増える。
   * 消えていても壊れないため、失敗しても本体の操作は続行してよい。 */
  async regenerateMocs(graph: Graph): Promise<void> {
    const docs = renderMocs(graph, buildReverseIndex(graph), analyzeCycles(graph));
    for (const doc of docs) await this.fs.writeDoc(doc.path, doc.content);

    // 消えた目的の層2ファイルを片付ける。残っていても実害は無いが、
    // 存在しない目的の「道」が並ぶと入口としての信頼が落ちる。
    const prefix = `${GOALS_DIR}/`;
    const keep = new Set(
      docs.filter((d) => d.path.startsWith(prefix)).map((d) => d.path.slice(prefix.length)),
    );
    for (const name of await this.fs.listDocs(GOALS_DIR)) {
      if (!keep.has(name)) await this.fs.deleteDoc(`${prefix}${name}`);
    }
  }

  /** 自動解決の計画（グラフは変更しない）。プレビューに使う。 */
  plan(graph: Graph): ReconcilePlan {
    return planReconcile(graph);
  }

  /** 計画を適用して書き戻す。 */
  async reconcile(graph: Graph, plan: ReconcilePlan): Promise<string[]> {
    const changed = applyPlan(graph, plan);
    await this.persist(graph, changed);
    return changed;
  }
}

export interface BulkResult {
  created: string[];
  updated: string[];
  errors: { message: string; pos: number }[];
}

/**
 * DSL が作った素のノード群を既存グラフへ取り込む。
 *
 * 既存 id については `satisfied` / `note` / `due` を**必ず保持**し、
 * `requires` / `contains` は和集合を取る。DSL は構造を足すための記法で
 * あって、達成状態や書きかけのメモを上書きする道具ではない。
 */
export function mergeNodes(graph: Graph, incoming: readonly Node[]): { created: string[]; updated: string[] } {
  const created: string[] = [];
  const updated: string[] = [];
  for (const inc of incoming) {
    const existing = graph.nodes[inc.id];
    if (!existing) {
      graph.nodes[inc.id] = { ...inc };
      created.push(inc.id);
      continue;
    }
    const beforeR = existing.requires.length;
    const beforeC = existing.contains.length;
    existing.requires = [...new Set([...existing.requires, ...inc.requires])];
    existing.contains = [...new Set([...existing.contains, ...inc.contains])];
    if (existing.requires.length !== beforeR || existing.contains.length !== beforeC) updated.push(inc.id);
  }
  return { created, updated };
}

export type { ReverseIndex };
