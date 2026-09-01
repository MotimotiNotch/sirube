// 検索と横断ビュー。
//
// 横断 Next Action ビューは検索の特殊形でしかないので、1つの機能に畳んである:
//   - テキストクエリ          → 全文検索
//   - 空クエリ + ACTIONABLE   → 横断 Next Action ビュー（起動直後の画面）
//   - 空クエリ + 期限順       → 期限リスト
//
// タグは持たない。分類も横断的な括りも既にエッジで表現できている
// （子孫関係＝分類、複数親＝横断）ので、タグを足すと同じことを2通りで
// 書けてしまい、ノードを作るたびに「繋ぐ or タグ」を考えることになる。
// その迷いが分解の流れを止める。

import {
  analyzeCycles,
  blockedByCycle,
  inDegree,
  neighbors,
  resolveState,
  type CycleInfo,
  type Neighbors,
  type ReverseIndex,
} from "./engine.ts";
import type { Graph, NodeState } from "./model.ts";

export interface SearchOptions {
  /** 空文字なら全件（フィルタのみ適用）。名前と本文を対象にする。 */
  query?: string;
  /** 指定した状態のみ。省略時は全状態。 */
  states?: readonly NodeState[];
  /** 隣接を何ホップまで出すか。既定は 1（0 で隣接なし）。 */
  neighborDepth?: 0 | 1;
  limit?: number;
  /** 呼び出し側が既に持っている循環の解析結果。省略すると内部で計算する。
   *
   * 1回の描画でサイドバーと中央が別々に検索を投げるため、渡さないと
   * Tarjan が描画のたびに何度も走る。UI は `AppState` に1つ持っている。 */
  cycles?: CycleInfo;
}

export interface SearchHit {
  id: string;
  state: NodeState;
  /** どの目的の下にいるか。複数並べば合流点。タグの代わりになる。 */
  breadcrumb: string[];
  /** 何箇所から要求されているか＝構造から出る優先度。 */
  inDegree: number;
  due?: string;
  /** 一致が本文側だったかどうか（UI が抜粋を出す判断に使う）。 */
  matchedIn: ("name" | "note")[];
  /** 近接情報。ここが「検索が完全一致ゲームでなくなる」の実体。 */
  neighbors?: Neighbors;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 全体で何件あったか（limit で切る前）。 */
  total: number;
  /** 詰まっている輪。ACTIONABLE が空のときに理由として見せる。 */
  cycles: string[][];
}

/** ルートまで遡って、このノードが属する目的を集める。
 *
 * 半年ぶりに開いて検索したとき、ヒット行に「どの目的の下か」が出ていないと
 * 名前だけでは思い出せない。複数並ぶ＝2つ以上の目的から要求されている
 * （＝片付ければ2つ進む）ことが一目で分かる。 */
export function ancestorRoots(g: Graph, id: string, rev: ReverseIndex, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const parents = [...(rev.requiredBy.get(id) ?? []), ...(rev.containedBy.get(id) ?? [])];
  if (parents.length === 0) return g.nodes[id] ? [id] : [];
  const out = new Set<string>();
  for (const p of parents) for (const r of ancestorRoots(g, p, rev, seen)) out.add(r);
  return [...out];
}

export function search(g: Graph, rev: ReverseIndex, opts: SearchOptions = {}): SearchResult {
  const { query = "", states, neighborDepth = 1, limit } = opts;
  const needle = query.normalize("NFKC").trim().toLowerCase();
  const { cycles, cyclic } = opts.cycles ?? analyzeCycles(g);

  const hits: SearchHit[] = [];
  for (const [id, node] of Object.entries(g.nodes)) {
    const state = resolveState(g, id, cyclic);
    if (states && !states.includes(state)) continue;

    const matchedIn: ("name" | "note")[] = [];
    if (needle !== "") {
      if (node.name.normalize("NFKC").toLowerCase().includes(needle)) matchedIn.push("name");
      if (node.note.normalize("NFKC").toLowerCase().includes(needle)) matchedIn.push("note");
      if (matchedIn.length === 0) continue;
    }

    const hit: SearchHit = {
      id,
      state,
      breadcrumb: ancestorRoots(g, id, rev).filter((r) => r !== id).sort(),
      inDegree: inDegree(id, rev),
      matchedIn,
      ...(node.due !== undefined ? { due: node.due } : {}),
    };
    if (neighborDepth === 1) hit.neighbors = neighbors(g, id, rev);
    hits.push(hit);
  }

  // 名前一致を本文一致より上に。次に入次数の大きい順（片付けると多く進む）、
  // 最後は id で安定ソート。
  hits.sort((a, b) => {
    const an = a.matchedIn.includes("name") ? 0 : 1;
    const bn = b.matchedIn.includes("name") ? 0 : 1;
    return an - bn || b.inDegree - a.inDegree || a.id.localeCompare(b.id);
  });

  const total = hits.length;
  return {
    hits: limit === undefined ? hits : hits.slice(0, limit),
    total,
    cycles,
  };
}

/** 横断 Next Action ビュー。検索の特殊形（空クエリ + ACTIONABLE）。 */
export function nextActions(
  g: Graph,
  rev: ReverseIndex,
  opts: { limit?: number; cycles?: CycleInfo } = {},
): SearchResult {
  return search(g, rev, { states: ["ACTIONABLE"], neighborDepth: 1, ...opts });
}

/** 「今やれること」の件数だけを数える。サイドバーのバッジ用。
 *
 * バッジに要るのは数だけなのに `nextActions().total` を読むと、全ヒットの
 * 祖先辿りと隣接収集まで走ってしまう。描画のたびに検索が丸ごと2回動く形に
 * なるため、数えるだけの経路を分けてある。 */
export function countActionable(g: Graph, cycles?: CycleInfo): number {
  const { cyclic } = cycles ?? analyzeCycles(g);
  let count = 0;
  for (const id of Object.keys(g.nodes)) {
    if (resolveState(g, id, cyclic) === "ACTIONABLE") count += 1;
  }
  return count;
}

export interface StuckReport {
  /** 循環そのもの。「この輪の中に、2つに分かれるノードがあるかもしれません」 */
  cycles: string[][];
  /** 輪に依存していて永久に解けないノード。 */
  blockedByCycles: string[];
}

/**
 * 「今やれること」が空のとき、その理由を返す。
 *
 * 半年ぶりに開いて横断ビューが空だったときに、それが「全部終わっている」
 * のか「輪で詰まっている」のか分からないのが、このツールにとって一番
 * まずい失敗の仕方。実測でも、輪が1つあるだけで ACTIONABLE がほぼ消え、
 * 理由が一切表示されないことを確認している。
 */
export function stuckReport(g: Graph, info?: CycleInfo): StuckReport {
  const { cycles, cyclic } = info ?? analyzeCycles(g);
  const blocked = Object.keys(g.nodes)
    .filter((id) => !g.nodes[id]!.satisfied && blockedByCycle(g, id, cyclic))
    .sort();
  return { cycles, blockedByCycles: blocked };
}
