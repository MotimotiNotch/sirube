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
  return findCyclesOn(g, (n) => n.requires);
}

/** `contains` だけを辿った輪。
 *
 * こちらは**分解が足りない信号ではなく、純粋な入力ミス**（「A の中に B、B の中に
 * A」は意味を成さない）。だから `CYCLIC` にはせず、自動解決の「判断が必要」へ
 * 出す。文言も「割る」ではなく「エッジが間違っている」側になる。
 *
 * 検出そのものは要る。放っておくと `resolveState` の保険ガードに落ちて
 * **理由の出ない `BLOCKED`** になり、「今やれることが空なのに理由が分からない」
 * という、このツールにとって一番まずい失敗の仕方をする。 */
export function findContainsCycles(g: Graph): string[][] {
  return findCyclesOn(g, (n) => n.contains);
}

/** 辿るエッジを差し替えられる Tarjan。2種類のエッジで同じ実装を使う——
 *  片方だけ直して、もう片方が古い判定のまま残るのを防ぐ。 */
function findCyclesOn(g: Graph, edgesOf: (n: Graph["nodes"][string]) => readonly string[]): string[][] {
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

    const node = g.nodes[v];
    for (const w of node ? edgesOf(node) : []) {
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
      const self = g.nodes[v];
      const selfLoop = component.length === 1 && (self ? edgesOf(self).includes(v) : false);
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
 * - `requires` と `contains` が空、または全部 `SATISFIED` なら `ACTIONABLE`
 * - それ以外は `BLOCKED`
 *
 * `contains` も見る理由: 2種類のエッジは**どちらも「何が必要か」**を表して
 * おり、違うのは完了の伝わる向きだけ（`requires` は上へ遡及、`contains` は
 * 下から集約）。「今やれるか」を問う側から見れば区別は無い。`requires` しか
 * 見ないと、子が1つも終わっていない中間ノード（`MVP実装完了` など）が
 * 「前提ゼロ＝今やれる」と判定され、横断 Next Action ビューに紛れ込む。
 * 判別基準（必要なものが揃ったあと、まだ自分でやることが残っているか）で
 * 言えば `contains` の親には固有の作業が無いので、そもそも「今やれること」
 * には出てはいけない。
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
  if (node.requires.length === 0 && node.contains.length === 0) return "ACTIONABLE";

  // 配列を結合せず2周するのは、ここが検索・横断ビューで全ノード分回る
  // ホットパスのため。
  const next = new Set(stack);
  next.add(nodeId);
  for (const reqId of node.requires) {
    if (resolveState(g, reqId, cyclic, next) !== "SATISFIED") return "BLOCKED";
  }
  for (const childId of node.contains) {
    if (resolveState(g, childId, cyclic, next) !== "SATISFIED") return "BLOCKED";
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
  // `resolveState` が両方のエッジを見る以上、こちらも両方辿らないと
  // 「なぜ止まっているのか」を取りこぼす。輪の上にいる孫を `contains` で
  // 抱えた親が、理由の分からない BLOCKED として残ってしまう。
  const stack = [...(g.nodes[nodeId]?.requires ?? []), ...(g.nodes[nodeId]?.contains ?? [])];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cyclic.has(cur)) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(g.nodes[cur]?.requires ?? []), ...(g.nodes[cur]?.contains ?? []));
  }
  return false;
}

// ---------------------------------------------------------------------------
// カスケード
// ---------------------------------------------------------------------------

/** カスケードが1件書き換えるたびに呼ばれる記録係。
 *
 * これが要るのは、**トグルを「黙って書く」から「見せてから書く」へ寄せた**
 * ため（2026-09-10）。プレビューは実際のカスケードとは別の理屈で作ってはいけない
 * ——`resolveState` とカスケードが食い違った 2026-09-02 と同じ穴が、今度は
 * 「見せたもの」と「書いたもの」の間に開く。なので**計画も適用も同じこの関数群を
 * 通し**、違いは「本物のグラフに書くか、写しに書くか」だけにしてある。 */
export type CascadeLog = (change: ToggleChange) => void;

/**
 * 達成したノードの `requires` 連鎖を遡り、前提も全部達成にする。
 * 「後が終わっているなら、前も終わっていたはず」という `requires` の意味論。
 *
 * `contains` は辿らない（親が満たされても部品が揃ったことにはならない）。
 */
export function cascadeSatisfyRequires(
  g: Graph,
  nodeId: string,
  seen: Set<string> = new Set(),
  log?: CascadeLog,
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  for (const reqId of g.nodes[nodeId]?.requires ?? []) {
    const req = g.nodes[reqId];
    if (!req) continue;
    // 既に達成のものは「変わらない」ので記録しない。辿るのは従来どおり続ける
    // ——途中に達成済みが挟まっていても、その先に未達の前提は残りうる。
    if (!req.satisfied) {
      req.satisfied = true;
      log?.({ kind: "prerequisite", id: reqId, via: nodeId });
    }
    cascadeSatisfyRequires(g, reqId, seen, log);
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
  log?: CascadeLog,
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  for (const depId of rev.requiredBy.get(nodeId) ?? []) {
    const dep = g.nodes[depId];
    if (!dep) continue;
    if (dep.satisfied) {
      dep.satisfied = false;
      log?.({ kind: "dependent", id: depId, via: nodeId });
    }
    cascadeUnsatisfyDependents(g, depId, rev, seen, log);
  }
}

/**
 * `contains` の子が全部揃った親を、自動で達成にする（下→上への集約）。
 * 親に固有の作業が無いからこそ `contains` なので、子が揃えば親は完成している。
 *
 * **ただし親の `requires` も満たされていること。** 「必要なものが全部揃った」
 * の判定は `resolveState()` と同じでなければならない——片方だけが両エッジを
 * 見ていると、導出とカスケードが別のことを言い始める。
 *
 * 一方向のみ（2026-08-26 のっち判断）。子を1つ戻しても親は自動では戻さない
 * ——到達した達成は記録として残す。
 */
export function cascadeSatisfyContainsParents(
  g: Graph,
  nodeId: string,
  rev: ReverseIndex,
  seen: Set<string> = new Set(),
  log?: CascadeLog,
): void {
  if (seen.has(nodeId)) return;
  seen.add(nodeId);
  // 上げる先は「自分を contains する親」だけではない。**自分を requires する親も
  // 見る**——`contains` を持つ親には固有の作業が無いので、最後に埋まったのが
  // 前提側でも「もうやることが無い」ことに変わりはない。`contains` を持たない親
  // （純粋な前提関係）はここで弾かれるので、`requires` の意味は変わらない。
  const parents = new Set([...(rev.containedBy.get(nodeId) ?? []), ...(rev.requiredBy.get(nodeId) ?? [])]);
  for (const parentId of parents) {
    const parent = g.nodes[parentId];
    if (!parent || parent.satisfied) continue;
    if (parent.contains.length === 0) continue; // 集約の対象は contains を持つ親だけ
    // **前提も見る。** 子（contains）が揃っただけで親を立てると、その親に
    // 未達の `requires` があっても達成にしてしまう（2026-09-02、実データで
    // 目的が勝手に達成済みになった。`requires` と `contains` の両方を持つ
    // ノードが実際に現れたのが初めてだった）。
    //
    // `resolveState()` は 2026-09-01 に「2種類のエッジはどちらも『何が必要か』
    // を表す」として両方を見るようにしたが、カスケード側が追従していなかった。
    // 判定の基準は1つでないと、導出とカスケードが別のことを言い始める。
    const ready =
      parent.contains.every((childId) => g.nodes[childId]?.satisfied) &&
      parent.requires.every((reqId) => g.nodes[reqId]?.satisfied);
    if (!ready) continue;
    parent.satisfied = true;
    log?.({ kind: "contains-parent", id: parentId });
    cascadeSatisfyRequires(g, parentId, new Set(), log);
    cascadeSatisfyContainsParents(g, parentId, rev, seen, log);
  }
}

// ---------------------------------------------------------------------------
// トグルの計画と適用
// ---------------------------------------------------------------------------

/** トグル1回でファイルに書かれる変更、1件ぶん。**理由まで持つ**——
 *  「なぜこれが一緒に動くのか」が言えないと、プレビューはただの一覧になる。 */
export type ToggleChange =
  /** 押されたノード自身。 */
  | { kind: "target"; id: string; satisfied: boolean }
  /** `requires` の遡及で達成になる前提（`via` を達成にしたから）。 */
  | { kind: "prerequisite"; id: string; via: string }
  /** 子と前提が全部揃ったので達成になる親。 */
  | { kind: "contains-parent"; id: string }
  /** 取り消しで未達成に戻る下流（`via` を戻したから）。 */
  | { kind: "dependent"; id: string; via: string };

export interface TogglePlan {
  target: string;
  /** 押した結果、対象がどちらになるか。 */
  satisfied: boolean;
  /** 対象を含む、書き換わるノード全部。押した1件だけなら長さ1。 */
  changes: ToggleChange[];
}

/**
 * トグルを**実行せずに**、何が書き換わるかだけ出す。
 *
 * 遡及カスケードは実データで一度に15件を書き換えた（2026-09-09、`生活の収入を
 * つくる` のトグルが `Sirube を完成させる` `MVP実装完了` 等を達成にした）。
 * 表示ではなくファイルへの書き込みなので、押し間違いの実害が違う。**自動解決が
 * プレビューを出してから実行するのに、トグルだけ黙って書いていた**のが非対称
 * だった——入口が違うだけで同じ「前提を埋める」が起きている。
 *
 * 写しの上で本物のカスケードを走らせて記録する。プレビュー専用の再実装は置かない。
 */
export function planToggle(g: Graph, nodeId: string, rev: ReverseIndex): TogglePlan {
  if (!g.nodes[nodeId]) throw new Error(`node "${nodeId}" not found`);
  // `satisfied` だけ書き換えるので、ノードは浅い写しで足りる（`requires` /
  // `contains` の配列はカスケードが触らない）。
  const shadow: Graph = { nodes: {} };
  for (const [id, n] of Object.entries(g.nodes)) shadow.nodes[id] = { ...n };

  const changes: ToggleChange[] = [];
  const target = shadow.nodes[nodeId]!;
  target.satisfied = !target.satisfied;
  changes.push({ kind: "target", id: nodeId, satisfied: target.satisfied });

  const seenIds = new Set<string>([nodeId]);
  const log: CascadeLog = (c) => {
    if (seenIds.has(c.id)) return; // 同じノードへ2つの理由で届いても、書き込みは1回
    seenIds.add(c.id);
    changes.push(c);
  };

  if (target.satisfied) {
    cascadeSatisfyRequires(shadow, nodeId, new Set(), log);
    cascadeSatisfyContainsParents(shadow, nodeId, rev, new Set(), log);
  } else {
    cascadeUnsatisfyDependents(shadow, nodeId, rev, new Set(), log);
  }
  return { target: nodeId, satisfied: target.satisfied, changes };
}

/** その変更が書き込む値。押したノードは計画の向き、それ以外は理由で決まる
 *  （前提と親は達成、下流は取り消し）。**書き込みと控えで同じ規則を使う**——
 *  2箇所に書くと、戻す値だけがずれても誰も気付けない。 */
function valueOf(c: ToggleChange): boolean {
  return c.kind === "target" ? c.satisfied : c.kind !== "dependent";
}

/** 計画をグラフへ適用し、実際に変わった id を返す（ストアが差分だけ書き戻す）。 */
export function applyTogglePlan(g: Graph, plan: TogglePlan): string[] {
  const changed: string[] = [];
  for (const c of plan.changes) {
    const node = g.nodes[c.id];
    if (!node) continue;
    const value = valueOf(c);
    if (node.satisfied === value) continue;
    node.satisfied = value;
    changed.push(c.id);
  }
  return changed;
}

/**
 * 直前のトグルを戻すための控え。**カスケードの逆再生ではなく、書いた値の巻き戻し。**
 *
 * もう一度押しても戻らない。往路（達成）は `requires` を遡って前提を埋め、
 * 復路（取り消し）は下流を戻す——**向きが違う**ので、同じノードを2回押すと
 * 埋まった前提はそのまま残り、代わりに別のノードが未達に落ちる。押す前とは
 * 違う状態になる。「間違えて押してもすぐ戻せる」は成り立っていなかった
 * （`DOUBLE_TAP_GUARD_MS` を達成のトグルに掛けなかった根拠がこれで、
 * カスケードが入った時点で崩れていた）。
 *
 * だから戻すのは記録からで、ここではカスケードを一切走らせない。
 */
export interface ToggleUndo {
  /** 何を押した結果か。文言に使うだけで、戻す処理には要らない。 */
  target: string;
  /** 書き換えたノードと、その前後の値。 */
  entries: { id: string; before: boolean; after: boolean }[];
}

/** 控えを取る。**適用する前**のグラフから読むので、`applyTogglePlan` と対で
 *  呼ぶ（ストアの `applyToggle` が両方を持っている）。 */
export function captureUndo(g: Graph, plan: TogglePlan): ToggleUndo {
  const entries: ToggleUndo["entries"] = [];
  for (const c of plan.changes) {
    const node = g.nodes[c.id];
    if (!node) continue;
    const after = valueOf(c);
    if (node.satisfied === after) continue; // 動かないものは戻す対象でもない
    entries.push({ id: c.id, before: node.satisfied, after });
  }
  return { target: plan.target, entries };
}

/**
 * まだ戻せるか。**書いたときの値がそのまま残っているものだけ**を戻す。
 *
 * 間に外（Obsidian / AI / git のマージ）が触っていたら、巻き戻しは他人の
 * 書き込みを消す操作になる。1件でも食い違ったら諦める——部分的に戻すと、
 * 何が戻って何が残ったのかが画面のどこにも出ない。
 */
export function canUndo(g: Graph, undo: ToggleUndo): boolean {
  if (undo.entries.length === 0) return false;
  return undo.entries.every((e) => g.nodes[e.id]?.satisfied === e.after);
}

/** 控えを戻し、変わった id を返す。 */
export function applyUndo(g: Graph, undo: ToggleUndo): string[] {
  const changed: string[] = [];
  for (const e of undo.entries) {
    const node = g.nodes[e.id];
    if (!node || node.satisfied !== e.after) continue;
    node.satisfied = e.before;
    changed.push(e.id);
  }
  return changed;
}

/** 手動トグルの入口。達成・取り消しでカスケードの向きが変わる。
 * 変更されたノードの id 集合を返す（ストアが差分だけ書き戻すため）。
 *
 * **計画を立てて即座に適用するだけ**にしてある。ここが独自にカスケードを
 * 呼ぶと、プレビューで見せた内容と実際の書き込みがずれうる。 */
export function toggleSatisfied(g: Graph, nodeId: string, rev: ReverseIndex): string[] {
  return applyTogglePlan(g, planToggle(g, nodeId, rev));
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

/**
 * 下に**描けるものが**あるか。参照だけあって実体の無い id は数えない。
 *
 * 「潜る意味があるか」の判定に使う。数えてしまうと、潜った先が空のまま
 * 「潜れるノード」に見える。`requires` と `contains` の両方を見るのは、
 * どちらも「下に何かある」ことに変わりないため。
 */
export function hasChildren(g: Graph, id: string): boolean {
  const n = g.nodes[id];
  if (!n) return false;
  return [...n.requires, ...n.contains].some((cid) => g.nodes[cid] !== undefined);
}

/** 合流点の入次数。「片付ければ何個の枝が進むか」＝構造から出る優先度。 */
export function inDegree(id: string, rev: ReverseIndex): number {
  return (rev.requiredBy.get(id)?.length ?? 0) + (rev.containedBy.get(id)?.length ?? 0);
}

// ---------------------------------------------------------------------------
// 近道（要らなくなった直接の前提）
// ---------------------------------------------------------------------------

/** `from -> to` の直接の前提が、`via` を通る別の道でも届いている。 */
export interface Shortcut {
  from: string;
  to: string;
  via: string;
}

/**
 * 繋いだことで**要らなくなった直接の `requires`** を探す。
 *
 * 「分解する」の前提タブは親の直下にフラットに並べるので、書いた時点では
 * 「前提の前提」も兄弟として並ぶ（`引っ越し -> 引っ越し先の家`、
 * `引っ越し -> 不動産に行く`）。後で `引っ越し先の家 -> 不動産に行く` と繋いでも
 * `引っ越し -> 不動産に行く` が残り、**入次数が水増しされて偽の合流点になる**
 * （優先度は入次数から出るので、嘘の優先度が付く）。のっち 2026-09-14
 * 「一括登録で前提を追加すると同じレイヤーに追加されて混乱しそう」。
 *
 * 入力を階層付きにはしない——書き出す瞬間に構造を決めさせると分解の速度が落ちる。
 * 平らに書かせて、**繋いだ瞬間に近道を信号として見せる**（輪と同じ扱い）。
 *
 * 外しても状態は変わらない。`from` が今やれるには `via` の達成が要り、`via` の
 * 達成には（遡及があるので）`to` の達成が伴う。カスケードも `via` を経由して
 * 同じ所へ届く。
 *
 * 見るのは `requires` だけ。`contains` は完了の伝わる向きが逆（下から集約のみ）
 * なので、混ざった道では「外してもカスケードが同じ所へ届く」が成り立たない。
 * 輪の上のノードも見ない——輪の中ではどこからでも届くので、全部が近道に見える。
 * 輪は輪で「割る」信号が別に出ている。
 *
 * `added` は今回足した `requires`。**今回の追加で近道になったものだけ**を返し、
 * 前からあった近道は掘り返さない（聞いてもいない所を指摘し始めると、繋ぐたびに
 * 無関係な確認が出る）。
 */
export function findShortcuts(g: Graph, added: readonly { from: string; to: string }[]): Shortcut[] {
  const cyclic = cyclicNodes(g);
  const rev = buildReverseIndex(g);
  const out: Shortcut[] = [];
  const seen = new Set<string>();

  for (const { from: u, to: v } of added) {
    if (!g.nodes[u] || !g.nodes[v] || cyclic.has(u) || cyclic.has(v)) continue;
    if (!g.nodes[u]!.requires.includes(v)) continue; // 外で消えていた
    // 今回の線を通る道は「u の祖先（u を含む）」から「v の子孫（v を含む）」へ
    // 伸びる。その間に直接の線があれば近道。u -> v 自体も、別の子から v へ
    // 届いていれば近道（既にある道の上へ近道を足した場合）。
    const upper = walkRequires(u, (id) => rev.requiredBy.get(id) ?? [], cyclic);
    const lower = walkRequires(v, (id) => g.nodes[id]?.requires ?? [], cyclic);
    for (const a of upper) {
      for (const b of g.nodes[a]?.requires ?? []) {
        if (!lower.has(b)) continue;
        const key = JSON.stringify([a, b]);
        if (seen.has(key)) continue;
        const via = shortcutVia(g, a, b, cyclic);
        if (via === undefined) continue;
        seen.add(key);
        out.push({ from: a, to: b, via });
      }
    }
  }
  return out;
}

/**
 * `from -> to` が近道なら、別の道の最初の一歩（`from` の子）を返す。
 * 近道でなければ `undefined`。**書く直前の確かめ直しにも使う**——確認を
 * 出している間に外でファイルが変わると、もう近道ではないことがある。
 */
export function shortcutVia(
  g: Graph,
  from: string,
  to: string,
  cyclic: ReadonlySet<string> = cyclicNodes(g),
): string | undefined {
  const node = g.nodes[from];
  if (!node || !node.requires.includes(to) || cyclic.has(from) || cyclic.has(to)) return undefined;
  for (const c of node.requires) {
    if (c === to || cyclic.has(c) || !g.nodes[c]) continue;
    if (walkRequires(c, (id) => g.nodes[id]?.requires ?? [], cyclic).has(to)) return c;
  }
  return undefined;
}

/** `start` から `next` で辿れる所（自分を含む）。輪の上には入らない。 */
function walkRequires(
  start: string,
  next: (id: string) => readonly string[],
  cyclic: ReadonlySet<string>,
): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    for (const n of next(stack.pop()!)) {
      if (seen.has(n) || cyclic.has(n)) continue;
      seen.add(n);
      stack.push(n);
    }
  }
  return seen;
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
// 下にあるものの見通し
// ---------------------------------------------------------------------------

/** 自分を除いた子孫の達成率。
 *
 * `progress()` との違いは自分を数に入れないことだけ。ノードそのものの状態は
 * 色が言っているので、弧に混ぜると同じことを2つの入れ物で出すことになる。
 *
 * `requires` と `contains` の**両方**を辿る。分解のほとんどは `requires` なので、
 * `contains` だけ見るとほぼ全ノードで「下に何も無い」ことになる（移植元は
 * `contains` 限定で、それを持ち込んだまま1日走ったのが 2026-09-02 の棚卸しで
 * 出た穴）。 */
export function descendantProgress(g: Graph, nodeId: string): Progress {
  const members = collectMembers(g, nodeId).filter((id) => id !== nodeId);
  return {
    done: members.filter((id) => g.nodes[id]?.satisfied).length,
    total: members.length,
  };
}

/** 下にあるものの一覧（両エッジを全階層辿って平らにしたもの）の1行。
 *
 * **並ぶのは「自分も下を持つノード」だけ。末端は出さない。** これは飛び先の
 * メニューであってチェックリストではない——末端まで並べると実データで30行に
 * なり、ホバーで出すには重すぎた（末端も出す形を一度試して戻した。2026-09-02）。
 * 落とした役割は他が持っている: 配下で今やれるものは俯瞰、直下に何があるかは
 * グラフ本体、下がどれだけ片付いたかは印の弧。 */
export interface OutlineItem {
  id: string;
  /** 起点から何段下か。0 が直下の子。 */
  depth: number;
  /** 下が全部揃っているか。本体の `satisfied` をそのまま出すと、下が未完の
   *  まま親だけ立っている状態を「済み」と読ませてしまう。 */
  done: boolean;
  /** 既に上の行で展開済み（複数の親から参照されている合流点）。2度目以降は
   *  ぶら下がりを繰り返さないので、繰り返しだと行に出さないと「下が空の親」
   *  と見分けがつかない。 */
  repeat: boolean;
}

/**
 * 下にあるものを全階層辿って平らにした一覧。グラフ本体が直下1ホップしか描かない
 * ぶんを、ここで補う。
 *
 * **`requires` と `contains` の両方を辿る。** 移植元（Warframe 版）は `contains`
 * だけを見ていたが、Sirube の分解はほとんどが `requires` なので、そのままだと
 * 実データ16ノードのうち1つでしか開かない機能になっていた（2026-09-02 の
 * 棚卸しで発覚）。弧・俯瞰・状態導出はどれも両エッジを見ており、ここだけ
 * 守備範囲が違うのは移植の取り残しだった。
 *
 * **末端は並べない。** 辿るのは全部だが、行に積むのは自分も下を持つノードだけ
 * ——移植元と同じ挙動。あちらのコメントは「末端も含む（チェックリストとして
 * 読める）」と言っているが、実装は末端を落としており、**実装の方が後から
 * 出した答え**だった（末端も並べる形を一度試したら、実データで 12行 → 30行 に
 * 膨らんでホバーには重すぎた）。
 *
 * 合流点は最初に出てきた場所でだけ展開し、2度目以降は行だけ出して `repeat` を
 * 立てる。展開を繰り返すと、DAG では同じ枝が何度も生えて一覧が実際の作業量より
 * 膨らんで見える。
 */
export function descendantOutline(
  g: Graph,
  nodeId: string,
  depth = 0,
  seen: Set<string> = new Set(),
): OutlineItem[] {
  if (seen.has(nodeId)) return [];
  seen.add(nodeId);
  const node = g.nodes[nodeId];
  if (!node) return [];
  const out: OutlineItem[] = [];
  for (const childId of [...node.requires, ...node.contains]) {
    const child = g.nodes[childId];
    if (!child) continue;
    // 末端は行にしない。辿るのは続ける——末端の先に分岐点があることはないが、
    // ここで打ち切ると合流点の `seen` が正しく積み上がらない。
    if (child.requires.length + child.contains.length > 0) {
      const c = descendantProgress(g, childId);
      out.push({
        id: childId,
        depth,
        done: c.total > 0 && c.done === c.total,
        repeat: seen.has(childId),
      });
    }
    out.push(...descendantOutline(g, childId, depth + 1, seen));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 期限の伝播
// ---------------------------------------------------------------------------

export interface EffectiveDue {
  /** 実際に効いている期限（`YYYY-MM-DD`）。 */
  date: string;
  /** その期限を持っているノード。**自分の期限が効いているなら自分の id。** */
  from: string;
}

/** 伝える期限の書式。文字列の大小がそのまま日付の前後になる形だけを扱う。 */
const DUE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 期限を前提へ伝える（2026-09-14、MOC で「既存タスク管理に無い性質」として
 * 後回しにしていた芽）。**「引っ越しが3/31」なら、その前提の「家を見つける」も
 * 暗黙に3/31まで。** 下にあるものが上より後に終わっても、上は間に合わない。
 *
 * - **下へ伝える向きは `requires` と `contains` の両方。** どちらも「上が終わる
 *   には下が要る」ので、期限の意味では区別が無い（`resolveState` と同じ理由）
 * - 自分にも期限があるときは**早い方**が効く
 * - **達成済みは伝えないし、受け取らない。** 済んだものの期限は何も縛らない。
 *   達成済みの中継点も通さない——その下はもう上の期限のために急ぐものではない
 * - 書式が `YYYY-MM-DD` でない期限は伝えない（自分の表示にはそのまま残る）
 * - 輪があっても止まる
 *
 * **ファイルには書かない。** 状態と同じく、読むたびに導出する。書くと上の期限を
 * 動かしたときに下の全ファイルを書き直すことになり、手で書いた期限と区別も
 * つかなくなる。警告や催促もしない（期限の方針のまま）。
 *
 * 早い期限から順に下へ塗り、塗り済みのノードで止まる。先に塗った方が早いので、
 * 塗り済みの下は既にそれ以下の期限で塗られている——全体で O(ノード + エッジ)。
 */
export function effectiveDues(g: Graph): Map<string, EffectiveDue> {
  const out = new Map<string, EffectiveDue>();
  const sources = Object.values(g.nodes)
    .filter((n) => !n.satisfied && n.due !== undefined && DUE_FORMAT.test(n.due))
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.id.localeCompare(b.id));
  for (const src of sources) {
    if (out.has(src.id)) continue; // もっと早い期限が上から届いている
    const due: EffectiveDue = { date: src.due!, from: src.id };
    out.set(src.id, due);
    const stack = [src.id];
    while (stack.length > 0) {
      const node = g.nodes[stack.pop()!]!;
      for (const childId of [...node.requires, ...node.contains]) {
        const child = g.nodes[childId];
        if (!child || child.satisfied || out.has(childId)) continue;
        out.set(childId, due);
        stack.push(childId);
      }
    }
  }
  return out;
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
