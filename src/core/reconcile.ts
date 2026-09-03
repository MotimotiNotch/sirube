// 整合性の自動解決。
//
// これは AI 連携のための機能ではなく、Markdown + Git を選んだ時点で必要に
// なっていた要件。従来アプリの整合性は「入口が1つしかない」ことに乗っていた
// ——トグルが `satisfied` を反転すると同時にカスケードも走らせ、周りも一緒に
// 書き換えていただけで、検証も拒否もしていない。
//
// Markdown + Git + Obsidian で開ける、を選ぶと入口は増える:
//   - エディタ / Obsidian での直接編集
//   - エージェント（Claude Code 等）による nodes/*.md の書き換え
//   - git のマージ（アプリのコードを一切通らない）
//
// なので「入口を塞ぐ」のではなく「入口が何個あっても成立する形」にする。
// 黙って正規化するのではなく、**宣言して実行し、残りを報告する**:
//
//   「自動解決を実行します」→「N件解決しました。M件は判断が必要なため残しました」
//
// 解決規則は **mtime の新しい方を正**。「A=true / 前提 B=false」は論理的には
// 「B を埋め忘れた」「B を意図的に戻した」の2解釈があるが、ファイルには
// mtime があるので最新の意図が分かる。frontmatter の `updated` は使わない
// ——アプリ以外が書いたときに更新されず誤判定するため。

import { buildReverseIndex, findContainsCycles, findCycles } from "./engine.ts";
import { newNode, type Graph } from "./model.ts";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type Fix =
  | {
      kind: "satisfy-prerequisite";
      /** 達成済みのノード。こちらの方が新しい＝「終わった」が最新の意図。 */
      node: string;
      /** 未達成のまま取り残されていた前提。これを達成にする。 */
      prerequisite: string;
    }
  | {
      kind: "unsatisfy-node";
      /** 達成済みだったノード。前提の方が新しい＝「戻した」が最新の意図。 */
      node: string;
      prerequisite: string;
    }
  | {
      kind: "satisfy-contains-parent";
      /** contains の子が全部揃っているのに未達成だった親。 */
      parent: string;
    }
  | {
      kind: "create-missing-node";
      /** 参照されているのに実体が無かった id。 */
      id: string;
      referencedBy: string[];
    };

export type Unresolved =
  | { kind: "cycle"; nodes: string[] }
  | { kind: "near-duplicate"; ids: string[]; normalized: string }
  | { kind: "mtime-tie"; node: string; prerequisite: string }
  /** `contains` が輪になっている。`requires` の輪と違って**分解が足りない信号
   *  ではなく入力ミス**なので、直し方は「割る」ではなく「エッジを外す」。
   *  検出しないと理由の出ない `BLOCKED` として静かに詰まる。 */
  | { kind: "contains-cycle"; nodes: string[] }
  /** 規則どうしが逆を向いていて、達成／未達成を行ったり来たりするノード。
   *  自動では決められないので、提案せずに人へ返す。 */
  | { kind: "oscillating"; node: string };

export interface ReconcilePlan {
  fixes: Fix[];
  unresolved: Unresolved[];
}

// ---------------------------------------------------------------------------
// 計画
// ---------------------------------------------------------------------------

const MAX_PASSES = 50;

/**
 * この幅より近い変更時刻は「どちらが新しいか判断できない」として扱う。
 *
 * **完全一致では足りない。** ファイルは1件ずつ書かれるので、一括書き込み
 * （番号の移行 / `git clone` / `git pull` / AI のまとめ書き）でも**全ファイルが
 * 別々の mtime を持つ**。実測では 31ファイルすべてが異なり、最小差は 2ms
 * だった（2026-09-02、実 vault）。しかもその順序は書き込みループの順＝ULID 順で、
 * **人が触った順とは何の関係もない**。
 *
 * つまり完全一致だけを同着とすると、一括書き込みの直後は「もっともらしい嘘の
 * 順序」を最新の意図として読むことになる。倒れないのではなく、**でたらめな方向に
 * 倒れる**。
 *
 * 2秒の根拠: 実測した一括書き込みのかたまりは幅 6ms / 96ms / 411ms。人が手で
 * 2つのファイルを触る間隔がこれに収まることはまずないので、機械の一括書き込みと
 * 人の操作がきれいに分かれる。
 */
const MTIME_TOLERANCE_MS = 2000;

/**
 * 解決計画を立てる。グラフは変更しない（プレビュー用）。
 *
 * 実行前にプレビューを出すのは、少数派の「意図的に戻した」ケースが
 * 自動解決で黙って消えるため。一覧を見せれば人間が気づける。
 */
export function planReconcile(g: Graph): ReconcilePlan {
  const fixes: Fix[] = [];
  const unresolved: Unresolved[] = [];

  // satisfied だけを写した作業用の状態。元のグラフは触らない。
  const sat = new Map<string, boolean>();
  const mtime = new Map<string, number>();
  for (const [id, n] of Object.entries(g.nodes)) {
    sat.set(id, n.satisfied);
    mtime.set(id, n.mtimeMs);
  }

  // --- ① リンク切れ: 参照されているのに実体が無い id -----------------------
  const missing = new Map<string, string[]>();
  for (const [id, n] of Object.entries(g.nodes)) {
    for (const ref of [...n.requires, ...n.contains]) {
      if (g.nodes[ref]) continue;
      const arr = missing.get(ref);
      if (arr) arr.push(id);
      else missing.set(ref, [id]);
    }
  }
  for (const [id, referencedBy] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    fixes.push({ kind: "create-missing-node", id, referencedBy: referencedBy.sort() });
    // 作られるノードは未達成・mtime 0（＝常に「古い」）として以降の判定に混ぜる。
    sat.set(id, false);
    mtime.set(id, 0);
  }

  // --- ② 循環は自動解決しない（時刻では切れない） --------------------------
  const cycles = findCycles(g);
  const cyclic = new Set<string>();
  for (const c of cycles) {
    unresolved.push({ kind: "cycle", nodes: c });
    for (const id of c) cyclic.add(id);
  }

  // --- ②b `contains` の輪 -------------------------------------------------
  for (const c of findContainsCycles(g)) {
    unresolved.push({ kind: "contains-cycle", nodes: c });
  }

  // --- ③ requires 矛盾と contains 親を、安定するまで繰り返し解決 ------------
  const requiresOf = (id: string): string[] => g.nodes[id]?.requires ?? [];
  const containsOf = (id: string): string[] => g.nodes[id]?.contains ?? [];
  const rev = buildReverseIndex(g);
  const tieSeen = new Set<string>();

  /**
   * 作業用の状態を1つ変える。**同じノードが2度目の反転をしようとしたら止める。**
   *
   * 2度目の反転は「元の値へ戻ろうとしている」＝規則どうしが逆を向いている、
   * ということなので、そのまま回すと同じ提案が交互に積み上がる（実際に、
   * 1つのノードについて「親を達成に」と「達成を戻す」が49組・99件並んだ
   * プランが出た。2026-09-02）。収束しないものは提案せず、判断が必要な
   * ものとして人に返す——輪や mtime 同着と同じ扱い。
   */
  const flips = new Map<string, number>();
  const frozen = new Set<string>();
  const setSat = (id: string, value: boolean): boolean => {
    if (frozen.has(id)) return false;
    if (sat.get(id) === value) return false;
    const n = (flips.get(id) ?? 0) + 1;
    if (n > 1) {
      frozen.add(id);
      unresolved.push({ kind: "oscillating", node: id });
      return false;
    }
    flips.set(id, n);
    sat.set(id, value);
    return true;
  };

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false;

    // 変更時刻の新しいノードから順に処理する。最新の意図を先に確定させ、
    // それに矛盾する古い方を合わせる。順序が一意に決まるので結果が安定する。
    const order = [...sat.keys()].sort((a, b) => (mtime.get(b) ?? 0) - (mtime.get(a) ?? 0) || a.localeCompare(b));

    for (const id of order) {
      if (!sat.get(id)) continue;
      // 循環上のノードは触らない。輪の中で辻褄を合わせても意味がない。
      if (cyclic.has(id)) continue;

      for (const req of requiresOf(id)) {
        if (sat.get(req)) continue;
        if (cyclic.has(req)) continue;

        const mNode = mtime.get(id) ?? 0;
        const mReq = mtime.get(req) ?? 0;

        const apart = mNode - mReq;

        if (Math.abs(apart) < MTIME_TOLERANCE_MS) {
          // 近すぎて判断できない。一括書き込みの直後がこれ（`git clone` /
          // `git pull` / 番号の移行 / AI のまとめ書き）。区切りは NUL。ノード id
          // はファイル名由来で任意の文字を含みうるため、通常の区切り文字だと
          // 別の組が同じキーに潰れる。ソースには生バイトではなくエスケープで書く
          // （生の NUL があると grep や差分がバイナリ扱いになる）。
          const key = `${id}\u0000${req}`;
          if (!tieSeen.has(key)) {
            tieSeen.add(key);
            unresolved.push({ kind: "mtime-tie", node: id, prerequisite: req });
          }
        } else if (apart > 0) {
          // このノードの方が新しい ＝「終わった」が最新の意図 → 前提を埋める
          if (setSat(req, true)) {
            fixes.push({ kind: "satisfy-prerequisite", node: id, prerequisite: req });
            changed = true;
          }
        } else {
          // 前提の方が新しい ＝「戻した」が最新の意図 → こちらを未達成に戻す
          if (setSat(id, false)) {
            fixes.push({ kind: "unsatisfy-node", node: id, prerequisite: req });
            changed = true;
          }
          break; // このノードはもう達成ではないので、残りの前提は見なくてよい
        }
      }
    }

    // contains の子が全部揃った親を達成にする。直し方が一方向しかないので
    // 時刻を見る必要がない（contains は逆カスケードしない仕様）。
    //
    // **前提も見る。** `contains` だけで判断すると、未達の `requires` を持つ親を
    // 立ててしまい、①（前提の方が新しければ戻す）と逆を向いて振動する。
    // カスケード側（`cascadeSatisfyContainsParents`）と同じ条件でなければ、
    // 自動解決とアプリの操作が別のことを言い始める。
    for (const [parentId] of Object.entries(g.nodes)) {
      if (sat.get(parentId)) continue;
      if (cyclic.has(parentId)) continue;
      const children = containsOf(parentId);
      if (children.length === 0) continue;
      if (!children.every((c) => sat.get(c))) continue;
      if (!requiresOf(parentId).every((r) => sat.get(r))) continue;
      if (setSat(parentId, true)) {
        fixes.push({ kind: "satisfy-contains-parent", parent: parentId });
        changed = true;
      }
    }

    if (!changed) break;
  }
  void rev;

  // --- ④ 表記ゆれの重複（統合の可否は人間） --------------------------------
  const byNormalized = new Map<string, string[]>();
  for (const id of Object.keys(g.nodes)) {
    const key = normalizeForDuplicateCheck(id);
    const arr = byNormalized.get(key);
    if (arr) arr.push(id);
    else byNormalized.set(key, [id]);
  }
  for (const [normalized, ids] of byNormalized) {
    if (ids.length > 1) unresolved.push({ kind: "near-duplicate", ids: ids.sort(), normalized });
  }

  return { fixes, unresolved };
}

/** 全角半角・空白・大小の違いを潰して比較するためのキー。
 * `ＣＩ／ＣＤ` と `CI/CD`、`手順書 作成` と `手順書作成` を同一視する。 */
export function normalizeForDuplicateCheck(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// 適用
// ---------------------------------------------------------------------------

/** 計画をグラフへ適用し、内容が変わったノード id を返す（ストアが差分だけ書く）。 */
export function applyPlan(g: Graph, plan: ReconcilePlan): string[] {
  const changed = new Set<string>();
  for (const fix of plan.fixes) {
    switch (fix.kind) {
      case "create-missing-node": {
        if (!g.nodes[fix.id]) {
          g.nodes[fix.id] = newNode(fix.id, 0);
          changed.add(fix.id);
        }
        break;
      }
      case "satisfy-prerequisite": {
        const n = g.nodes[fix.prerequisite];
        if (n && !n.satisfied) {
          n.satisfied = true;
          changed.add(fix.prerequisite);
        }
        break;
      }
      case "unsatisfy-node": {
        const n = g.nodes[fix.node];
        if (n && n.satisfied) {
          n.satisfied = false;
          changed.add(fix.node);
        }
        break;
      }
      case "satisfy-contains-parent": {
        const n = g.nodes[fix.parent];
        if (n && !n.satisfied) {
          n.satisfied = true;
          changed.add(fix.parent);
        }
        break;
      }
    }
  }
  return [...changed];
}

/** 人に見せる1行サマリ。「N件解決しました。M件は判断が必要なため残しました」 */
export function summarize(plan: ReconcilePlan): string {
  if (plan.fixes.length === 0 && plan.unresolved.length === 0) return "不整合はありませんでした。";
  const parts: string[] = [];
  if (plan.fixes.length > 0) parts.push(`${plan.fixes.length}件を自動解決しました`);
  if (plan.unresolved.length > 0) parts.push(`${plan.unresolved.length}件は判断が必要なため残しました`);
  return `${parts.join("。")}。`;
}
