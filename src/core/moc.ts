// 生成される入口ファイル（MOC 3層）。
//
// きっかけは「Obsidian はフォルダごとに MOC があって人もAIも辿れるが、
// `nodes/` がフラットだと網羅になる」という指摘。フォルダは採らない——
// 1ノードが複数の目的の下にいる（合流点）のがこのモデルのウリで、フォルダは
// 1ファイル1箇所にしか置けないため構造が嘘になる。タグを却下したのと同じ
// 「二重表現」の理屈で、タグより悪い（タグは複数付くがフォルダは排他）。
//
// 代わりに MOC を**生成物**として置く。生成物なら同じノードを複数の目的の
// 下に重複掲載できる。フォルダの制約がそのまま利点に裏返る。
//
// 守るべき条件は2つだけ:
//   - 生成のたびに全部書き直す
//   - **アプリは二度と読み返さない**（読み返した瞬間に第二の真実になる）
// これを守る限り、3層とも消して構わない。次の起動で作り直される。

import {
  collectMembers,
  effectiveDues,
  inDegree,
  progress,
  resolveState,
  type CycleInfo,
  type ReverseIndex,
} from "./engine.ts";
import { betweenKey, goalLayer, goalRoots, type GoalLayer } from "./goals.ts";
import { AGENTS_DOC } from "./agents-doc.ts";
import type { Graph, NodeState } from "./model.ts";

export interface GeneratedDoc {
  /** vault ルートからの相対パス。`nodes/` の外にしか書かない。 */
  path: string;
  content: string;
}

export const INDEX_DOC = "00_Sirube_MOC.md";
/** エージェント向けの仕様書。**vault にも置く。**
 *
 * リポジトリの `AGENTS.md` にしか無いと、インストーラで入れた人の手元には
 * 存在しない——「AI と同じ場で進める」を売りにしておきながら、開発者以外は
 * 仕様書を受け取れない状態だった（2026-09-02 に他人の環境を洗って発覚）。
 *
 * データと同じフォルダに置くので、**git で別マシンへ持っていっても、vault
 * だけ渡しても付いてくる**。アプリのバージョンと必ず一致するので、仕様書だけ
 * 古いという事故も起きない。 */
export const AGENTS_DOC_PATH = "AGENTS.md";
export const DONE_DOC = "90_達成済み.md";
export const GOALS_DIR = "goals";

/** 層1に並べる「今やれること」の件数。残りは件数だけ添える。 */
const TOP_IN_INDEX = 3;
/** 層2に並べる「今やれること」の件数。
 *
 * 子孫を全列挙すると N=2000 で 29KB になり、結局また網羅に戻る。上限を
 * 切って「ほか N 件」に畳むことで、目的が何ノードに育ってもサイズが
 * 頭打ちになる。 */
const TOP_IN_GOAL = 20;

/** `AGENTS.md` 用の断り書き。他の生成物と文面を変える——あちらは「真実は
 *  `nodes/` にある」だが、こちらの正はアプリのリポジトリにある。 */
const AGENTS_BANNER =
  "> このファイルは Sirube が自動生成します（アプリのバージョンに追随します）。\n" +
  "> **編集しても次の保存で上書きされます。** 消しても構いません。";

const BANNER =
  "> このファイルは Sirube が自動生成します。**編集しても次の保存で上書きされます。**\n" +
  "> 消しても構いません（次に起動したとき作り直されます）。真実は `nodes/` 側だけにあります。";

const STATE_LABEL: Record<NodeState, string> = {
  SATISFIED: "達成",
  ACTIONABLE: "今やれる",
  BLOCKED: "前提待ち",
  CYCLIC: "割れ",
};

/** Obsidian のウィキリンク。id と表示名が違うときだけエイリアス記法にする。
 *
 * 今は id ＝ ファイル名 ＝ 表示名なので `[[確定申告]]` になるが、id を ULID へ
 * 分離したあとはここが自動的に `[[01J8X...|確定申告]]` に変わる。分離のとき
 * MOC 側を書き直さずに済ませるための一手間。 */
function link(id: string, name: string): string {
  return id === name ? `[[${id}]]` : `[[${id}|${name}]]`;
}

function nodeLink(g: Graph, id: string): string {
  return link(id, g.nodes[id]?.name ?? id);
}

/** `#12 ` の接頭辞。Obsidian で開いたときも同じ札で指せるようにする。
 *
 * `#12` をそのまま書くと Obsidian がタグとして拾ってしまう（`#` ＋ 数字）。
 * バッククォートで囲んでタグ化を防ぐ。 */
function numberPrefix(g: Graph, id: string): string {
  const n = g.nodes[id]?.number;
  return n === undefined ? "" : `\`#${n}\` `;
}

/** 自分を含まない子孫。`collectMembers` は自分を含むので落とす。 */
function descendants(g: Graph, id: string): string[] {
  return collectMembers(g, id).filter((x) => x !== id);
}

/** 配下（自分を含む）で一番新しい更新時刻。
 *
 * 目的の並び順に使う。**二値の「アクティブ／非アクティブ」にはしない**——
 * 最終更新で切ると、半年ぶりに開いた瞬間に全目的が非アクティブになって
 * 入口が空になる。「半年空けても道は残っている」が売り文句のこの道具では、
 * それが最悪の失敗の仕方。隠さずに順番だけ変える。 */
export function lastTouched(g: Graph, id: string): number {
  let max = 0;
  for (const memberId of collectMembers(g, id)) {
    const t = g.nodes[memberId]?.mtimeMs ?? 0;
    if (t > max) max = t;
  }
  return max;
}

/** 配下の「今やれること」。合流点（入次数が大きい＝片付けると複数の目的が進む）順。 */
function actionableUnder(g: Graph, rootId: string, rev: ReverseIndex, cyclic: ReadonlySet<string>): string[] {
  return descendants(g, rootId)
    .filter((id) => resolveState(g, id, cyclic) === "ACTIONABLE")
    .sort((a, b) => inDegree(b, rev) - inDegree(a, rev) || a.localeCompare(b));
}

/** 目的名から層2のファイル名を作る。
 *
 * **通す文字を並べる（ホワイトリスト）。** 危ない文字を並べる形にしていた時期が
 * あるが、`[` `]` と半角スペースが漏れていた——前者は Obsidian のリンクを
 * `[[Sirube [WIP] の道|…]]` にして壊し、後者は AI がシェル経由で触るときに
 * クォートを1回落とすだけで壊れる。危ない文字を数え上げる側は必ず漏れる。
 *
 * `.` と `+` は通す（`リリース: v1.0` や `C++ に移植` が読める形で残る）。
 * ここは表示用のファイル名であって id ではないため、潰した結果が衝突しても
 * 連番で避ければ足りる。大小を無視して突き合わせるのは、ファイルシステムが
 * `Ruv` と `ruv` を同じものとして扱うため。
 *
 * **`_の道` のような印は付けない。** 生成物であることは既に2つが言っている——
 * `goals/` フォルダに置くのは生成物だけ（テストで固定）で、なにより
 * **`nodes/` のファイル名は全部 ULID なので、名前が読めるファイルは生成物しか
 * 無い**（のっち 2026-09-03）。名前の末尾でもう一度言うと、助詞だけが単語として
 * 浮いた `Sirube_をリリースする_の道` になり、開くたびに読まされる。 */
function goalFileName(name: string, taken: Set<string>): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N}_.+-]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|[_.]+$/g, "");
  const base = cleaned === "" ? "goal" : cleaned;
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${base}_${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** 「今やれることが無い」ときの理由。
 *
 * 半年ぶりに開いて空だったとき、それが「全部終わっている」のか「輪で
 * 詰まっている」のか分からないのが、この道具にとって一番まずい失敗の
 * 仕方。空欄のまま返さない。 */
function stuckReason(g: Graph, rootId: string, cycles: CycleInfo): string {
  const members = descendants(g, rootId);
  const onCycle = members.filter((id) => cycles.cyclic.has(id));
  if (onCycle.length > 0) {
    const involved = cycles.cycles
      .filter((cycle) => cycle.some((id) => onCycle.includes(id)))
      .map((cycle) => cycle.map((id) => nodeLink(g, id)).join("・"))
      .join("／");
    return `待ち合って一周しています（${involved}）。1つの名前に2つのものが混ざっているサインなので、割ると要求の向きが揃ってほどけます。`;
  }
  if (members.length > 0 && members.every((id) => g.nodes[id]?.satisfied)) {
    return "必要なものは全部揃っています。この目的そのものを達成にできます。";
  }
  if (members.length === 0) {
    return "まだ分解されていません。「これには何が必要か」を書き下すと、末端に今日できることが現れます。";
  }
  return "前提が全部ふさがっています。分解が足りないか、依存の向きが間違っている可能性があります。";
}

/** 期限の添え書き。**アプリと同じく上から伝わった期限も出す**（`effectiveDues`）
 *  ——入口ファイルとアプリで期限の答えが違うと、どちらを信じるかの判断が要る。
 *  1行ごとに全体を塗り直すが、生成は保存のたびに1回で、ノード数も数百に届かない。 */
function dueSuffix(g: Graph, id: string): string {
  const eff = effectiveDues(g).get(id);
  if (eff && eff.from !== id) return `（期限 ${eff.date}、${g.nodes[eff.from]?.name ?? eff.from} から）`;
  const due = eff?.date ?? g.nodes[id]?.due;
  return due === undefined || due === "" ? "" : `（期限 ${due}）`;
}

// ---------------------------------------------------------------------------
// 層1: 進行中の目的
// ---------------------------------------------------------------------------

function renderIndex(
  g: Graph,
  rev: ReverseIndex,
  cycles: CycleInfo,
  layer: GoalLayer,
  goalFiles: ReadonlyMap<string, string>,
  doneCount: number,
): string {
  const out: string[] = [BANNER, "", "# Sirube", ""];
  const totalActionable = Object.keys(g.nodes).filter(
    (id) => resolveState(g, id, cycles.cyclic) === "ACTIONABLE",
  ).length;
  out.push(`ゴール ${layer.ids.length} 件 ／ 今やれること ${totalActionable} 件`, "");

  if (layer.ids.length === 0) {
    out.push("まだゴールがありません。", "");
    return out.join("\n");
  }

  // 地図。**ゴールだけを浮上させ、間のノードは件数に畳む**（2026-09-11）。
  //
  // 目的を1つに畳んだ実データで、入口が1行になった。かといって全ノードを
  // 並べれば網羅に戻る。ここが出すのは「ゴールからゴールへ、間に他のゴールを
  // 挟まない道」だけで、畳んだ数は行に残す。アプリの地図と同じ導出を使うので、
  // 画面と入口ファイルが食い違わない。
  out.push("## 地図", "");
  const seen = new Set<string>();
  const walk = (id: string, depth: number, hidden: number): void => {
    const indent = "  ".repeat(depth);
    const file = goalFiles.get(id);
    const name = g.nodes[id]?.name ?? id;
    // 行のリンク先は**ノードではなく、そのゴールの道**（層2）。地図は縮尺の
    // 一番上なので、押した先が1ノードのファイルだと降り口として狭すぎる。
    // ノード本体は道の中に「この目的そのもの」として置いてある。
    const label = file === undefined ? nodeLink(g, id) : link(file, name);
    const via = hidden > 0 ? `（間に ${hidden} 件）` : "";
    if (seen.has(id)) {
      // 合流点は2度目以降を畳む。展開すると同じ枝が何度も並び、地図が
      // 「どこかで見た行」で埋まる。合流していること自体は行に残す。
      out.push(`${indent}- ${numberPrefix(g, id)}${label}${via} — 上に既出`);
      return;
    }
    seen.add(id);
    const p = progress(g, id);
    const act = actionableUnder(g, id, rev, cycles.cyclic).length;
    const state = STATE_LABEL[resolveState(g, id, cycles.cyclic)];
    out.push(
      `${indent}- ${numberPrefix(g, id)}${label}${via} — ${state}｜進捗 ${p.done}/${p.total}｜今やれること ${act}${dueSuffix(g, id)}`,
    );
    for (const child of layer.graph.nodes[id]?.requires ?? []) {
      walk(child, depth + 1, layer.between.get(betweenKey(id, child)) ?? 0);
    }
  };
  const mapRoots = goalRoots(layer).sort((a, b) => lastTouched(g, b) - lastTouched(g, a) || a.localeCompare(b));
  for (const id of mapRoots) walk(id, 0, 0);
  // 輪の中にいて、どの根からも辿り着けないゴール。**落とさない**——
  // 地図から消えると、詰まっているものほど見えなくなる。
  const stranded = layer.ids.filter((id) => !seen.has(id));
  if (stranded.length > 0) {
    out.push("", "どの根からも辿り着けないゴール（待ち合いの中にいます）:", "");
    for (const id of stranded) walk(id, 0, 0);
  }
  out.push("");

  // 名前で「今やれること」を出すのは一番上のゴール1つだけ。地図は行数が増える
  // ので、ここで全ゴールぶん並べると結局また網羅に戻る（残りは各ゴールの道へ）。
  const head = mapRoots[0];
  if (head !== undefined) {
    const act = actionableUnder(g, head, rev, cycles.cyclic);
    out.push(`## ${nodeLink(g, head)} の今やれること`, "");
    if (act.length === 0) {
      out.push(stuckReason(g, head, cycles), "");
    } else {
      const names = act.slice(0, TOP_IN_INDEX).map((x) => nodeLink(g, x)).join(" ／ ");
      const rest = act.length - TOP_IN_INDEX;
      out.push(`${names}${rest > 0 ? ` ほか ${rest} 件` : ""}`, "");
    }
  }

  if (cycles.cycles.length > 0) {
    out.push("## 割れているもの", "");
    out.push("待ち合って一周している＝1つの名前に2つのものが混ざっているサインです。割ると要求の向きが揃ってほどけます。", "");
    for (const cycle of cycles.cycles) out.push(`- ${cycle.map((x) => nodeLink(g, x)).join(" ⟷ ")}`);
    out.push("");
  }

  if (doneCount > 0) out.push(`[[${DONE_DOC.replace(/\.md$/, "")}|達成した目的 ${doneCount} 件]]`, "");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 層2: 目的ごと
// ---------------------------------------------------------------------------

function renderGoal(g: Graph, rev: ReverseIndex, cycles: CycleInfo, id: string): string {
  const node = g.nodes[id]!;
  const p = progress(g, id);
  const act = actionableUnder(g, id, rev, cycles.cyclic);
  const out: string[] = [
    BANNER,
    "",
    `# ${node.name} の道`,
    "",
    `[[${INDEX_DOC.replace(/\.md$/, "")}|← すべての目的]]`,
    "",
    `進捗 ${p.done}/${p.total} ／ 今やれること ${act.length} 件${dueSuffix(g, id)}`,
    "",
    `この目的そのもの: ${nodeLink(g, id)}`,
    "",
    "## これには何が必要か",
    "",
  ];

  // 直下の子だけを出す。子孫を全部並べると結局また網羅になるので、
  // ここから先は各ノードのファイルへ降りてもらう。
  const direct = [
    ...node.requires.map((childId) => ({ id: childId, kind: "前提" })),
    ...node.contains.map((childId) => ({ id: childId, kind: "構成" })),
  ];
  if (direct.length === 0) {
    out.push("直下の分解がまだありません。ここを分解すると、末端に今日できることが現れます。", "");
  } else {
    for (const d of direct) {
      const state = STATE_LABEL[resolveState(g, d.id, cycles.cyclic)];
      const sub = progress(g, d.id);
      const tail = sub.total > 1 ? ` — ${sub.done}/${sub.total}` : "";
      out.push(`- ${d.kind}｜${state}｜${numberPrefix(g, d.id)}${nodeLink(g, d.id)}${tail}${dueSuffix(g, d.id)}`);
    }
    out.push("");
  }

  out.push("## 今やれること", "");
  if (act.length === 0) {
    out.push(stuckReason(g, id, cycles), "");
  } else {
    for (const x of act.slice(0, TOP_IN_GOAL)) {
      const deg = inDegree(x, rev);
      const note = deg > 1 ? `（${deg} 箇所から要求されている）` : "";
      out.push(`- ${numberPrefix(g, x)}${nodeLink(g, x)}${note}${dueSuffix(g, x)}`);
    }
    const rest = act.length - TOP_IN_GOAL;
    if (rest > 0) out.push(`- ほか ${rest} 件`);
    out.push("");
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 層3: 達成した目的
// ---------------------------------------------------------------------------

function renderDone(g: Graph, done: readonly string[]): string {
  const out: string[] = [BANNER, "", "# 達成した目的", ""];
  if (done.length === 0) {
    out.push("まだありません。", "");
    return out.join("\n");
  }
  out.push(
    `${done.length} 件。**ノードは移動していません**——\`nodes/\` は常にフラットで、`,
    "これは達成済みの目的を集めただけの一覧です。",
    "",
    "戻したいときは、そのノードの `satisfied` を `false` に書き換えてください。次の生成で進行中に戻ります。",
    "",
  );
  for (const id of done) {
    const p = progress(g, id);
    out.push(`- ${nodeLink(g, id)} — ${p.done}/${p.total}`);
  }
  out.push("");
  return out.join("\n");
}

// ---------------------------------------------------------------------------

/** 3層すべてを組み立てる。ファイルには書かない（書くのはストアの仕事）。 */
export function renderMocs(g: Graph, rev: ReverseIndex, cycles: CycleInfo): GeneratedDoc[] {
  const layer = goalLayer(g, rev);
  const done = layer.ids.filter((id) => g.nodes[id]!.satisfied);
  // **道は達成済みのゴールにも作る。** 地図には達成したゴールも載る（間にいると
  // 鎖が切れるため）ので、リンク先の無い行があってはいけない。
  const ordered = [...layer.ids].sort((a, b) => lastTouched(g, b) - lastTouched(g, a) || a.localeCompare(b));

  const taken = new Set<string>();
  const goalFiles = new Map<string, string>();
  for (const id of ordered) goalFiles.set(id, goalFileName(g.nodes[id]!.name, taken));

  const docs: GeneratedDoc[] = [
    { path: INDEX_DOC, content: renderIndex(g, rev, cycles, layer, goalFiles, done.length) },
    { path: DONE_DOC, content: renderDone(g, done) },
    { path: AGENTS_DOC_PATH, content: `${AGENTS_BANNER}\n\n${AGENTS_DOC}` },
  ];
  for (const id of ordered) {
    docs.push({ path: `${GOALS_DIR}/${goalFiles.get(id)!}.md`, content: renderGoal(g, rev, cycles, id) });
  }
  return docs;
}
