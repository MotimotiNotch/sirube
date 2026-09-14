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
  collectMembers,
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
  /** このノードの配下だけに絞る（自分は含まない）。目的の「俯瞰」に使う。
   *
   * 一覧は道具としては**俯瞰モード**であって、潜っていく画面ではない
   * （2026-09-02 のっち）。だからこれは入口を差し替えるものではなく、
   * 同じ1画面に絞り込みが1つ増えるだけ。 */
  under?: string;
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
  matchedIn: ("name" | "note" | "number")[];
  /** vault 内で通しの番号（`#12`）。行に出して口頭で指せるようにする。 */
  number?: number;
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

/**
 * 目的（入次数0）から `id` までの経路を1本返す。**`id` 自身は含まない。**
 *
 * 一覧から Chain View へ飛ぶと、それが目的の中のどこなのか画面のどこにも
 * 出ていなかった（のっち報告 2026-09-03）。パンくずに積むために使う。
 *
 * 合流点は複数の親を持つので、**経路は本来一意ではない**。ここが返すのは
 * 上へ向かう幅優先で最初に届いた1本——つまり最短で、同じ長さなら親の名前順。
 * 一覧から飛ぶたびに違う道が出ると、同じノードが毎回違う場所にあるように
 * 見えるので、選び方は決定的にしてある。
 *
 * `id` 自身が目的なら空を返す。輪の中にいて目的へ辿り着けないときも空。
 */
export function pathFromRoot(g: Graph, rev: ReverseIndex, id: string): string[] {
  if (!g.nodes[id]) return [];
  const parentsOf = (nid: string): string[] =>
    [...(rev.requiredBy.get(nid) ?? []), ...(rev.containedBy.get(nid) ?? [])]
      .filter((pid) => g.nodes[pid] !== undefined)
      .sort((a, b) => g.nodes[a]!.name.localeCompare(g.nodes[b]!.name, "ja"));

  if (parentsOf(id).length === 0) return [];

  /** 見つけた親 → そこから `id` へ向かう1つ下。目的に届いたらここを下って組む。 */
  const down = new Map<string, string>();
  const seen = new Set<string>([id]);
  let frontier = [id];

  while (frontier.length > 0) {
    const layer: string[] = [];
    for (const cur of frontier) {
      for (const parent of parentsOf(cur)) {
        if (seen.has(parent)) continue; // 輪はここで止まる
        seen.add(parent);
        down.set(parent, cur);
        if (parentsOf(parent).length === 0) {
          const path: string[] = [];
          for (let w: string | undefined = parent; w !== undefined && w !== id; w = down.get(w)) path.push(w);
          return path;
        }
        layer.push(parent);
      }
    }
    frontier = layer;
  }
  return [];
}

export function search(g: Graph, rev: ReverseIndex, opts: SearchOptions = {}): SearchResult {
  const { query = "", states, neighborDepth = 1, limit, under } = opts;
  const needle = query.normalize("NFKC").trim().toLowerCase();
  const { cycles, cyclic } = opts.cycles ?? analyzeCycles(g);

  // 配下の集合は1回だけ作る。ヒットごとに祖先を辿ると、木の深さぶん同じ道を
  // 何度も上ることになる。
  const scope = under === undefined ? undefined : new Set(collectMembers(g, under));

  const hits: SearchHit[] = [];
  for (const [id, node] of Object.entries(g.nodes)) {
    if (scope && (id === under || !scope.has(id))) continue;
    const state = resolveState(g, id, cyclic);
    if (states && !states.includes(state)) continue;

    const matchedIn: ("name" | "note" | "number")[] = [];
    if (needle !== "") {
      // 番号は完全一致だけ。`1` で `#1 / #10 / #12` が全部出ると、番号で引く
      // 意味（1つに絞る）が無くなる。`#` は付けても付けなくてもよい。
      if (node.number !== undefined && needle.replace(/^#/, "") === String(node.number)) matchedIn.push("number");
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
      ...(node.number !== undefined ? { number: node.number } : {}),
      ...(node.due !== undefined ? { due: node.due } : {}),
    };
    if (neighborDepth === 1) hit.neighbors = neighbors(g, id, rev);
    hits.push(hit);
  }

  // 名前一致を本文一致より上に。次に入次数の大きい順（片付けると多く進む）、
  // 最後は id で安定ソート。
  // 番号一致を最優先に。番号で引くのは「その1つを出せ」という指示なので、
  // 名前に同じ数字を含む行より先に来ないと用を成さない。
  hits.sort((a, b) => {
    const rank = (h: SearchHit): number =>
      h.matchedIn.includes("number") ? 0 : h.matchedIn.includes("name") ? 1 : 2;
    return rank(a) - rank(b) || b.inDegree - a.inDegree || a.id.localeCompare(b.id);
  });

  const total = hits.length;
  return {
    hits: limit === undefined ? hits : hits.slice(0, limit),
    total,
    cycles,
  };
}

/**
 * 最近書き換わったノード。**再開の手がかり**（2026-09-14、のっち「足りない機能」の2番目）。
 *
 * 「半年空けても道が残っている」を約束しているのに、開き直したときに出るのは
 * 前回見ていた場所だけで、「何を動かしていたか」は画面のどこにも無かった。
 * 生成 MOC は既に `lastTouched` で新しい順に並べているので、同じ手がかりを
 * アプリにも出す。
 *
 * 並べる鍵はファイルの mtime。**本人が触った順ではない**——カスケードで一緒に
 * 書かれたもの、前提を足された親、AI や git が書いたものも上に来る。それでも
 * 「このあたりが動いていた」は分かるので、区別する仕組みは足さない（足すなら
 * 書いた主体をファイルに持つことになり、`updated` を持たない方針とぶつかる）。
 *
 * 状態では絞らない。達成したばかりのものが「最後にやったこと」そのものなので。
 * 検索の形（`SearchResult`）で返し、一覧の描画をそのまま使う。
 */
export function recentlyChanged(
  g: Graph,
  rev: ReverseIndex,
  opts: { limit?: number; cycles?: CycleInfo } = {},
): SearchResult {
  const all = search(g, rev, { neighborDepth: 0, ...(opts.cycles ? { cycles: opts.cycles } : {}) });
  const mtime = (id: string): number => g.nodes[id]?.mtimeMs ?? 0;
  const hits = all.hits
    .filter((hit) => mtime(hit.id) > 0)
    .sort((a, b) => mtime(b.id) - mtime(a.id) || a.id.localeCompare(b.id));
  return {
    hits: opts.limit === undefined ? hits : hits.slice(0, opts.limit),
    total: hits.length,
    // 輪の案内は「今やれることが空の理由」を言うためのもの。ここでは出さない。
    cycles: [],
  };
}

/** 横断 Next Action ビュー。検索の特殊形（空クエリ + ACTIONABLE）。 */
export function nextActions(
  g: Graph,
  rev: ReverseIndex,
  opts: { limit?: number; cycles?: CycleInfo; under?: string } = {},
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
