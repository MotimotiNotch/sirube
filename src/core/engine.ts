// 状態導出とカスケード。Sirube の思想的な核。
//
// Warframe State Graph の `ts/server/engine.ts` からの移植だが、以下を変更している:
//  - 循環を `BLOCKED` に潰さず `CYCLIC` として区別して返す
//  - ルート判定を「型が Goal/Build か」ではなく「入次数0」に置き換えた
//  - 検索用の隣接取得（4方向）を追加した

import type { Graph, Node, NodeState } from "./model.ts";

// ---------------------------------------------------------------------------
// 逆引きインデックス
// ---------------------------------------------------------------------------

/** 「誰が自分を参照しているか」の逆引き。
 *
 * `requires` / `contains` はノード自身が持つ前向きの配列なので、
 * 逆向き（自分を待っているのは誰か・自分はどこに属しているか）は
 * 全ノードを走査しないと分からない。毎回走査すると O(n) が何度も
 * 走るため、まとめて1回で作る。 */
export interface ReverseIndex {
  /** id -> それを `requires` に挙げているノードの id 群 */
  requiredBy: Map<string, string[]>;
  /** id -> それを `contains` に挙げているノードの id 群 */
  containedBy: Map<string, string[]>;
}

export function buildReverseIndex(g: Graph): ReverseIndex {
  const requiredBy = new Map<string, string[]>();
  const containedBy = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, key: string, value: string): void => {
    const arr = m.get(key);
    if (arr) arr.push(value);
    else m.set(key, [value]);
  };
  for (const [id, node] of Object.entries(g.nodes)) {
    for (const r of node.requires) push(requiredBy, r, id);
    for (const c of node.contains) push(containedBy, c, id);
  }
  return { requiredBy, containedBy };
}

// ---------------------------------------------------------------------------
// 循環検出
// ---------------------------------------------------------------------------

/** `requires` の有向グラフ上で強連結成分を求め、循環しているものだけ返す。
 *
 * 循環はエラーではなく「分解が足りない」信号として扱う。輪ができるのは
 * 1つの名前に2つの違うものが混ざっているサインで（「案件を取る」の中に
 * 「実績が要る案件」と「実績が要らない案件」が同居している等）、割ると
 * 要求の向きが揃ってほどける。
 *
 * `contains` は辿らない。構成関係で輪ができるのは純粋な入力ミスであり、
 * 「分解が足りない」という診断が当てはまらないため（そちらは lint 側の
 * 仕事）。
 *
 * 返り値は成分ごとのノード id 配列。要素数1の成分は自己ループのときだけ
 * 含める。 */
export function findCycles(g: Graph): string[][] {
  // Tarjan の強連結成分分解。
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const result: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of g.nodes[v]?.requires ?? []) {
      if (!g.nodes[w]) continue; // リンク切れは lint の担当、ここでは無視
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      const selfLoop = component.length === 1 && (g.nodes[v]?.requires.includes(v) ?? false);
      if (component.length > 1 || selfLoop) result.push(component.reverse());
    }
  };

  for (const id of Object.keys(g.nodes)) {
    if (!indices.has(id)) strongConnect(id);
  }
  return result;
}

/** 循環の解析結果をまとめた持ち回り用の値。
 *
 * 成分の一覧（「割れ」の告知に使う）と、それを平らにした集合
 * （`resolveState` に渡すと再計算を避けられる）は常に対で要る。別々に
 * 取ると Tarjan が2回走るため、1回の走査から両方を作って持ち回る。 */
export interface CycleInfo {
  /** 成分ごとのノード id 配列。 */
  cycles: string[][];
  /** 上を平らにした集合。 */
  cyclic: Set<string>;
}

export function analyzeCycles(g: Graph): CycleInfo {
  const cycles = findCycles(g);
  const cyclic = new Set<string>();
  for (const cycle of cycles) for (const id of cycle) cyclic.add(id);
  return { cycles, cyclic };
}

/** 循環上にいるノードの集合。`resolveState` に渡すと再計算を避けられる。 */
export function cyclicNodes(g: Graph): Set<string> {
  return analyzeCycles(g).cyclic;
}

// ---------------------------------------------------------------------------
// 状態導出
// ---------------------------------------------------------------------------

/** 単独のノードが循環上にいるか（`cyclic` 集合を用意しない呼び出し向け）。 */
function isOnCycle(g: Graph, start: string): boolean {
  const seen = new Set<string>();
  const stack = [...(g.nodes[start]?.requires ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === start) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(g.nodes[cur]?.requires ?? []));
  }
  return false;
}

/**
 * ノードの充足状態を導出する。保存はしない。
 *
 * - `satisfied` が立っていれば `SATISFIED`
 * - 自分が循環上にいれば `CYCLIC`（前提待ちと区別する）
 * - `requires` が空、または全部 `SATISFIED` なら `ACTIONABLE`
 * - それ以外は `BLOCKED`
 *
 * `cyclic` を渡すと循環判定を再計算しない。多数のノードを一度に
 * 評価するとき（検索・横断ビュー）は `cyclicNodes()` の結果を渡す。
 */
export function resolveState(
  g: Graph,
  nodeId: string,
  cyclic?: ReadonlySet<string>,
  stack: ReadonlySet<string> = new Set(),
): NodeState {
  const node = g.nodes[nodeId];
  if (!node) return "BLOCKED"; // リンク切れ。落とさず静かに詰まらせる（lint が拾う）
  if (node.satisfied) return "SATISFIED";

  const onCycle = cyclic ? cyclic.has(nodeId) : isOnCycle(g, nodeId);
  if (onCycle) return "CYCLIC";

  if (stack.has(nodeId)) return "BLOCKED"; // 保険のサイクルガード
  if (node.requires.length === 0) return "ACTIONABLE";

  const next = new Set(stack);
  next.add(nodeId);
  for (const reqId of node.requires) {
    if (resolveState(g, reqId, cyclic, next) !== "SATISFIED") return "BLOCKED";
  }
  return "ACTIONABLE";
}

/** `BLOCKED` の理由が「前提の先に輪がある」ことかどうか。
 *
 * 循環そのものに乗っていなくても、循環に依存していれば永久に解けない。
 * 「なぜこれは進まないのか」を人に返すために要る——半年ぶりに開いて
 * 横断ビューが空だったとき、その理由が見えないのが一番まずい。 */
export function blockedByCycle(g: Graph, nodeId: string, cyclic: ReadonlySet<string>): boolean {
  if (cyclic.has(nodeId)) return false; // 自分が輪の上なら CYCLIC であって BLOCKED ではない
  const seen = new Set<string>();
  const stack = [...(g.nodes[nodeId]?.requires ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cyclic.has(cur)) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(g.nodes[cur]?.requires ?? []));
  }
  return false;
}

// ---------------------------------------------------------------------------
// カスケード
// ---------------------------------------------------------------------------

/**
 * 達成したノードの `requires` 連鎖を遡り、前提も全部達成にする。
 * 「後が終わっているなら、前も終わっていたはず」という `requires` の意味論。
 *
 * `contains` は辿らない（親が満たされても部品が揃ったことにはならない）。
 */
export function cascadeSatisfyRequires(g: Graph, nodeId: string, seen: Set<string> = new Set()): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  for (const reqId of g.nodes[nodeId]?.requires ?? []) {
    const req = g.nodes[reqId];
    if (!req) continue;
    req.satisfied = true;
    cascadeSatisfyRequires(g, reqId, seen);
  }
}

/**
 * 未達成に戻したノードに依存していたもの（下流）も未達成に戻す。
 * 「前提が崩れたなら、その上に積んだものも本当は終わっていない」。
 *
 * 前提側には触らない——1つ戻したからといって、その前にやったことが
 * 無かったことにはならない。
 *
 * これは「明示的に戻す」と言ったときだけ走らせる。読み込み時の正規化に
 * してはいけない（情報を壊す方向で、意図的な巻き戻しという操作自体が
 * 消える）。
 */
export function cascadeUnsatisfyDependents(
  g: Graph,
  nodeId: string,
  rev: ReverseIndex,
  seen: Set<string> = new Set(),
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  for (const depId of rev.requiredBy.get(nodeId) ?? []) {
    const dep = g.nodes[depId];
    if (!dep) continue;
    dep.satisfied = false;
    cascadeUnsatisfyDependents(g, depId, rev, seen);
  }
}

/**
 * `contains` の子が全部揃った親を、自動で達成にする（下→上への集約）。
 * 親に固有の作業が無いからこそ `contains` なので、子が揃えば親は完成している。
 *
 * 一方向のみ（2026-08-26 のっち判断）。子を1つ戻しても親は自動では戻さない
 * ——到達した達成は記録として残す。
 */
export function cascadeSatisfyContainsParents(
  g: Graph,
  nodeId: string,
  rev: ReverseIndex,
  seen: Set<string> = new Set(),
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  for (const parentId of rev.containedBy.get(nodeId) ?? []) {
    const parent = g.nodes[parentId];
    if (!parent || parent.satisfied) continue;
    if (!parent.contains.every((childId) => g.nodes[childId]?.satisfied)) continue;
    parent.satisfied = true;
    cascadeSatisfyRequires(g, parentId);
    cascadeSatisfyContainsParents(g, parentId, rev, seen);
  }
}

/** 手動トグルの入口。達成・取り消しでカスケードの向きが変わる。
 * 変更されたノードの id 集合を返す（ストアが差分だけ書き戻すため）。 */
export function toggleSatisfied(g: Graph, nodeId: string, rev: ReverseIndex): string[] {
  const node = g.nodes[nodeId];
  if (!node) throw new Error(`node "${nodeId}" not found`);
  const before = snapshot(g);
  node.satisfied = !node.satisfied;
  if (node.satisfied) {
    cascadeSatisfyRequires(g, nodeId);
    cascadeSatisfyContainsParents(g, nodeId, rev);
  } else {
    cascadeUnsatisfyDependents(g, nodeId, rev);
  }
  return diffSatisfied(before, g);
}

function snapshot(g: Graph): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const [id, n] of Object.entries(g.nodes)) m.set(id, n.satisfied);
  return m;
}

/** `satisfied` が変わったノードの id。 */
export function diffSatisfied(before: Map<string, boolean>, g: Graph): string[] {
  const changed: string[] = [];
  for (const [id, n] of Object.entries(g.nodes)) {
    if (before.get(id) !== n.satisfied) changed.push(id);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// 構造
// ---------------------------------------------------------------------------

/** ルート＝入次数0。誰からも `requires` / `contains` されていないノード。
 *
 * Warframe 版は `type === "Build" || type === "Goal"` で判定していたが、
 * `type` を廃止したので構造から導出する。手で種別を付けるより正確で、
 * 「優先度も合流点の入次数から出る」という発想とも揃う。 */
export function roots(g: Graph, rev: ReverseIndex): string[] {
  return Object.keys(g.nodes)
    .filter((id) => (rev.requiredBy.get(id)?.length ?? 0) === 0 && (rev.containedBy.get(id)?.length ?? 0) === 0)
    .sort();
}

/** 合流点の入次数。「片付ければ何個の枝が進むか」＝構造から出る優先度。 */
export function inDegree(id: string, rev: ReverseIndex): number {
  return (rev.requiredBy.get(id)?.length ?? 0) + (rev.containedBy.get(id)?.length ?? 0);
}

/** `contains` と `requires` の両方を下向きに辿って集めた子孫（自分を含む）。 */
export function collectMembers(g: Graph, nodeId: string, seen: Set<string> = new Set()): string[] {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const node = g.nodes[nodeId];
  if (!node) return [];
  const members = [nodeId];
  for (const childId of [...node.contains, ...node.requires]) {
    members.push(...collectMembers(g, childId, seen));
  }
  return members;
}

export interface Progress {
  done: number;
  total: number;
}

export function progress(g: Graph, nodeId: string): Progress {
  const members = collectMembers(g, nodeId);
  return {
    done: members.filter((id) => g.nodes[id]?.satisfied).length,
    total: members.length,
  };
}

// ---------------------------------------------------------------------------
// 隣接（検索の「近接情報を浮かび上がらせる」用）
// ---------------------------------------------------------------------------

/** 隣接の4方向。深さは1ホップまで。
 *
 * 検索が完全一致ゲームでなくなるのがこれの意味。「CI/CD」で引くと
 * 「手順書」も浮かぶので、「手順書」という単語を思い出せなくても
 * 辿り着ける。長期の中断から戻ったとき思い出せるのは断片ひとつで、
 * そこから周辺が復元される。 */
export interface Neighbors {
  /** 自分が `requires` するもの（これが要る） */
  requires: string[];
  /** 自分を `requires` するもの（これを待っている＝片付けると解ける） */
  requiredBy: string[];
  /** 自分が `contains` するもの（構成要素） */
  contains: string[];
  /** 自分を `contains` するもの（属する親） */
  containedBy: string[];
}

export function neighbors(g: Graph, nodeId: string, rev: ReverseIndex): Neighbors {
  const node = g.nodes[nodeId];
  const exists = (id: string): boolean => !!g.nodes[id];
  return {
    requires: (node?.requires ?? []).filter(exists),
    requiredBy: (rev.requiredBy.get(nodeId) ?? []).filter(exists),
    contains: (node?.contains ?? []).filter(exists),
    containedBy: (rev.containedBy.get(nodeId) ?? []).filter(exists),
  };
}

/** UI が1回のフェッチで描けるよう、ノード＋導出値をまとめた形。 */
export interface NodeView extends Node {
  state: NodeState;
  inDegree: number;
}

export function toView(g: Graph, id: string, rev: ReverseIndex, cyclic: ReadonlySet<string>): NodeView | undefined {
  const node = g.nodes[id];
  if (!node) return undefined;
  return { ...node, state: resolveState(g, id, cyclic), inDegree: inDegree(id, rev) };
}
