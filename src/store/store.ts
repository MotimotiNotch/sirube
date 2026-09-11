// Markdown ノードストア。ファイル群 ⇄ メモリ上のグラフ。
//
// Warframe 版の `GraphStore` は1タップのトグルでも `graph.json` 全体を
// 読んで全体を書き戻していた。ここでは**変更されたノードのファイルだけ**を
// 書く。git diff が「誰がどのノードを完了したか」そのものになるのが狙い。

import {
  analyzeCycles,
  applyTogglePlan,
  applyUndo,
  buildReverseIndex,
  canUndo,
  captureUndo,
  planToggle,
  toggleSatisfied,
  type ReverseIndex,
  type TogglePlan,
  type ToggleUndo,
} from "../core/engine.ts";
import { parseBulkRequires, parseDsl, type DslParseResult } from "../core/dsl.ts";
import { newGraph, newNode, type Graph, type Node } from "../core/model.ts";
import { GOALS_DIR, renderMocs } from "../core/moc.ts";
import { applyPlan, normalizeForDuplicateCheck, planReconcile, type ReconcilePlan } from "../core/reconcile.ts";
import { isUlid, ulid } from "../core/ulid.ts";
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
    resolveReferences(graph, issues);
    await this.assignNumbers(graph, issues);
    return { graph, issues };
  }

  /**
   * 番号（`#12`）を揃える。無いノードには振り、重複していたら片方を振り直す。
   *
   * 番号は ULID と違って**ファイル名ではない**ので、2台の vault で同時に
   * ノードを作ると同じ番号が別のノードに付き、git から見れば別ファイルの中身が
   * 違うだけ＝素通りする。ULID を選んだ理由が「静かに壊れない」ことだったので、
   * 番号だけ静かに壊れる状態は残さない。
   *
   * **振り直すのは後から作られた方**（ULID が大きい方）。先に振られた番号は
   * 動かさない——番号の価値は「安定して同じものを指す」ことに尽き、既に口に
   * 出された番号が別物を指し始めるのが一番まずい。
   *
   * 既存 vault は初回の読み込みでその場で移行される（ULID 昇順に 1 から）。
   */
  private async assignNumbers(graph: Graph, issues: { id: string; problems: string[] }[]): Promise<void> {
    // ULID は時刻順に並ぶので、ソートがそのまま作成順になる。
    const ids = Object.keys(graph.nodes).sort();
    const taken = new Map<number, string>();
    const renumber: string[] = [];

    for (const id of ids) {
      const node = graph.nodes[id]!;
      if (node.number === undefined) continue;
      const owner = taken.get(node.number);
      if (owner === undefined) {
        taken.set(node.number, id);
        continue;
      }
      // 先勝ち。後から来た方を捨てて振り直す。
      issues.push({ id, problems: [`番号 #${node.number} が「${graph.nodes[owner]!.name}」と重複していたので振り直しました`] });
      node.number = undefined;
      renumber.push(id);
    }

    let next = taken.size === 0 ? 1 : Math.max(...taken.keys()) + 1;
    const assigned: string[] = [];
    for (const id of ids) {
      const node = graph.nodes[id]!;
      if (node.number !== undefined) continue;
      node.number = next;
      taken.set(next, id);
      next += 1;
      assigned.push(id);
    }
    if (assigned.length > 0) await this.persist(graph, assigned);
    void renumber; // 振り直しは assigned に含まれるので、ここでは記録だけ
  }

  /** 次に振る番号。既存の最大 + 1。 */
  private nextNumber(graph: Graph): number {
    let max = 0;
    for (const node of Object.values(graph.nodes)) {
      if (node.number !== undefined && node.number > max) max = node.number;
    }
    return max + 1;
  }

  /** 指定 id のノードだけ書き戻し、mtime をメモリ側にも反映する。 */
  async persist(graph: Graph, ids: readonly string[]): Promise<void> {
    const nameOf = (refId: string): string | undefined => graph.nodes[refId]?.name;
    for (const id of ids) {
      const node = graph.nodes[id];
      if (!node) continue;
      await this.fs.writeNode(id, serializeNodeFile(node, nameOf));
      node.mtimeMs = await this.fs.statNode(id);
    }
  }

  /** 名前を与えてノードを1つ起こす。id は採番する（呼び手は id を決めない）。 */
  async createNode(graph: Graph, name: string): Promise<Node> {
    return this.mint(graph, name);
  }

  /** 表示名を変える。ファイル名（id）は動かさない。
   *
   * id をファイル名に閉じ込めてあるので、改名は `name` の1行を書き換えるだけで
   * 済み、参照は id のままなので1本も切れない。**同名は作らせない**——名前で
   * 参照を解決する経路（DSL・まとめて追加）があり、同じ名前が2つあると
   * どちらにも繋がずに警告で止まる。改名でその状態を作れてしまうと、
   * 後からその2つを手で見分ける必要が出る。 */
  async renameNode(graph: Graph, id: string, name: string): Promise<void> {
    const node = graph.nodes[id];
    if (!node) throw new Error(`node "${id}" not found`);
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === node.name) return;
    const key = normalizeForDuplicateCheck(trimmed);
    const clash = Object.values(graph.nodes).find(
      (n) => n.id !== id && normalizeForDuplicateCheck(n.name) === key,
    );
    if (clash) throw new Error(`「${clash.name}」と同じ名前になります`);
    node.name = trimmed;
    await this.persist(graph, [id]);
  }

  /** 未使用の id を採って、ノードのファイルを排他作成する。
   *
   * ULID の衝突確率そのものは無視してよい（同一ミリ秒内でしか衝突しえず、
   * 同ミリ秒に n 個で約 n²/2^81）。ここで受け止めたいのは**乱数以外の経路**——
   * 乱数源が弱い／時計が巻き戻る／ファイルを手でコピーする——で、排他作成に
   * しておくとどれも同じ1箇所で弾ける。
   *
   * 5回で諦めるのは、そこまで連続で失敗するのは衝突ではなく乱数源か
   * ファイルシステムが壊れている証拠だから。黙って回り続けるより止まる。 */
  private async mint(graph: Graph, name: string): Promise<Node> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const id = ulid();
      if (graph.nodes[id]) continue; // メモリ上の重複。まず起きないが確認は安い
      // 番号はここで振る。作った瞬間から  で指せる。
      const node = { ...newNode(id), name, number: this.nextNumber(graph) };
      try {
        await this.fs.createNode(id, serializeNodeFile(node));
      } catch (err) {
        lastError = err;
        continue;
      }
      node.mtimeMs = await this.fs.statNode(id);
      graph.nodes[id] = node;
      return node;
    }
    const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`ノード id を ${MINT_ATTEMPTS} 回採番できませんでした${detail}`);
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
  /**
   * 親から子への繋がりだけを切る。**ノードは残す。**
   *
   * `A -> C` があるところへ `B` を挟んで `A -> B -> C` にしたいとき、追加だけ
   * では `A -> C` が残って併存する。**ストアに構造を変える操作が1つも無かった**
   * （のっち 2026-09-03。Warframe 版は `reparentNode` で解決済み）。
   *
   * 付け直す側は作らない。`requires` / `contains` に既存の名前を書けばそこへ
   * 繋がる入口が既に2つある（まとめて追加・前提を一括追加）ので、**外す側さえ
   * あれば往復する**。あちらが付け替えを1操作にまとめたのは、名前で繋ぐ入口が
   * 無かったからだと思われる。
   *
   * 戻ってくる値は「実際に切ったか」。無い繋がりを指定されても黙って何もしない
   * ——UI は逆引きから作った一覧を出しているので、そこにあるものしか渡らない。
   */
  async detachEdge(graph: Graph, parentId: string, childId: string): Promise<boolean> {
    const parent = graph.nodes[parentId];
    if (!parent) return false;
    const before = parent.requires.length + parent.contains.length;
    parent.requires = parent.requires.filter((id) => id !== childId);
    parent.contains = parent.contains.filter((id) => id !== childId);
    if (parent.requires.length + parent.contains.length === before) return false;
    await this.persist(graph, [parentId]);
    return true;
  }

  /**
   * `parent -> child` の**間に**新しいノードを差し込む。
   *
   * 追加と削除しか無いと、`A -> B` の間に `C` を入れるのに3手かかる——`C` を
   * 作って `A` に足し、`C` に `B` を足し、`A -> B` を外す。**エッジそのものを
   * 押して差し込む**のが素直だ、というのっちの指摘（2026-09-03）を受けて1手に
   * まとめる。
   *
   * 関係の種類は元のエッジを引き継ぐ。`A requires B` なら `A requires C` と
   * `C requires B` に、`contains` なら両方 `contains` に。**片方だけ種類を
   * 変えると、間に挟んだだけのつもりが意味の違う繋がりに化ける。**
   *
   * 並び順は `map` で置き換えて保つ。差し込んだものが末尾へ飛ぶと、元の並びを
   * 手掛かりに読んでいた側が迷子になる。
   */
  async insertBetween(
    graph: Graph,
    parentId: string,
    childId: string,
    name: string,
    kind: "requires" | "contains",
  ): Promise<Node> {
    const parent = graph.nodes[parentId];
    if (!parent) throw new Error(`node "${parentId}" not found`);
    if (!parent[kind].includes(childId)) throw new Error("その繋がりはもうありません");

    const trimmed = name.trim();
    if (trimmed === "") throw new Error("名前を入れてください");
    // 同名は作らせない（`renameNode` と同じ理由。名前で参照を解決する経路がある）。
    const key = normalizeForDuplicateCheck(trimmed);
    const clash = Object.values(graph.nodes).find((n) => normalizeForDuplicateCheck(n.name) === key);
    if (clash) throw new Error(`「${clash.name}」と同じ名前になります`);

    const node = await this.mint(graph, trimmed);
    parent[kind] = parent[kind].map((id) => (id === childId ? node.id : id));
    node[kind] = [childId];
    await this.persist(graph, [parentId, node.id]);
    return node;
  }

  /** 下見を挟まず一気にやる。**画面はこちらを使わない**（2026-09-10 以降、UI は
   *  `planToggle` → 確認 → `applyToggle` を通る）。台本や移行スクリプトのような
   *  「人が見ていない場所」から呼ぶための入口として残してある。 */
  async toggle(graph: Graph, id: string): Promise<string[]> {
    const rev = buildReverseIndex(graph);
    const changed = toggleSatisfied(graph, id, rev);
    await this.persist(graph, changed);
    return changed;
  }

  /** トグルの下見。ファイルには何も書かない（`applyToggle` で確定する）。 */
  planToggle(graph: Graph, id: string): TogglePlan {
    return planToggle(graph, id, buildReverseIndex(graph));
  }

  /** 下見を確定させる。書くのはここだけ。
   *
   *  **戻すための控えも一緒に返す**——控えは書き換える前のグラフからしか
   *  取れないので、呼び手に「先に控えを取る」を任せると、忘れた経路だけが
   *  静かに戻せなくなる。 */
  async applyToggle(graph: Graph, plan: TogglePlan): Promise<{ changed: string[]; undo: ToggleUndo }> {
    const undo = captureUndo(graph, plan);
    const changed = applyTogglePlan(graph, plan);
    await this.persist(graph, changed);
    return { changed, undo };
  }

  /** 直前のトグルを戻す。**カスケードは走らせない**——書いた値をそのまま
   *  巻き戻す（もう一度押すのとは結果が違う。`ToggleUndo` 参照）。
   *
   *  外で1件でも書き換わっていたら、何も書かずに空を返す。 */
  async undoToggle(graph: Graph, undo: ToggleUndo): Promise<string[]> {
    if (!canUndo(graph, undo)) return [];
    const changed = applyUndo(graph, undo);
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
    const { created, updated } = await this.mergeByName(graph, parsed.nodes);
    await this.persist(graph, [...created, ...updated]);
    return { created, updated, errors: [] };
  }

  /**
   * DSL が作った素のノード群を取り込む。DSL 上の「id」は人が書いた**名前**なので、
   * 既存ノードへは名前で突き合わせ、無いものだけ採番して起こす。
   *
   * 既存 id については `satisfied` / `note` / `due` を**必ず保持**し、
   * `requires` / `contains` は和集合を取る。DSL は構造を足すための記法であって、
   * 達成状態や書きかけのメモを上書きする道具ではない。
   */
  private async mergeByName(
    graph: Graph,
    incoming: readonly Node[],
  ): Promise<{ created: string[]; updated: string[] }> {
    const created: string[] = [];
    const updated: string[] = [];

    const byName = new Map<string, string>();
    for (const [id, node] of Object.entries(graph.nodes)) {
      const key = normalizeForDuplicateCheck(node.name);
      if (!byName.has(key)) byName.set(key, id); // 同名が複数あるときは先勝ち
    }

    // 1周目: 書かれた名前を実際の id に対応づける。必要なら採番する。
    const idOf = new Map<string, string>();
    for (const inc of incoming) {
      if (graph.nodes[inc.id]) {
        idOf.set(inc.id, inc.id); // 既存 id が直接書かれていた（一括追加の起点など）
        continue;
      }
      const existing = byName.get(normalizeForDuplicateCheck(inc.id));
      if (existing !== undefined) {
        idOf.set(inc.id, existing);
        continue;
      }
      const node = await this.mint(graph, inc.id);
      byName.set(normalizeForDuplicateCheck(inc.id), node.id);
      idOf.set(inc.id, node.id);
      created.push(node.id);
    }

    // 2周目: エッジを id に直して和集合を取る。
    const createdSet = new Set(created);
    for (const inc of incoming) {
      const target = graph.nodes[idOf.get(inc.id)!]!;
      const before = target.requires.length + target.contains.length;
      const map = (ref: string): string => idOf.get(ref) ?? ref;
      target.requires = [...new Set([...target.requires, ...inc.requires.map(map)])];
      target.contains = [...new Set([...target.contains, ...inc.contains.map(map)])];
      const changed = target.requires.length + target.contains.length !== before;
      if (changed && !createdSet.has(target.id) && !updated.includes(target.id)) updated.push(target.id);
    }
    return { created, updated };
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

/**
 * `requires` / `contains` に書かれた「名前」を id へ解決する。
 *
 * id が ULID になると `requires: [01J8X2...]` は人にもエージェントにも書けない。
 * かといってアプリ側に AI 連携を実装しない方針である以上、**Markdown を手で
 * 編集できる**という前提は壊せない。そこで読み側が両方受け付ける——既知の id は
 * そのまま、そうでなければ名前として引く。次にそのノードが保存されるとき id へ
 * 正規化されるので、書いた側は名前だけ知っていればいい。
 *
 * 照合は `normalizeForDuplicateCheck`（全角半角・空白・大小を潰す）を通す。
 * 手書きの参照は表記が揺れるのが普通で、揺れたぶんが全部リンク切れになると
 * 自動解決が空ノードを作り直してしまうため。
 *
 * 同じ名前が複数あるときは解決しない。どちらか一方に勝手に繋ぐと、間違った方に
 * 繋がったことが誰にも分からないまま残る。判断を人に返す。
 */
export function resolveReferences(graph: Graph, issues: { id: string; problems: string[] }[]): void {
  const byName = new Map<string, string[]>();
  for (const [id, node] of Object.entries(graph.nodes)) {
    const key = normalizeForDuplicateCheck(node.name);
    const arr = byName.get(key);
    if (arr) arr.push(id);
    else byName.set(key, [id]);
  }

  const addProblem = (id: string, problem: string): void => {
    const found = issues.find((i) => i.id === id);
    if (found) found.problems.push(problem);
    else issues.push({ id, problems: [problem] });
  };

  for (const [id, node] of Object.entries(graph.nodes)) {
    const resolve = (ref: string): string => {
      if (graph.nodes[ref]) return ref; // 既知の id が最優先
      const candidates = byName.get(normalizeForDuplicateCheck(ref)) ?? [];
      if (candidates.length === 1) return candidates[0]!;
      if (candidates.length > 1) {
        addProblem(id, `「${ref}」に一致するノードが ${candidates.length} 件あるため解決できません`);
      }
      return ref; // 見つからないものはそのまま（リンク切れとして自動解決が拾う）
    };
    node.requires = [...new Set(node.requires.map(resolve))];
    node.contains = [...new Set(node.contains.map(resolve))];
  }

  // ファイル名が id の形をしていないのに `name` が書かれているファイルは、
  // アプリが書いたファイルを手でコピーした跡である可能性が高い（コピーは
  // 中身の `name` を持ったまま、ファイル名だけ `... のコピー` になる）。
  // 移行前の vault は `name` を持たないので、ここには引っかからない。
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!isUlid(id) && node.name !== id) {
      addProblem(id, `ファイル名が id の形式ではありません（名前「${node.name}」が別に書かれています）`);
    }
  }
}

/** id の採番をあきらめるまでの回数。無限ループにはしない。 */
const MINT_ATTEMPTS = 5;

export interface BulkResult {
  created: string[];
  updated: string[];
  errors: { message: string; pos: number }[];
}

export type { ReverseIndex };
