// ゴール層（「もっと俯瞰」）。実グラフから**ゴールだけの地図**を導出する。
//
// きっかけは、実データ 65 ノードで目的が1つに畳まれたこと（2026-09-11）。
// `哲学を体現する` の下に 64 ノードがぶら下がり、根から末端まで11段になった。
// 入口を開いても直下の子2つと混ざった「今やれること」22件しか出ず、`絵で表明する`
// や `Sirube を世に出す` のような**中腹は一度も入口に現れない**。
//
// かといって目的を切り離して並べると、それらが何のためにあったのかが消える。
// のっちの案は「ゴールを段階的に分割し、ゴールだけを浮上させる」——
//
//     見せたいもの: ゴールA → ゴールB → ゴールC
//     実際のデータ: ゴールA → [ノード → ノード → [ゴールB → [ノード → [ゴールC]]]]
//
// つまり**非ゴールを縮約した商グラフ**。ゴールからゴールへ、間に他のゴールを
// 挟まない道が1本でもあれば線を引く。エッジの種類もフィールドも増えない。
//
// ⚠️ **ここが返すグラフは描画専用。状態導出に使わない。** 商グラフの上で
// `resolveState()` を回すと、間のノードが消えたぶん状態が変わる（前提待ちの
// ゴールが「今やれる」に見える）。状態・進捗は必ず実グラフから引くこと。
// 「判定が3箇所に散ると、片方だけ直したときに別のことを言い始める」（2026-09-02）
// を繰り返さないための境界。

import { buildReverseIndex, inDegree, type ReverseIndex } from "./engine.ts";
import type { Graph, Node } from "./model.ts";

/**
 * ゴールか。**入次数0 ∪ `goal: true`。**
 *
 * 導出だけにすると粒度が揃わない。実データで `contains` の有無を試したところ、
 * 18件のうち `機能を整える` `削除に確認を挟む` のような実務のチェックリストが
 * 6件も浮上した——分けたつもりのない親までゴールになる。
 *
 * 宣言だけにすると、貼り忘れた瞬間に入口が空になる。入次数0（誰からも
 * 要求されていない＝それ以上大きな目的が無い）だけは自動で拾い、そのうえで
 * 中腹を指名できるようにしてある。両方あって初めて「書き忘れても根は出る」
 * ことと「実務が勝手に昇格しない」ことが同時に成り立つ。
 */
export function isGoal(g: Graph, id: string, rev: ReverseIndex): boolean {
  const node = g.nodes[id];
  if (!node) return false;
  return node.goal === true || inDegree(id, rev) === 0;
}

export function goalIds(g: Graph, rev: ReverseIndex): string[] {
  return Object.keys(g.nodes)
    .filter((id) => isGoal(g, id, rev))
    .sort();
}

export interface GoalLayer {
  /** 商グラフ。**描画専用**（状態・進捗は実グラフから引く）。
   *
   * 縮約後のエッジは `requires` に積んである。前提という意味ではなく、
   * 描画側が「`requires` は辿り切って描く」経路に乗せるため——地図は
   * 直下1ホップではなく届く範囲を一息に出す方が地図として読める。
   * 意味を持たせていないので、**この `requires` をファイルへ書かない**。 */
  graph: Graph;
  /** 商グラフの逆引き。ゴール層での入次数＝**いくつのゴールがそれを通るか**。 */
  rev: ReverseIndex;
  /** `betweenKey(from, to)` → 間に挟まっている非ゴールの数。 */
  between: Map<string, number>;
  ids: string[];
}

/** 2つの id を1つのキーに畳む。**区切り文字に頼らない**——長さを前置きすると、
 *  id にも名前にも何が入っていようと一意に戻せる（テストでは名前が id になる）。 */
export function betweenKey(from: string, to: string): string {
  return `${from.length}:${from}${to}`;
}

/**
 * 非ゴールを縮約した商グラフを組む。
 *
 * 各ゴールから幅優先で下り、非ゴールは通過、ゴールに当たったらそこで止めて
 * 線を1本引く（その先は、そのゴール自身から引かれる）。**最短で数えるので**
 * 「2件経由」は近い方の道を指す——遠い道を出すと、実際より遠く見える。
 *
 * 輪があっても止まる（`seen` で刈る）。自分へ戻る線は引かない。
 */
export function goalLayer(g: Graph, rev: ReverseIndex): GoalLayer {
  const ids = goalIds(g, rev);
  const goals = new Set(ids);
  const nodes: Record<string, Node> = {};
  const between = new Map<string, number>();

  for (const id of ids) {
    const reached: string[] = [];
    const seen = new Set<string>([id]);
    let frontier = [id];
    let hop = 0;
    while (frontier.length > 0) {
      const next: string[] = [];
      hop += 1;
      for (const pid of frontier) {
        const parent = g.nodes[pid];
        if (!parent) continue;
        for (const cid of [...parent.requires, ...parent.contains]) {
          if (!g.nodes[cid] || seen.has(cid)) continue;
          seen.add(cid);
          if (goals.has(cid)) {
            reached.push(cid);
            between.set(betweenKey(id, cid), hop - 1);
            continue;
          }
          next.push(cid);
        }
      }
      frontier = next;
    }
    // 並びを決定的にする。地図は開くたびに同じ形でないと「変わった」に見える。
    reached.sort((a, b) => g.nodes[a]!.name.localeCompare(g.nodes[b]!.name, "ja") || a.localeCompare(b));
    nodes[id] = { ...g.nodes[id]!, requires: reached, contains: [] };
  }

  const graph: Graph = { nodes };
  return { graph, rev: buildReverseIndex(graph), between, ids };
}

/** ゴール層の根＝他のどのゴールからも辿り着けないゴール。地図の出発点。 */
export function goalRoots(layer: GoalLayer): string[] {
  return layer.ids.filter((id) => inDegree(id, layer.rev) === 0);
}

/**
 * そのノードを包んでいる一番近いゴール。**自分がゴールなら自分。**
 *
 * 詳細から地図へ上がるときに使う。上向きの幅優先で、同じ距離なら名前順——
 * 合流点は複数の親を持つので、選び方を決めておかないと上がるたびに違う場所へ
 * 着く（`pathFromRoot` で同じ判断をしている）。
 */
export function enclosingGoal(g: Graph, id: string, rev: ReverseIndex): string | undefined {
  if (!g.nodes[id]) return undefined;
  if (isGoal(g, id, rev)) return id;
  const seen = new Set<string>([id]);
  let frontier = [id];
  while (frontier.length > 0) {
    const next: string[] = [];
    const found: string[] = [];
    for (const cur of frontier) {
      const parents = [...(rev.requiredBy.get(cur) ?? []), ...(rev.containedBy.get(cur) ?? [])];
      for (const pid of parents) {
        if (!g.nodes[pid] || seen.has(pid)) continue;
        seen.add(pid);
        if (isGoal(g, pid, rev)) found.push(pid);
        else next.push(pid);
      }
    }
    if (found.length > 0) {
      return found.sort((a, b) => g.nodes[a]!.name.localeCompare(g.nodes[b]!.name, "ja") || a.localeCompare(b))[0];
    }
    frontier = next;
  }
  return undefined;
}
