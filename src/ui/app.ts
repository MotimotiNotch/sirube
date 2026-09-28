// アプリ本体の配線。
//
// サーバは無い。ストアもエンジンもここ（フロント）で動き、ファイルアクセスだけ
// `SirubeFs` の実装を差し替える（開発中はメモリ、Tauri ではプラグイン fs）。

import { analyzeCycles, buildReverseIndex, canUndo, findShortcuts, hasChildren, inDegree, progress, resolveState, type CycleInfo, type ReverseIndex, type TogglePlan, type ToggleUndo } from "../core/engine.ts";
import { isGoalColor, type GoalColor, type Graph } from "../core/model.ts";
import { enclosingGoal, goalLayer, isGoal, mapSeeds, type GoalLayer } from "../core/goals.ts";
import { parseDsl } from "../core/dsl.ts";
import { normalizeForDuplicateCheck, planReconcile, summarize, type ReconcilePlan } from "../core/reconcile.ts";
import {
  countActionable,
  nextActions,
  pathFromRoot,
  recentlyChanged,
  search,
  sortRecentHits,
  type RecentSort,
} from "../core/search.ts";
import type { SirubeFs } from "../store/fs.ts";
import { canUndoStructure, MarkdownGraphStore, type StructureUndo } from "../store/store.ts";
import { clear, el, h, iconSpan, stateDot, toast } from "./dom.ts";
import { createTutorial, readTourDone, type Tutorial } from "./tutorial.ts";
import { hideFlyout } from "./flyout.ts";
import { closeContextMenu, openContextMenu, type MenuItem, type MenuTarget } from "./context-menu.ts";
import { renderGraph } from "./graph-view.ts";
import { resetViewport } from "./graph-viewport.ts";
import { renderInspector } from "./inspector.ts";
import { renderList } from "./list-view.ts";

interface AppState {
  graph: Graph;
  rev: ReverseIndex;
  /** 循環の解析（成分＋集合）。描画のたびに Tarjan を回さないよう、
   *  ここで1つ持って検索・グラフ・インスペクタへ配る。 */
  cycles: CycleInfo;
  mode: "list" | "graph";
  /** グラフを「ゴールだけの地図」で描くか（2026-09-11）。
   *
   * 画面を4つ目に増やさず、Chain View の**縮尺**として持つ。引くと非ゴールが
   * 消えてゴールだけが残り、寄ると元のグラフに戻る。一覧（俯瞰）ではなく
   * グラフ側に置いたのは、地図がノードと線でできているため——語彙（印・状態色・
   * 弧・パンくず）をそのまま使い回せる。 */
  layer: "detail" | "goals";
  /** ゴール層の商グラフ。**描画専用**（`core/goals.ts` の警告を参照）。
   *  毎描画で組み直さない——全ゴールから幅優先で下るので `recompute` で1回。 */
  goals: GoalLayer;
  focusId?: string;
  selectedId?: string;
  query: string;
  /** ドリルダウンの経路。パンくずと「戻る」に使う。 */
  trail: string[];
  /** 読み込み時に拾ったファイルの問題（壊れた YAML・読めないファイル・番号の重複）。
   *
   * 以前はトーストで件数だけ出していたが、3.2秒で消えるので**起動直後に見て
   * いなければ気づけず、中身も分からなかった**。自動解決の「判断が必要」へ
   * 流す（2026-09-02）。 */
  issues: { id: string; problems: string[] }[];
  /** 整合性の計画。**バッジのために毎描画で組み直さない**——グラフ全体を舐める
   *  ので、状態が変わったときだけ（`recompute`）作り直して持ち回る。 */
  plan: ReconcilePlan;
  /** 一覧をこのノードの配下だけに絞る（目的の「俯瞰」）。
   *
   * 一覧は俯瞰モードであって潜る画面ではない（2026-09-02 のっち）。だから
   * 目的の入口はこれまでどおり Chain View のままで、俯瞰はそこから切り替える
   * ——入口を差し替えると、分解しに行く導線が1クリック遠くなる。 */
  scopeId?: string;
  /** 一覧を「最近の変更」で出すか（2026-09-14）。検索語があれば検索が勝ち、
   *  俯瞰（`scopeId`）とは同時に立たない。「今やれること」と同じ1画面の別の顔。 */
  recent: boolean;
  /** 「最近の変更」をどの列で並べているか。**保存しない**——開き直したら新しい順に
   *  戻る。前回の続きとして復元するのは「どこを見ていたか」で、道具立てではない
   *  （検索語を保存しないのと同じ理由）。 */
  recentSort: RecentSort;
  /** 右パネルの開閉。**ノードごとに持たない**——選び直すたびに畳み直すと、
   *  続けて同じ操作をするときに毎回開くことになる。メモの編集モードだけは
   *  選び直しで閉じる（別のノードを開いたのに書く顔のままだと、どれを書いて
   *  いるのか分からなくなる）。 */
  insp: { moreOpen: boolean; noteEditing: boolean };
  /** 地図に上がる前に居た場所。**「グラフ」で戻る先**（2026-09-12）。
   *
   * 上がって眺めただけなら、降りたときに同じ場所に戻す——入口と出口が違うと
   * 往復にならない（実データで66ノード中54、平均2.4段ぶん上がった所へ降りていた）。
   * 地図でゴールを選んだらそちらが勝つ。**選ぶのは「降りる先を決める」操作**で、
   * それを無視して元の場所へ戻すと、選んだ意味が消える。
   *
   * 保存はしない（localStorage へ入れない）。アプリを閉じて開き直すのは往復では
   * ないので、そのときは地図に居た場所から普通に降りればいい。 */
  mapReturn?: MapReturn;
}

/** 地図へ上がる前の居場所。 */
interface MapReturn {
  focusId?: string;
  trail: string[];
  selectedId?: string;
  /** 地図でゴールを選んだか。選んでいればそこへ降りる。 */
  picked: boolean;
}

export interface AppHandle {
  /** ファイルが外部から変わったときに呼ぶ。選択・フォーカスは保ったまま読み直す。
   *
   * 入口が複数ある（エディタ / Obsidian / エージェント / git のマージ）以上、
   * 画面が古いまま次の保存で他人の作業を消すのが一番まずい。file watch から
   * これを叩く。 */
  reload(): Promise<void>;
}

/**
 * 「押した直後、同じ場所に別のボタンが出る」操作で2打目を飲む長さ。
 *
 * 2箇所で同じ形の事故が起きていた（のっち報告 2026-09-03）。
 *
 * - `+` を素早く2回: 1打目でモーダルが開き、**開いた瞬間にボタンの上へ背景が
 *   覆いかぶさる**ので、2打目が背景に落ちて即座に閉じる
 * - 俯瞰 / グラフ を素早く2回: 押すと**同じ位置に逆向きのボタンが出る**ので、
 *   2打目がそちらに当たって元へ戻る
 *
 * どちらも押した本人からは「効かなかった」ようにしか見えない。よくある対策の
 * 「押した場所で離したときだけ効かせる」は、2打目が本当に新しいボタンの上で
 * 完結しているため効かない。時間で見るしかない。
 *
 * 多くの環境のダブルクリック判定（500ms 前後）より短くして、意図した2回目の
 * 操作を邪魔しないようにしてある。
 *
 * **達成のトグルには掛けない。** あちらは同じ位置でラベルが入れ替わる点は同じ
 * だが、2打目にも意味がある（押し過ぎたぶんを引き返す）。飲んでよいのは
 * 「2打目に意味が無い」ものだけ。
 *
 * ただし**2打目は「元に戻す」ではない**。カスケードは往路と復路で向きが違い、
 * 2回押すと押す前と別の状態になる（`ToggleUndo`）。取り消しはヘッダーの
 * 「戻す」が担当で、こちらは押した本人が向きを選び直す操作でしかない。
 */
const DOUBLE_TAP_GUARD_MS = 400;

/** 「最近の変更」に並べる件数。再開の手がかりに要るのは直近のひと塊だけで、
 *  全件を新しい順に並べると、それは一覧ではなく履歴になる（履歴は git が持つ）。 */
const RECENT_LIMIT = 30;

/** 表示用にフォルダ名だけ取る。区切りは Windows / POSIX どちらも来る。 */
function basename(p: string): string {
  const parts = p.split(/[\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export interface VaultInfo {
  /** 今開いているフォルダの絶対パス。 */
  path: string;
  /** 別のフォルダを開き直す。実行すると画面ごと作り直される想定。 */
  switchVault(): Promise<void>;
}

export interface AppOptions {
  /** vault という概念があるシェル（Tauri）だけが渡す。dev サーバ版は
   *  フォルダが固定なので渡さず、ヘッダーのボタンも出ない。 */
  vault?: VaultInfo;
}

/** 前回開いていた場所の保存先。vault ごとには分けない——アプリは1つの vault を
 *  指すので、同時に2つ開く経路が無い。 */
const PLACE_KEY = "sirube.place";

/** 保存するのは「どこを見ていたか」だけ。**検索語は入れない**——開いた瞬間に
 *  絞り込まれた結果が出ると、前回の続きではなく前回の道具立てを復元することに
 *  なる。選択（`selectedId`）も持たない。焦点と俯瞰先から導ける。 */
interface SavedPlace {
  mode: "list" | "graph";
  /** 地図で見ていたなら `"goals"`。縮尺は「どこを見ていたか」の一部——
   *  地図で閉じたのにグラフで開き直すと、前回の続きに見えない。 */
  layer?: "detail" | "goals";
  focusId?: string;
  trail: string[];
  scopeId?: string;
  /** 「最近の変更」を開いていたか。 */
  recent?: boolean;
}

function savePlace(state: AppState): void {
  const place: SavedPlace = {
    mode: state.mode,
    layer: state.layer,
    ...(state.focusId ? { focusId: state.focusId } : {}),
    trail: state.trail,
    ...(state.scopeId ? { scopeId: state.scopeId } : {}),
    ...(state.mode === "list" && state.recent ? { recent: true } : {}),
  };
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // 容量やプライベートモードで書けないことがある。場所を覚えられないだけで
    // 操作は続けられるので、黙って諦める。
  }
}

/**
 * 前回の場所を state へ戻す。**「半年空けても道は残っている」道具なので、
 * 次に開いたときに潜り直しから始まるのは筋が通らない**（のっち 2026-09-03）。
 * TOP へはサイドバーとパンくずから常に1クリックで戻れるので、戻して困る場面は無い。
 *
 * 指していたノードが消えていることがある——外のエディタや git のマージで
 * ファイルが減るのは日常の経路。**存在するものだけ通し、残りは黙って落とす。**
 */
function restorePlace(state: AppState): void {
  let saved: Partial<SavedPlace> | undefined;
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    saved = raw === null ? undefined : (JSON.parse(raw) as Partial<SavedPlace>);
  } catch {
    return; // 壊れた値で起動を止める理由が無い
  }
  if (!saved || (saved.mode !== "list" && saved.mode !== "graph")) return;

  const alive = (id: unknown): id is string => typeof id === "string" && state.graph.nodes[id] !== undefined;
  state.trail = Array.isArray(saved.trail) ? saved.trail.filter(alive) : [];

  // 現在地の無い地図。焦点が無くても地図は成り立つので、縮尺だけ戻す。
  if (saved.mode === "graph" && saved.layer === "goals" && !alive(saved.focusId)) {
    state.mode = "graph";
    state.layer = "goals";
    state.trail = [];
    return;
  }
  if (saved.mode === "graph" && alive(saved.focusId)) {
    state.mode = "graph";
    // 縮尺は焦点が地図に載っているときだけ戻す。ゴールでなくなっていたら
    // （宣言を外した・親が付いた）詳細で開く——地図に無いものを中心に据えると
    // 「ノードが見つかりません」になる。
    if (saved.layer === "goals" && state.goals.graph.nodes[saved.focusId]) state.layer = "goals";
    state.focusId = saved.focusId;
    // グラフに立つときは必ず何かを選んでいる（潜る操作が両方を同時に置く）。
    // 復元でもそれを崩さない。崩すと、詳細パネルだけ空のグラフ画面ができる。
    state.selectedId = saved.focusId;
    return;
  }
  if (saved.mode === "list" && saved.recent === true) {
    state.recent = true;
    state.trail = [];
    return;
  }
  if (saved.mode === "list" && alive(saved.scopeId)) {
    state.scopeId = saved.scopeId;
    state.selectedId = saved.scopeId; // 俯瞰のパネルは絞っている目的そのものを指す
    return;
  }
  // ここに来たら TOP。経路だけ残しても出す場所が無い。
  state.trail = [];
}

/** 2つの下見が同じことを言っているか。**順序も含めて**比べる——同じ顔ぶれでも
 *  理由や辿り方が変わっていれば、人が見たのは別の計画。 */
function samePlan(a: TogglePlan, b: TogglePlan): boolean {
  if (a.target !== b.target || a.satisfied !== b.satisfied) return false;
  if (a.changes.length !== b.changes.length) return false;
  return a.changes.every((c, i) => {
    const other = b.changes[i]!;
    return c.kind === other.kind && c.id === other.id;
  });
}

export async function startApp(fs: SirubeFs, options: AppOptions = {}): Promise<AppHandle> {
  const store = new MarkdownGraphStore(fs);
  const { graph, issues } = await store.load();

  const state: AppState = {
    graph,
    rev: buildReverseIndex(graph),
    cycles: analyzeCycles(graph),
    insp: { moreOpen: false, noteEditing: false },
    mode: "list",
    layer: "detail",
    goals: goalLayer(graph, buildReverseIndex(graph)),
    query: "",
    recent: false,
    recentSort: { key: "mtime", dir: "desc" },
    trail: [],
    issues,
    plan: planReconcile(graph),
  };

  restorePlace(state);

  if (issues.length > 0) {
    toast(`${issues.length} 件のファイルに読み取り上の問題があります`);
  }

  // ---- 再計算 ------------------------------------------------------------
  /** 入口ファイルの書き直し。**画面を止めない**——生成物が古いことはあっても
   *  壊れることは無いので、失敗しても操作は続けさせる。 */
  const syncMocs = (): void => {
    void store.regenerateMocs(state.graph).catch(() => {
      toast("入口ファイル（MOC）の更新に失敗しました");
    });
  };

  const recompute = (): void => {
    state.rev = buildReverseIndex(state.graph);
    state.goals = goalLayer(state.graph, state.rev);
    state.cycles = analyzeCycles(state.graph);
    state.plan = planReconcile(state.graph);
    syncMocs();
  };

  // ---- ヘッダー ----------------------------------------------------------
  const brand = el("brand");
  brand.append(iconSpan("compass", 18), "Sirube");
  el("search-icon").append(iconSpan("search", 15));

  const searchInput = el<HTMLInputElement>("search-input");
  searchInput.addEventListener("input", () => {
    state.query = searchInput.value;
    state.mode = "list";
    // 検索欄を空に戻したら「今やれること」へ（placeholder がそう約束している）。
    // 「最近の変更」から打ち始めても、消したときにそこへは戻さない。
    state.recent = false;
    render();
  });

  // どの vault を開いているかは常に見えている必要がある。「フォルダを間違えた」と
  // 「まだ何も無い」は画面が同じで、区別できないまま時間を溶かしたのが初回起動
  // （2026-08-31）だった。名前を出しておけば、空の画面を見た瞬間に判断できる。
  const vault = options.vault;
  if (vault) {
    const vaultBtn = el<HTMLButtonElement>("vault-btn");
    vaultBtn.classList.remove("hidden");
    vaultBtn.title = vault.path;
    vaultBtn.append(iconSpan("folderOpen", 14), document.createTextNode(basename(vault.path)));
    vaultBtn.addEventListener("click", () => openVault(vault));
  }

  const newRootBtn = el<HTMLButtonElement>("new-root-btn");
  newRootBtn.append(iconSpan("plus", 15));
  newRootBtn.addEventListener("click", () => openAdd());

  /**
   * 直前のトグルを戻すボタン。**連動が起きたときだけ出す。**
   *
   * もう一度押しても戻らないのが理由（`ToggleUndo`）。押した1件だけで済んだ
   * トグルは押し直せば本当に元へ戻るので、そこにボタンを出すと「戻す手段が
   * 2つある」だけになる。**出ていること自体が「押し直しでは戻らない書き込みが
   * 起きた」の合図**で、自動解決ボタンの出し入れと同じ考え方。
   *
   * トーストに寄せなかったのは、3.2秒で消えるから——`issues` を自動解決へ
   * 移した理由（2026-09-02）と同じ。「あ、違う」と気付くのは、たいてい画面が
   * 描き直されて一覧が変わったのを見た後になる。
   */
  const undoBtn = el<HTMLButtonElement>("undo-btn");
  undoBtn.append(iconSpan("undo2", 14), document.createTextNode("戻す"));
  undoBtn.addEventListener("click", () => void undoLast());

  const renderUndoBtn = (): void => {
    undoBtn.classList.toggle("hidden", !lastUndo);
    if (!lastUndo) {
      undoBtn.removeAttribute("title");
      return;
    }
    if (lastUndo.kind === "structure") {
      undoBtn.title = `${lastUndo.undo.label}を戻す`;
      return;
    }
    const toggled = lastUndo.undo;
    const target = toggled.entries.find((e) => e.id === toggled.target);
    const dir = target?.after === false ? "取り消し" : "達成";
    undoBtn.title = `「${nameOf(toggled.target)}」の${dir}を戻す（${toggled.entries.length}件）`;
  };

  const reconcileBtn = el<HTMLButtonElement>("reconcile-btn");
  reconcileBtn.replaceChildren(iconSpan("wandSparkles", 14), document.createTextNode("自動解決"));
  reconcileBtn.addEventListener("click", () => openReconcile());
  // ファイルの問題だけはボタンに件数を出す。トーストは消えるので、
  // 起動直後に見ていないと二度と気づけない。プランの件数を出さないのは、
  // 描画のたびに Tarjan と収束ループを回すことになるため。
  /**
   * 自動解決ボタンの出し入れ。**何も無いときは畳む。**
   *
   * 以前は常駐していて、バッジは `issues`（読めないファイル）だけを数えていた。
   * 自動で直せるものが何件あっても、判断が必要なものが何件あっても**無印のまま**
   * で、押すまで中身が分からない——「自動解決が何を示しているか分からない」
   * （のっち 2026-09-03）の出どころがここ。
   *
   * 数える対象は3つ全部（直せる・判断が要る・読めない）。0 なら押す意味が無い
   * ので出さない。**出ていること自体が「何かある」の合図**になる。
   */
  const renderIssueBadge = (): void => {
    const n = state.plan.fixes.length + state.plan.unresolved.length + state.issues.length;
    reconcileBtn.querySelector(".count")?.remove();
    reconcileBtn.classList.toggle("hidden", n === 0);
    if (n > 0) reconcileBtn.append(h("span", { class: "count" }, [String(n)]));
  };

  // ---- 操作 --------------------------------------------------------------
  /** 画面に出す名前。id は ULID なので、そのまま出すと読めない
   *  （2026-09-01 の id/name 分離のあと、3箇所が素の id を出していた）。
   *  ノードが既に消えている場合だけ id に落ちる。 */
  const nameOf = (id: string): string => state.graph.nodes[id]?.name ?? id;

  const select = (id: string): void => {
    state.selectedId = id;
    // **地図では現在地＝選択。** 地図は全体を1枚で描くので「中心」という概念が
    // 無く、動かす意味があるのは現在地の印と「グラフ」で降りる先だけ。潜る
    // （`drill`）を通さないのは、道を積むと通っていない経路がパンくずに出るため。
    if (state.layer === "goals" && state.graph.nodes[id]) {
      state.focusId = id;
      // 選んだ時点で「降りる先を決めた」ことになる。以後「グラフ」は元の場所へ
      // 戻さず、選んだゴールへ降りる。
      if (state.mapReturn) state.mapReturn.picked = true;
    }
    render();
  };

  /**
   * メモを丸ごとクリップボードへ。
   *
   * **押した流れのまま呼ぶ**——`await` を1つでも挟んでから呼ぶと、ブラウザが
   * 「利用者の操作の最中」と見なす猶予が切れて、**黙って失敗する**（権限が
   * 落ちるだけで例外も出ないことがある）。ここは最初の1行で書き込む。
   */
  const copyNote = async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      toast("メモをコピーしました");
    } catch {
      // WebView やブラウザの設定で塞がっていることがある。黙って諦めない。
      toast("コピーできませんでした");
    }
  };

  const drill = (id: string): void => {
    if (!state.graph.nodes[id]) return;
    if (state.focusId && state.focusId !== id) state.trail.push(state.focusId);
    state.focusId = id;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  /**
   * 焦点のノードを押したら、**潜る前の場所へ1つ戻る**（2026-09-12、のっち依頼）。
   *
   * 入ったのと同じノードで出られるようにする、というだけの話。これまで焦点は
   * 押しても選び直すだけで、戻る道はパンくずにしか無かった。**入口と出口が
   * 別の場所にあると、潜るほど「どこを押せば戻れるか」を覚える量が増える。**
   *
   * 押したノードは**選んだまま**にする。戻るのは縮尺の話で、何を見ていたかは
   * 変わらない——上がった拍子に右パネルが別のノードに差し替わると、戻ったのか
   * 飛んだのか分からなくなる。
   *
   * **道が空なら何もしない**（これまでどおり選び直すだけ）。パンくずの左隣は
   * 「今やれること」だが、そこまで飛ばすと*潜っていないのに画面が変わる*。
   * ここが引き受けるのは「潜ったぶんを戻す」だけで、TOP へ出るのはパンくずの役。
   */
  const ascend = (id: string): void => {
    const parent = state.trail[state.trail.length - 1];
    if (parent === undefined || !state.graph.nodes[parent]) {
      select(id);
      return;
    }
    state.trail = state.trail.slice(0, -1);
    state.focusId = parent;
    state.selectedId = id;
    state.scopeId = undefined;
    state.mode = "graph";
    render();
  };

  /**
   * 地図へ上がる（「もっと俯瞰」）。**地図はゴール全体を1枚で出す**（2026-09-12）。
   *
   * 焦点から下だけを描いていた頃は、根が増えた瞬間に丸1つの画面になっていた
   * （実データで10件中5件）。押しても絵が変わらないので、何が起きたのか分からない。
   *
   * 位置を捨てないのは変えていない。**今いる場所を包む一番近いゴールが現在地**
   * （大きい印＋選択）になる。全体が出ていても、自分がどこに居たのかは要る。
   */
  const goMap = (): void => {
    if (state.goals.ids.length === 0) {
      toast("ゴールがまだありません");
      return;
    }
    const here = state.focusId;
    // 現在地は、今いる場所を包む一番近いゴール。**無いこともある**——上にゴールが
    // 1つも無い場所（降格した根の下）から上がったとき。以前はそこで
    // `goalRoots[0]` へ落としていたが、選び方が id の若い順というだけで、
    // **無関係なゴールに「今ここ」の印が付く**（のっち報告 2026-09-12。
    // `哲学を表明する` から上がると `記事で表明する` が現在地になっていた）。
    // 出せないときは出さない方が嘘が無い。
    const target = here === undefined ? undefined : enclosingGoal(state.graph, here, state.rev);
    // 縮尺が変わる＝別の絵になるので、拡大率と位置は初期に戻す。
    resetViewport();
    state.mapReturn = { trail: [...state.trail], picked: false, ...(here ? { focusId: here } : {}), ...(state.selectedId ? { selectedId: state.selectedId } : {}) };
    state.layer = "goals";
    state.mode = "graph";
    // 経路は積み直す。地図の道と詳細の道は段の数が違うので、混ぜると
    // パンくずが実際には通っていない場所を指す。
    state.trail = [];
    state.focusId = target;
    state.selectedId = target;
    render();
  };

  /**
   * 地図から降りる。**選んだゴールがあればそこへ、無ければ上がる前の場所へ。**
   *
   * 眺めて降りただけなら、入ったところから出る（2026-09-12）。地図は全体を出す
   * ので、何も選ばずに降りる経路が普通にある——そこで現在地のゴールへ降ろすと、
   * 上がる前より浅い場所に立たされる。
   */
  const goDetail = (): void => {
    const back = state.mapReturn;
    state.mapReturn = undefined;
    state.layer = "detail";
    if (back && !back.picked && back.focusId && state.graph.nodes[back.focusId]) {
      state.mode = "graph";
      state.focusId = back.focusId;
      // 消えているノードは落とす。地図を見ている間に外の編集が入ることがある。
      state.trail = back.trail.filter((id) => state.graph.nodes[id]);
      state.selectedId = back.selectedId && state.graph.nodes[back.selectedId] ? back.selectedId : back.focusId;
      render();
      return;
    }
    const here = state.focusId;
    if (here === undefined) {
      // 現在地もゴールの選択も無い。降りる先が決まらないので TOP へ出す。
      state.mode = "list";
      render();
      return;
    }
    focusFresh(here);
  };

  const focusFresh = (id: string): void => {
    // 入口が3つ（サイドバーの目的・一覧の行・インスペクタの上向きリンク）ある
    // ので、`drill` と同じ番人をここにも置く。今はどの経路も実在するノードしか
    // 渡さないが、片方にだけ番人がある状態は次に入口が増えたときに破れる。
    if (!state.graph.nodes[id]) return;
    // 「この目的から見直す」入口なので、拡大率と位置も初期に戻す。潜って移った
    // ときと違い、ここは同じノードを選び直すことがある。
    resetViewport();
    // 入口から入るときは必ず詳細の縮尺。地図から目的を選んだのに地図のままだと、
    // 押したのに同じ絵が出たように見える。
    state.layer = "detail";
    // 目的からの経路をパンくずに積む。一覧から飛ぶと、**それが目的の中のどこ
    // なのか画面のどこにも出ていなかった**（のっち報告 2026-09-03）。目的そのもの
    // を押したときは経路が空なので、これまでどおり1段だけになる。
    state.trail = pathFromRoot(state.graph, state.rev, id);
    state.focusId = id;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  /**
   * 一覧から飛ぶ。**末端は親を中心に据える。**
   *
   * 末端は下に何も持たないので、そこを中心にすると丸1つだけの画面になる
   * （のっち報告 2026-09-03）。グラフの中では末端を押しても潜らないように
   * したが、一覧からの経路には同じ穴が残っていた。親を中心にすれば、押した
   * ものが**どの枝にぶら下がっているか**が同時に見える。
   *
   * 親がいない（孤立している）ノードと、下に何かあるノードはこれまでどおり。
   */
  const openInContext = (id: string): void => {
    if (!state.graph.nodes[id]) return;
    const path = pathFromRoot(state.graph, state.rev, id);
    const parent = path[path.length - 1];
    if (parent === undefined || hasChildren(state.graph, id)) {
      focusFresh(id);
      return;
    }
    resetViewport();
    state.layer = "detail";
    state.trail = path.slice(0, -1);
    state.focusId = parent;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  /**
   * エッジを押したときの差し込みダイアログ。
   *
   * `A -> B` の間に `C` を入れるのは、追加と削除だけだと3手かかる（作る・繋ぐ・
   * 外す）。**エッジそのものを押して差し込む**のが素直だ、というのっちの指摘
   * （2026-09-03）。関係の種類は元のエッジを引き継ぐので、ここでは選ばせない。
   */
  const openInsert = (parentId: string, childId: string, kind: "requires" | "contains"): void => {
    clear(modal);
    modal.append(h("h3", {}, ["間に差し込む"]));
    modal.append(
      h("p", { class: "hint" }, [
        `「${nameOf(parentId)}」と「${nameOf(childId)}」の間に入れる。`,
        kind === "requires"
          ? "元の繋がりは外れ、前提の鎖が1つ伸びる。"
          : "元の繋がりは外れ、内包が1段深くなる。",
      ]),
    );
    const input = h("input", { type: "text", placeholder: "先にやること" }) as HTMLInputElement;
    modal.append(input);

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["キャンセル"]);
    cancel.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["差し込む"]);
    ok.addEventListener("click", async () => {
      let node;
      try {
        node = await store.insertBetween(state.graph, parentId, childId, input.value, kind);
      } catch (e) {
        toast(e instanceof Error ? e.message : "差し込めませんでした");
        return;
      }
      recompute();
      closeModal();
      state.selectedId = node.id;
      render();
      toast(`「${node.name}」を間に入れました`);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ok.click();
      }
    });
    actions.append(cancel, ok);
    modal.append(actions);
    openModal();
    input.focus();
  };

  const goList = (scopeId?: string, recent = false): void => {
    state.mode = "list";
    state.recent = recent && !scopeId;
    // 「最近の変更」は全体の話なので、検索語は捨てる（残すと検索が勝って、押した意味が消える）。
    if (state.recent && state.query !== "") {
      state.query = "";
      searchInput.value = "";
    }
    // 一覧は実グラフの話しかしない（俯瞰も検索も非ゴールを数える）ので、
    // 地図の縮尺を持ち込まない。持ち込むと、戻ったときに地図へ載っていない
    // ノードが地図の中心に据えられる。
    state.layer = "detail";
    state.scopeId = scopeId;
    // TOP へ戻るときは選択も手放す。一覧は「どれをやるか選ぶ」画面で、選択中の
    // 印すら出さない——前の選択を抱えたままだと、画面のどこにも対応する相手が
    // いない詳細パネルが3割を占め続ける（のっち報告 2026-09-03: 目的を1つ押すと、
    // TOP へ戻っても右のパネルが開きっぱなしになる）。
    //
    // 俯瞰（scopeId あり）では残す。そちらのパネルは絞っている目的そのものを
    // 指していて、進捗バーが「今どこの配下を見ているか」の手がかりになる。
    if (!scopeId) state.selectedId = undefined;
    // 俯瞰は「ここの下に何があるか」を見る操作なので、検索語が残っていたら捨てる。
    // 検索は常に全体にかける決まりなので、語が残ったままだと俯瞰を押しても
    // 検索結果のままになり、押した意味が消える（2026-09-02 に実機で踏んだ）。
    if (scopeId && state.query !== "") {
      state.query = "";
      searchInput.value = "";
    }
    render();
  };

  /**
   * 達成のトグル。**押したノード以外の達成状態まで書き換わるときは、先に見せる。**
   *
   * 止めるのは2つだけ——`requires` の遡及（後が終わったなら前も、で前提を埋める）
   * と、取り消しの下流（前提が崩れたなら上に積んだものも戻す）。この2つは実データで
   * 一度に15件を書き換えた（2026-09-09、`生活の収入をつくる` を押したら
   * `Sirube を完成させる` `MVP実装完了` まで達成になった）。**表示ではなくファイルへの
   * 書き込み**なので、押し間違いの実害が他の操作と違う。
   *
   * `contains` の親が立つのは止めない。親に固有の作業が無いからこそ `contains` に
   * したのであって、子と前提が揃った時点で親が終わっているのは定義そのもの。
   * ここまで確認を挟むと、末端を1つ潰すたびにダイアログが出る。
   *
   * 件数で閾値を切らない（「3件以上なら聞く」等）。**その線を跨がない書き換えが
   * 黙って通る**ことになり、静かに書かれるという問題そのものは残る。
   */
  const toggle = async (id: string): Promise<void> => {
    const plan = store.planToggle(state.graph, id);
    const retro = plan.changes.some((c) => c.kind === "prerequisite" || c.kind === "dependent");
    if (!retro) {
      await applyToggle(plan);
      return;
    }
    openTogglePreview(plan);
  };

  /** 直前の操作の控え。**1手だけ**持つ（履歴は持たない——2手前まで戻せると、
   *  どこまで戻ったかを画面に出す責任が生まれる。ここで守りたいのは「今の1回が
   *  間違いだった」であって、作業履歴ではない）。
   *
   *  2026-09-14 から削除と外すも入る（それまでは達成のトグルだけで、消したものは
   *  アプリから戻せなかった）。種類が違う控えでも、持つのは最後の1つだけ。 */
  let lastUndo: { kind: "toggle"; undo: ToggleUndo } | { kind: "structure"; undo: StructureUndo } | undefined;

  /**
   * 直前のトグルを戻す。**カスケードは走らせず、書いた値をそのまま巻き戻す。**
   *
   * 外（Obsidian / AI / git）が1件でも触っていたら戻さない。巻き戻しは
   * 「自分が書いた値を消す」操作なので、他人の書き込みまで消すと取り返しが
   * つかない。
   */
  const undoLast = async (): Promise<void> => {
    const last = lastUndo;
    if (!last) return;
    const stillValid =
      last.kind === "toggle" ? canUndo(state.graph, last.undo) : canUndoStructure(state.graph, last.undo);
    if (!stillValid) {
      lastUndo = undefined;
      render();
      toast("ファイルが外で変わったので、この分は戻せません");
      return;
    }
    if (last.kind === "structure") {
      await store.undoStructure(state.graph, last.undo);
      lastUndo = undefined;
      recompute();
      render();
      toast(`${last.undo.label}を戻しました`);
      return;
    }
    const changed = await store.undoToggle(state.graph, last.undo);
    lastUndo = undefined;
    recompute();
    render();
    toast(`${changed.length} 件を戻しました`);
  };

  const applyToggle = async (plan: TogglePlan): Promise<void> => {
    // 下見を出している間に、外からファイルが書き換わることがある（Tauri は
    // `watchNodes` で読み直してグラフを差し替える）。**古くなった計画は書かない**
    // ——見せたものと違うものを書いたら、確認を取った意味がそこで消える。
    // 下見を挟まない経路でも同じ検査を通る（作ったばかりの計画なので必ず一致する）。
    const fresh = state.graph.nodes[plan.target] ? store.planToggle(state.graph, plan.target) : undefined;
    if (!fresh || !samePlan(fresh, plan)) {
      recompute();
      render();
      toast("ファイルが外で変わったので、もう一度押してください");
      return;
    }
    const { changed, undo } = await store.applyToggle(state.graph, plan);
    // 連動したときだけ控えを残す。1件で済んだトグルは押し直せば元へ戻る。
    lastUndo = changed.length > 1 ? { kind: "toggle", undo } : undefined;
    recompute();
    render();
    if (changed.length > 1) toast(`${changed.length} 件が連動して変わりました（ヘッダーの「戻す」で元に戻せます）`);
  };

  /** 付箋を貼る／外す。トーストは出さない——色は押した瞬間に画面へ出るので、
   *  文字で結果を繰り返すと操作のたびに視界を塞ぐ。 */
  const setColor = async (id: string, color: GoalColor | undefined): Promise<void> => {
    const node = state.graph.nodes[id];
    if (!node) return;
    if (color === undefined) delete node.color;
    else node.color = color;
    await store.persist(state.graph, [id]);
    render();
  };

  /**
   * ゴール宣言を立てる／外す。**地図の顔ぶれが変わるので `recompute` を通す。**
   *
   * 付箋（`setColor`）と違って商グラフを組み直す必要がある——1件立てただけで、
   * その上下の線が全部引き直しになる（間のノードがどこまで畳まれるかが変わる）。
   */
  const setGoal = async (id: string, on: boolean): Promise<void> => {
    const node = state.graph.nodes[id];
    if (!node) return;
    if (on) node.goal = true;
    // 外すときに `false` を書くのは、**書かないと外れない場所だけ**（入次数0）。
    // それ以外は未指定へ戻す。全ファイルに `goal: false` が散ると、読む人には
    // 「宣言した結果ゴールでない」に見えて、タグのように使えると誤解される。
    else if (inDegree(id, state.rev) === 0) node.goal = false;
    else delete node.goal;
    await store.persist(state.graph, [id]);
    recompute();
    render();
    toast(on ? `「${nameOf(id)}」を地図に出しました` : `「${nameOf(id)}」を地図から外しました`);
  };

  /** 親から選択中のノードへの繋がりを切る。ノードは残る。 */
  const detach = async (parentId: string, childId: string): Promise<void> => {
    const parentName = nameOf(parentId);
    const childName = nameOf(childId);
    const undo = await store.detachEdge(state.graph, parentId, childId);
    if (!undo) return;
    lastUndo = { kind: "structure", undo };
    recompute();
    render();
    // 戻し方まで言う。「戻す」は次の操作で上書きされるので、そのあとに戻したく
    // なったときの書き方も残す。
    toast(`「${parentName}」から「${childName}」を外しました（ヘッダーの「戻す」、またはまとめて追加に「${parentName} -> ${childName}」で戻せます）`);
  };

  /**
   * 右クリックのメニュー。**ここにしか無い操作は置かない**——全部どこかにある
   * ものの近道にする（入口が増えるほど、同じことを2通りで覚えることになる）。
   *
   * 削除だけは載せない。消すと子が目的として湧く副作用があり、戻せるのも直後の
   * 1手だけ（2026-09-14 までは戻せなかった）なので、インスペクタの「押してから
   * 確認が出る」形のままにしてある。マウスの1動作の近くに置くものではない。
   */
  const openMenu = (target: MenuTarget, x: number, y: number): void => {
    hideFlyout();
    const items: MenuItem[] = [];
    if (target.kind === "node") {
      const node = state.graph.nodes[target.id];
      if (!node) return;
      // 右クリックでも選ぶ。メニューを閉じたあとに右のパネルが別のものを
      // 指していると、今どれを触ったのか分からなくなる。
      select(target.id);
      const done = resolveState(state.graph, target.id, state.cycles.cyclic) === "SATISFIED";
      items.push({
        label: done ? "未達に戻す" : "達成にする",
        icon: done ? "circleSlash" : "circleCheck",
        onSelect: () => void toggle(target.id),
      });
      items.push({ label: "分解する", icon: "plus", onSelect: () => openBulkAdd(target.id) });
      const on = isGoal(state.graph, target.id, state.rev);
      items.push({
        label: on ? "地図から外す" : "地図に出す",
        icon: "compass",
        onSelect: () => void setGoal(target.id, !on),
      });
      // 地図では左クリックが「選ぶ」だけなので、降りる口をここにも置く。
      // 詳細では押せば潜るので要らない。
      if (state.layer === "goals") {
        items.push({ label: "グラフで開く", icon: "layers", onSelect: () => focusFresh(target.id) });
      }
    } else if (target.kind === "edge") {
      const parent = nameOf(target.parentId);
      const child = nameOf(target.childId);
      items.push({
        label: "間にノードを差し込む",
        icon: "cornerDownRight",
        onSelect: () => openInsert(target.parentId, target.childId, target.edge),
      });
      items.push({
        label: `「${parent}」から「${child}」を外す`,
        icon: "x",
        danger: true,
        onSelect: () => void detach(target.parentId, target.childId),
      });
    } else if (target.kind === "note") {
      const node = state.graph.nodes[target.id];
      if (!node) return;
      items.push({
        label: "編集する",
        icon: "pencil",
        onSelect: () => {
          state.insp.noteEditing = true;
          render();
        },
      });
      // 空のメモをコピーしても何も起きない。項目は出さない。
      if (node.note.trim() !== "") {
        items.push({ label: "メモをコピー", icon: "stickyNote", onSelect: () => void copyNote(node.note) });
      }
    } else {
      items.push({ label: "目的を1つ作る", icon: "plus", onSelect: () => openAdd("one") });
      items.push({ label: "まとめて追加", icon: "listChecks", onSelect: () => openAdd("bulk") });
    }
    openContextMenu(x, y, items);
  };

  const saveNote = async (id: string, note: string): Promise<void> => {
    const node = state.graph.nodes[id];
    if (!node) return;
    node.note = note;
    await store.persist(state.graph, [id]);
    syncMocs(); // 構造は変わらないが mtime は動くので、目的の並び順に効く
    toast("メモを保存しました");
  };

  const rename = async (id: string, name: string): Promise<void> => {
    const before = nameOf(id);
    try {
      await store.renameNode(state.graph, id, name);
    } catch (e) {
      // 同名は作らせない。名前で参照を解決する経路（まとめて追加）があるので、
      // 同じ名前が2つあるとどちらにも繋がずに止まる。
      toast(e instanceof Error ? e.message : "名前を変えられませんでした");
      render();
      return;
    }
    recompute();
    render();
    if (nameOf(id) !== before) toast(`「${nameOf(id)}」に変えました`);
  };

  const removeNode = async (id: string): Promise<void> => {
    // 名前は消す前に控える。削除後の graph には当然もう無い。
    const name = nameOf(id);
    const { undo } = await store.deleteNode(state.graph, id);
    lastUndo = { kind: "structure", undo };
    if (state.focusId === id) state.focusId = undefined;
    if (state.selectedId === id) state.selectedId = undefined;
    state.trail = state.trail.filter((t) => t !== id);
    recompute();
    if (!state.focusId) state.mode = "list";
    render();
    toast(`「${name}」を削除しました（ヘッダーの「戻す」で戻せます）`);
  };

  // ---- モーダル ----------------------------------------------------------
  const backdrop = el("modal-backdrop");
  const modal = el("modal");
  let openedAt = 0;
  /** 俯瞰 / グラフ を最後に切り替えた時刻。押すと同じ位置に逆向きのボタンが出る。 */
  let lastSwitchAt = 0;

  const openModal = (): void => {
    openedAt = Date.now();
    backdrop.classList.remove("hidden");
  };
  const closeModal = (): void => backdrop.classList.add("hidden");
  backdrop.addEventListener("click", (e) => {
    if (e.target !== backdrop) return;
    if (Date.now() - openedAt < DOUBLE_TAP_GUARD_MS) return;
    closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ---- ペイン幅の可変化と格納 --------------------------------------------
  //
  // 「横並びで常時見せる」か「グラフに全幅を渡す」かは場面によって変わる。
  // 分解しているときはグラフを広く、メモを書くときは右を広く取りたい。
  // どちらかに決め打ちせず、その場で寄せられるようにする（のっち案）。
  //
  // 端まで寄せると格納する。掴み手（レール）は残す——消してしまうと引き出す
  // 手段が無くなり、%LOCALAPPDATA% を掘らせた vault パスと同じ袋小路になる。
  const CENTER_MIN = 360; // 中央に必ず残す作業幅。両側に寄せ切って潰させない。

  interface PaneOpts {
    id: string;
    /** 格納中に出す引き出しボタンの向き。しまった側から中央へ開く矢印にする。 */
    openDir: "right" | "left";
    /** 引き出しボタンの読み上げ名。 */
    openLabel: string;
    /** 格納したときにパネル自体を消すための body クラス。列幅を0にしても
     * padding が残って数十pxの帯になるので、幅だけでは畳みきれない。 */
    hideClass: string;
    cssVar: string;
    storageKey: string;
    defaultW: number;
    minW: number;
    /** ポインタ位置からこのペインの幅を出す。 */
    widthAt(clientX: number): number;
    /** 反対側のペインが今使っている幅（中央の残りを計算するため）。 */
    otherW(): number;
  }

  const paneWidth = (cssVar: string, fallback: number): number => {
    const v = parseInt(getComputedStyle(document.documentElement).getPropertyValue(cssVar), 10);
    return Number.isFinite(v) ? v : fallback;
  };

  const setupPane = (o: PaneOpts): void => {
    const rail = document.getElementById(o.id);
    if (!rail) return;

    const apply = (px: number, persist: boolean): void => {
      // minW を下回ったら中途半端な幅で止めず、格納（0）に倒す。
      // 「狭すぎて読めないが場所は取る」状態を作らない。
      const max = Math.max(o.minW, window.innerWidth - o.otherW() - CENTER_MIN - 10);
      const w = px < o.minW * 0.7 ? 0 : Math.round(Math.min(Math.max(px, o.minW), max));
      document.documentElement.style.setProperty(o.cssVar, `${w}px`);
      rail.classList.toggle("collapsed", w === 0);
      document.body.classList.toggle(o.hideClass, w === 0);
      if (persist) localStorage.setItem(o.storageKey, String(w));
    };

    const saved = Number(localStorage.getItem(o.storageKey));
    if (Number.isFinite(saved) && saved >= 0 && localStorage.getItem(o.storageKey) !== null) {
      document.documentElement.style.setProperty(o.cssVar, `${saved}px`);
      rail.classList.toggle("collapsed", saved === 0);
      document.body.classList.toggle(o.hideClass, saved === 0);
    }

    // 格納すると 5px のレールしか残らず、そこに掴めるものがあると気づけない。
    // しまった側から中央へ開く矢印を1つ置いて、押せば既定幅で戻るようにする。
    const openBtn = h("button", { class: "rail-btn", type: "button" }) as HTMLButtonElement;
    openBtn.setAttribute("aria-label", o.openLabel);
    openBtn.title = o.openLabel;
    openBtn.append(iconSpan("chevronRight", 14));
    if (o.openDir === "left") openBtn.classList.add("flip");
    // レールの pointerdown はドラッグ開始なので、ボタンの上では止める。
    openBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      apply(o.defaultW, true);
      if (state.mode === "graph") renderCenter();
    });
    rail.append(openBtn);

    let dragging = false;
    const stop = (): void => {
      if (!dragging) return;
      dragging = false;
      rail.classList.remove("dragging");
      document.body.classList.remove("resizing");
      localStorage.setItem(o.storageKey, String(paneWidth(o.cssVar, o.defaultW)));
      // 折り返し位置は描画時のペイン幅で決まるので、離した時点で引き直す。
      if (state.mode === "graph") renderCenter();
    };
    rail.addEventListener("pointerdown", (e) => {
      dragging = true;
      rail.classList.add("dragging");
      document.body.classList.add("resizing");
      rail.setPointerCapture((e as PointerEvent).pointerId);
    });
    rail.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      apply(o.widthAt((e as PointerEvent).clientX), false);
    });
    rail.addEventListener("pointerup", stop);
    rail.addEventListener("pointercancel", stop);
    // 格納中はダブルクリックで開き、開いているときは既定に戻す。
    rail.addEventListener("dblclick", () => {
      apply(paneWidth(o.cssVar, o.defaultW) === 0 ? o.defaultW : o.defaultW, true);
      if (state.mode === "graph") renderCenter();
    });
  };

  setupPane({
    id: "sidebar-resizer",
    openDir: "right",
    openLabel: "目的の一覧を開く",
    hideClass: "hide-sidebar",
    cssVar: "--sidebar-w",
    storageKey: "sirube.sidebarWidth",
    defaultW: 220,
    minW: 160,
    widthAt: (x) => x,
    otherW: () => paneWidth("--inspector-w", 320),
  });
  setupPane({
    id: "inspector-resizer",
    openDir: "left",
    openLabel: "詳細パネルを開く",
    hideClass: "hide-inspector",
    cssVar: "--inspector-w",
    storageKey: "sirube.inspectorWidth",
    defaultW: 320,
    minW: 240,
    widthAt: (x) => window.innerWidth - x,
    otherW: () => paneWidth("--sidebar-w", 220),
  });

  // グラフは描画時のペイン幅を測って折り返し位置を決めるため、ウィンドウを
  // 広げても畳んだままになる（2026-08-31 の実機確認で発見。幅は足りているのに
  // 子が1行1個で並んでいた）。リサイズが止まってから引き直す。
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener("resize", () => {
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.mode === "graph") renderCenter();
    }, 120);
  });

  /** 前提の一括追加。分解の流れに直結する MVP の中核。 */
  /** 今の vault を見せ、別のフォルダへ切り替える。
   *
   * Obsidian と同じで、開くフォルダを丸ごと入れ替える形（複数 vault を同時に
   * 開かない）。切り替えは画面ごと作り直す——ストアもエンジンも起動時に
   * 組み上がるので、途中で差し替えるより読み直す方が確実。 */
  const openVault = (info: VaultInfo): void => {
    clear(modal);
    modal.append(h("h3", {}, ["データの場所"]));
    modal.append(h("p", { class: "hint" }, ["ノードはこのフォルダの中だけにあります。Git で共有するのも、Obsidian で開くのもこの単位。"]));
    modal.append(h("div", { class: "vault-path" }, [info.path]));

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["閉じる"]);
    cancel.addEventListener("click", closeModal);
    const swap = h("button", { class: "btn", type: "button" });
    swap.append(iconSpan("folderOpen", 14), "別のフォルダを開く");
    swap.addEventListener("click", () => void info.switchVault());
    actions.append(cancel, swap);
    modal.append(actions);
    openModal();
  };

  /** 新しい目的を1つ起こす。
   *
   * 空の vault ではノードが1つも無く、選択も無いので、インスペクタ側の
   * 「分解する」には辿り着けない——**最初の1個を作る道がそこしか無いと
   * 詰む**（2026-08-31 に懸念として記録し、2026-09-01 にコードで確認した）。
   * サイドバーの見出しに常設し、0件のときは空表示からも同じ操作を出す。
   *
   * ここで作るのは「目的」だが、モデル上はただのノード（`type` は無い）。
   * ルートかどうかは入次数0から導かれるので、後から誰かの前提として繋がれば
   * 自然に目的ではなくなる。 */
  /**
   * ノードを作る入口。**「1つ作る」と「まとめて書く」を1枚に畳んである。**
   *
   * 以前は前者がサイドバーの `+`、後者がヘッダーのボタンで、離れている上に
   * 互いを知らなかった（のっち 2026-09-03「新規作成系が分離してるイメージ」）。
   * 行き先が違うわけではない——どちらも vault にノードが増えるだけ——なので、
   * 場所で分ける理由が無かった。
   *
   * ヘッダーから外したのは、あそこが「探す（検索）」「整える（自動解決）」の
   * 並びで、作る系が1つだけ混ざっていたため。DSL は毎日使う道具でもないので、
   * 畳んで必要な人だけ開く形にする（表示量の原則3と同じ）。
   *
   * `+` の位置は動かさない。**空の vault では最初の1個を作る道がそこにしか
   * 無い**ので、発見しやすさを落とせない（2026-09-01 にコードで確認済み）。
   * インスペクタの「分解する」は別に残す。あれは「今見ているノードの
   * 下に」という行き先が場所そのもので、分解の主役ボタンでもある。
   */
  const openAdd = (mode: "one" | "bulk" = "one"): void => {
    clear(modal);
    const tabs = h("div", { class: "modal-tabs" });
    const tab = (m: "one" | "bulk", label: string): HTMLButtonElement => {
      const b = h("button", { class: `modal-tab${m === mode ? " on" : ""}`, type: "button" }, [label]);
      // 押し直しで開き直す。入力中の文字は捨てる——2つのモードは書式が違う
      // ので、持ち越しても続きにならない。
      b.addEventListener("click", () => openAdd(m));
      return b;
    };
    tabs.append(tab("one", "1つ作る"), tab("bulk", "まとめて書く"));
    modal.append(tabs);

    if (mode === "one") appendOneForm();
    else appendBulkForm();
    openModal();
  };

  const appendOneForm = (): void => {
    modal.append(
      h("p", { class: "hint" }, [
        "達成したいことを1つ書く。作るとグラフが開くので、何が必要かは右の「分解する」から足せる。Enter で作成。",
      ]),
    );
    const input = h("input", { type: "text", placeholder: "引っ越す" }) as HTMLInputElement;
    modal.append(input);

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["キャンセル"]);
    cancel.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["作成"]);
    ok.addEventListener("click", async () => {
      const name = input.value.trim();
      if (!name) {
        toast("名前を入れてください");
        return;
      }
      // 同じ名前が既にあるなら作らずそこへ飛ぶ。一括追加が「既にある名前を書けば
      // そのノードに繋がる」挙動なので、こちらだけ黙って重複を作ると入口によって
      // 結果が変わる。照合は表記ゆれを潰した上で行う（一括追加と同じ規則）。
      const key = normalizeForDuplicateCheck(name);
      const existing = Object.values(state.graph.nodes).find((n) => normalizeForDuplicateCheck(n.name) === key);
      if (existing) {
        closeModal();
        focusFresh(existing.id);
        toast(`「${existing.name}」は既にあります`);
        return;
      }
      const node = await store.createNode(state.graph, name);
      recompute();
      closeModal();
      focusFresh(node.id);
      toast(`「${node.name}」を作りました`);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        ok.click();
      }
    });
    actions.append(cancel, ok);
    modal.append(actions);
    input.focus();
  };

  /**
   * DSL でまとめて構造を作る。
   *
   * 「分解する」の前提タブが1つのノードの下に `requires` をフラットに生やすのに対し、
   * こちらは**入れ子と合流を含む形をそのまま書き下す**ための入口。パーサ
   * （`parseDsl`）もストア側（`importDsl`）も先にあったのに画面から呼ぶ道が無く、
   * `AGENTS.md` はエージェントへ「アプリの一括生成に貼る」と案内していた——
   * 存在しないドアを案内している状態だった（2026-09-02 の棚卸しで発覚）。
   */
  const appendBulkForm = (): void => {
    modal.append(
      h("p", { class: "hint" }, [
        "分解を書き下すと、そのままノードとエッジになる。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。Ctrl+Enter で追加。",
      ]),
    );

    // 説明は初回しか読まれない。畳んで、必要な人だけ開く（表示量の原則3）。
    const help = h("details", { class: "dsl-help" });
    help.append(h("summary", {}, ["書き方"]));
    const rules = h("ul");
    for (const line of [
      "X -> Y は「X には Y が必要」（requires）",
      "[...] は直前のノードの中身（contains）。親 -> [子1] -> [子2] で兄弟が並ぶ",
      ", で式を区切る。同じ名前は同じノードになる",
    ]) {
      rules.append(h("li", {}, [line]));
    }
    help.append(rules);
    help.append(h("pre", {}, ["引っ越し -> 引っ越し先の家 -> 不動産に行く,\n引っ越し -> お金を貯める"]));
    modal.append(help);

    const ta = h("textarea", {
      class: "dsl-input",
      placeholder: "リリース -> 手順書, リリース -> CI/CD",
    }) as HTMLTextAreaElement;
    modal.append(ta);

    const preview = h("div", { class: "hint", style: "margin-top:8px;font-size:12px" });
    const updatePreview = (): void => {
      const text = ta.value.trim();
      if (text === "") {
        preview.textContent = "";
        preview.classList.remove("error");
        return;
      }
      const parsed = parseDsl(ta.value);
      if (parsed.errors.length > 0) {
        // 構文エラーは押す前に見せる。押してからトーストで返すと、どこが悪いのか
        // 分からないまま同じ文字列を2回書くことになる。
        preview.textContent = parsed.errors[0]!.message;
        preview.classList.add("error");
        return;
      }
      preview.classList.remove("error");
      // 既存に繋がるぶんと新しく起こすぶんを分けて出す。ここを1つの数にすると
      // 「同じ名前を書いたのに新しく作られたのでは」という不安が残る。
      const existing = new Set(Object.values(state.graph.nodes).map((n) => normalizeForDuplicateCheck(n.name)));
      const fresh = parsed.nodes.filter((n) => !existing.has(normalizeForDuplicateCheck(n.id)));
      const linked = parsed.nodes.length - fresh.length;
      preview.textContent =
        linked > 0
          ? `${fresh.length} 件を新しく作り、${linked} 件は既存に繋ぎます`
          : `${fresh.length} 件を新しく作ります`;
    };
    ta.addEventListener("input", updatePreview);
    modal.append(preview);

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["キャンセル"]);
    cancel.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["追加"]);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        ok.click();
      }
    });
    ok.addEventListener("click", async () => {
      const res = await store.importDsl(state.graph, ta.value);
      if (res.errors.length > 0) {
        toast(res.errors[0]!.message);
        return;
      }
      recompute();
      closeModal();
      // 作った先へ飛ぶ。最初に書いたノードが、書き手にとっての起点。
      const first = res.created[0] ?? res.updated[0];
      if (first) focusFresh(first);
      toast(`${res.created.length} 件を作り、${res.updated.length} 件に繋ぎました`);
      offerShortcuts(res.addedRequires);
    });
    actions.append(cancel, ok);
    modal.append(actions);
    ta.focus();
  };

  /**
   * 一括追加。**前提（requires）と中身（contains）をタブで切り替える。**
   *
   * 中身の側は 2026-09-14 に足した（のっち、足りない機能の4番目）。終わらない
   * 括り（動詞のまとまり）へ作業を足すのに、DSL を書くしか道が無かった。
   * ボタンを2つに増やさずタブにしたのは、入力の形（1行1ノード）が同じで、
   * 違うのは「何を問うか」だけだから。見出しの問いを入れ替え、判別の一問を
   * その下に置く。
   *
   * タブを押し直しても**書きかけは持ち越す**（「まとめて書く」とは逆）。
   * 書式が同じなので、書いてから「これは中身だった」と気づいて切り替える
   * のが自然な流れになる。
   */
  const openBulkAdd = (targetId: string, kind: "requires" | "contains" = "requires", draft = ""): void => {
    clear(modal);
    const tabs = h("div", { class: "modal-tabs" });
    const tab = (k: "requires" | "contains", label: string): HTMLButtonElement => {
      const b = h("button", { class: `modal-tab${k === kind ? " on" : ""}`, type: "button", "data-tour": `tab-${k}` }, [label]);
      b.addEventListener("click", () => openBulkAdd(targetId, k, ta.value));
      return b;
    };
    tabs.append(tab("requires", "前提"), tab("contains", "中身"));
    modal.append(tabs);

    modal.append(
      h("h3", {}, [kind === "requires" ? `「${nameOf(targetId)}」には何が必要？` : `「${nameOf(targetId)}」は何でできている？`]),
    );
    modal.append(
      h("p", { class: "hint" }, [
        kind === "requires"
          ? "揃ったあとも「" + nameOf(targetId) + "」自体にやることが残るなら前提。"
          : "全部揃えば「" + nameOf(targetId) + "」自体にやることは残らないなら中身（担当分・部品・機能のまとまり）。",
        "1行に1つ書く。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。Ctrl+Enter で追加。",
      ]),
    );
    const ta = h("textarea", {
      placeholder: kind === "requires" ? "引っ越し先の家\nお金を貯める\n不動産に行く" : "近道を見せる\n中身を一括で足す",
    }) as HTMLTextAreaElement;
    ta.value = draft;
    modal.append(ta);

    const label = kind === "requires" ? "前提" : "中身";
    // 書いた行を「新しく作る／既存に繋ぐ／もう繋がっている」に分ける（2026-09-28、
    // のっち）。行数だけ数えると、既にある名前を書いたとき「新しく作られたのでは」
    // という不安が残る——「まとめて書く」の下見が既に分けて出しているのと揃える。
    // 名前の突き合わせはストア（`mergeByName`）と同じ正規化・同名は先勝ち。
    const classify = (): { fresh: number; linked: number; already: number } => {
      const byName = new Map<string, string>();
      for (const [id, n] of Object.entries(state.graph.nodes)) {
        const key = normalizeForDuplicateCheck(n.name);
        if (!byName.has(key)) byName.set(key, id);
      }
      const current = new Set(state.graph.nodes[targetId]?.[kind] ?? []);
      const keys = new Set(
        ta.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(normalizeForDuplicateCheck),
      );
      let fresh = 0;
      let linked = 0;
      let already = 0;
      for (const key of keys) {
        const id = byName.get(key);
        if (id === undefined) fresh += 1;
        else if (current.has(id)) already += 1;
        else linked += 1;
      }
      return { fresh, linked, already };
    };
    const preview = h("div", { class: "hint", style: "margin-top:8px;font-size:12px" });
    const updatePreview = (): void => {
      const { fresh, linked, already } = classify();
      const adding = fresh + linked;
      if (adding + already === 0) {
        preview.textContent = "";
        return;
      }
      const parts: string[] = [];
      if (adding > 0) {
        parts.push(
          linked > 0 ? `${adding} 件の${label}を追加します（うち ${linked} 件は既存に繋ぎます）` : `${adding} 件の${label}を追加します`,
        );
      }
      if (already > 0) parts.push(`${already} 件は既に${label}です`);
      preview.textContent = parts.join("。");
    };
    updatePreview();
    ta.addEventListener("input", updatePreview);
    modal.append(preview);

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["キャンセル"]);
    cancel.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["追加"]);
    // 改行で項目を区切る入力なので、Enter は改行のまま。確定は Ctrl+Enter。
    // ここでマウスへ往復させると、3行打つたびに手が離れて分解の速度が落ちる。
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        ok.click();
      }
    });
    ok.addEventListener("click", async () => {
      const containsBefore = [...(state.graph.nodes[targetId]?.contains ?? [])];
      // 書く前に数える。書いた後の graph では、新しく作ったものも「既存」に見える。
      const { linked } = classify();
      const res = await store.addBulk(state.graph, targetId, ta.value, kind);
      if (res.errors.length > 0) {
        toast(res.errors[0]!.message);
        return;
      }
      recompute();
      closeModal();
      focusFresh(targetId);
      // 新しく作った数だけ数えると、既存に繋いだだけのとき「0 件を追加しました」
      // になり、失敗に読める（2026-09-28 に見つけた）。
      const made = res.created.length;
      toast(
        made > 0 && linked > 0
          ? `${made + linked} 件を追加しました（うち ${linked} 件は既存に繋ぎました）`
          : made > 0
          ? `${made} 件を追加しました`
          : linked > 0
          ? `${linked} 件を既存に繋ぎました`
          : `どれも既に${label}です`,
      );
      if (kind === "requires") offerShortcuts(res.addedRequires);
      else offerReopen(targetId, containsBefore);
    });
    actions.append(cancel, ok);
    modal.append(actions);
    openModal();
    ta.focus();
  };

  /**
   * 達成済みの親へ未達の中身を足したとき、親を未達に戻すか聞く。
   *
   * `contains` の親は子が揃うと自動で達成になるが、逆（子が戻ったら親も戻す）は
   * しない——到達した達成は記録として残す（2026-08-26 のっち判断）。その判断は
   * 変えない。ただ**新しく足した中身**は「戻った子」ではなく、今ある分がまだ
   * 終わっていないという話なので、黙って達成のまま残すと親が嘘をつく。自動では
   * 戻さず、ここで本人に選ばせる。
   *
   * 戻すときは普通のトグルを通す（上に積んだものが連動するなら下見が出る）。
   * 聞くのは今回繋いだ子だけ。前から中にあった未達で毎回聞くと、上の判断で
   * 残した記録をそのたびに問い直すことになる。
   */
  const offerReopen = (parentId: string, containsBefore: readonly string[]): void => {
    const parent = state.graph.nodes[parentId];
    if (!parent?.satisfied) return;
    const before = new Set(containsBefore);
    const fresh = parent.contains.filter(
      (id) => !before.has(id) && resolveState(state.graph, id, state.cycles.cyclic) !== "SATISFIED",
    );
    if (fresh.length === 0) return;

    clear(modal);
    modal.append(h("h3", {}, [`「${parent.name}」は達成済みです`]));
    modal.append(
      h("p", { class: "hint" }, [
        `未達の中身を ${fresh.length} 件足したので、今ある分はまだ終わっていません。未達に戻しますか？ 戻さないと、達成のまま中に未達が残ります（自動解決はここを戻しません）。`,
      ]),
    );
    const actions = h("div", { class: "modal-actions" });
    const keep = h("button", { class: "btn", type: "button" }, ["そのまま"]);
    keep.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["未達に戻す"]);
    ok.addEventListener("click", () => {
      closeModal();
      if (state.graph.nodes[parentId]?.satisfied) void toggle(parentId);
    });
    actions.append(keep, ok);
    modal.append(actions);
    openModal();
    keep.focus();
  };

  /**
   * 繋いだことで要らなくなった直接の前提を見せ、外すか聞く（`findShortcuts`）。
   *
   * 一括追加は平らに並べるので、「前提の前提」が兄弟として混ざる。後から兄弟の
   * 下へ兄弟を繋ぐと親からの直接の線が残り、偽の合流点になる（のっち 2026-09-14）。
   * 入力を階層付きにする代わりに、**繋いだ瞬間にここで1手で直せる**ようにする。
   *
   * 全部外すか、そのままかの2択。残しても状態は壊れない（入次数が水増しされる
   * だけ）ので、トグルの下見と違って「そのまま」は安全側の答えになる。
   */
  const offerShortcuts = (added: readonly { from: string; to: string }[]): void => {
    const shortcuts = findShortcuts(state.graph, added);
    if (shortcuts.length === 0) return;

    clear(modal);
    modal.append(h("h3", {}, ["直接の繋がりが要らなくなりました"]));
    modal.append(
      h("p", { class: "hint" }, [
        "別の前提を通って同じノードに届いています。直接の線を残すと、2か所から求められている合流点に見えます。外しても達成状態は変わりません。",
      ]),
    );
    const ul = h("ul", { class: "plan-list" });
    for (const s of shortcuts) {
      ul.append(
        h("li", {}, [
          h("span", { class: "plan-kind" }, ["外す"]),
          `${nameOf(s.from)} → ${nameOf(s.to)}（${nameOf(s.via)} から届く）`,
        ]),
      );
    }
    modal.append(ul);

    const actions = h("div", { class: "modal-actions" });
    const keep = h("button", { class: "btn", type: "button" }, ["そのまま"]);
    keep.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, ["外す"]);
    ok.addEventListener("click", async () => {
      closeModal();
      // 1件ずつ確かめ直してから外す。出している間に外でファイルが変わり、
      // 唯一の繋がりになっていたものは切らない（ストア側で弾く）。
      const { done, undo } = await store.detachShortcuts(state.graph, shortcuts);
      if (undo) lastUndo = { kind: "structure", undo };
      recompute();
      render();
      if (done.length === 0) {
        toast("ファイルが外で変わったので、外しませんでした");
        return;
      }
      const one = done.length === 1 ? done[0]! : undefined;
      toast(
        one
          ? `「${nameOf(one.from)}」から「${nameOf(one.to)}」を外しました（ヘッダーの「戻す」、またはまとめて追加に「${nameOf(one.from)} -> ${nameOf(one.to)}」で戻せます）`
          : `直接の線を ${done.length} 本外しました（ヘッダーの「戻す」で戻せます）`,
      );
    });
    actions.append(keep, ok);
    modal.append(actions);
    openModal();
    // 入力の無いモーダルなので、確定の Enter が勢いで書き込みにならないよう
    // 書かない側へ寄せる（トグルの下見と同じ）。
    keep.focus();
  };

  /**
   * トグルの下見。**書く前に、何が一緒に動くかを名前で出す。**
   *
   * 自動解決（`openReconcile`）は前からプレビューを出してから実行していたのに、
   * トグルだけが黙って書いていた。起きていることは同じ「前提を埋める」なので、
   * 入口が違うだけで見え方が変わるのは筋が通らない。出し方も揃えてある。
   *
   * 部分適用はできない形にした（実行かキャンセルの2択）。1件だけ拒むと
   * 「達成なのに前提が未達」がそのまま残り、次の自動解決が同じ提案を持って
   * 戻ってくる。**繋がりが AND として間違っているなら、直すのは構造の方**——
   * 「どれか1つでいい」ものは前提ではなく選択肢なので、そもそも繋がない。
   */
  const openTogglePreview = (plan: TogglePlan): void => {
    clear(modal);
    const on = plan.satisfied;
    modal.append(h("h3", {}, [on ? "達成にすると、前提も達成になります" : "達成を取り消すと、下流も戻ります"]));
    modal.append(
      h("p", { class: "hint" }, [
        on
          ? "「後が終わっているなら、前も終わっていたはず」として遡ります。ファイルに書き込むので、内容を確認してください。"
          : "「前提が崩れたなら、その上に積んだものも本当は終わっていない」として戻します。前提側には触りません。",
      ]),
    );

    modal.append(
      h("h4", { style: "margin:12px 0 4px;font-size:12px" }, [`書き換わる（${plan.changes.length}）`]),
    );
    const ul = h("ul", { class: "plan-list" });
    for (const c of plan.changes) {
      const li = h("li");
      switch (c.kind) {
        case "target":
          li.append(h("span", { class: "plan-kind" }, [c.satisfied ? "達成にする" : "達成を戻す"]), nameOf(c.id));
          break;
        case "prerequisite":
          li.append(h("span", { class: "plan-kind" }, ["前提を埋める"]), `${nameOf(c.id)}（${nameOf(c.via)} の前提）`);
          break;
        case "contains-parent":
          li.append(h("span", { class: "plan-kind" }, ["親を達成に"]), `${nameOf(c.id)}（子が全部揃った）`);
          break;
        case "dependent":
          li.append(h("span", { class: "plan-kind" }, ["達成を戻す"]), `${nameOf(c.id)}（${nameOf(c.via)} が戻るため）`);
          break;
      }
      ul.append(li);
    }
    modal.append(ul);

    if (on) {
      modal.append(
        h("p", { class: "hint" }, [
          "覚えのないものが並んでいたら、前提が AND になっているか疑ってください。「どれか1本立てばいい」ものは前提ではなく選択肢なので、繋がずにメモへ書きます。",
        ]),
      );
    }

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["キャンセル"]);
    cancel.addEventListener("click", closeModal);
    const ok = h("button", { class: "btn primary", type: "button" }, [on ? "達成にする" : "取り消す"]);
    ok.addEventListener("click", async () => {
      closeModal();
      await applyToggle(plan);
    });
    actions.append(cancel, ok);
    modal.append(actions);
    openModal();
    // **キャンセル側に置く。** 他のモーダルは入力欄へ寄せているが、ここには
    // 入力が無い。実行側へ置くと、開いた勢いの Enter がそのまま書き込みになり、
    // 確認を挟んだ意味が消える。Escape でも閉じる（どちらもキャンセル）。
    cancel.focus();
  };

  /** 自動解決。宣言して実行し、残りを報告する。 */
  const openReconcile = (): void => {
    const plan = state.plan;
    clear(modal);
    modal.append(h("h3", {}, ["自動解決"]));

    if (plan.fixes.length === 0 && plan.unresolved.length === 0 && state.issues.length === 0) {
      modal.append(h("p", { class: "hint" }, ["不整合はありませんでした。"]));
    } else {
      modal.append(
        h("p", { class: "hint" }, [
          "変更時刻の新しい方を「最新の意図」として扱います。実行前に内容を確認してください。",
        ]),
      );
    }

    if (plan.fixes.length > 0) {
      modal.append(h("h4", { style: "margin:12px 0 4px;font-size:12px" }, [`自動解決する（${plan.fixes.length}）`]));
      const ul = h("ul", { class: "plan-list" });
      // 計画は id で組み立てられている（コアは表示を決めない）ので、出す直前に
      // 名前へ直す。`create-missing-node` の対象だけはグラフにまだ居ないため
      // nameOf が id のまま返すが、そこは正しい——リンク切れの参照は人が手で
      // 書いた文字列そのものであって、それを見せないと直しようがない。
      for (const f of plan.fixes) {
        const li = h("li");
        switch (f.kind) {
          case "satisfy-prerequisite":
            li.append(h("span", { class: "plan-kind" }, ["前提を埋める"]), `${nameOf(f.prerequisite)}（${nameOf(f.node)} の方が新しい）`);
            break;
          case "unsatisfy-node":
            li.append(h("span", { class: "plan-kind" }, ["達成を戻す"]), `${nameOf(f.node)}（${nameOf(f.prerequisite)} の方が新しい）`);
            break;
          case "satisfy-contains-parent":
            li.append(h("span", { class: "plan-kind" }, ["親を達成に"]), `${nameOf(f.parent)}（子が全部揃った）`);
            break;
          case "unsatisfy-contains-parent":
            li.append(h("span", { class: "plan-kind" }, ["達成を戻す"]), `${nameOf(f.parent)}（中身の ${nameOf(f.child)} が未達で、そちらの方が新しい）`);
            break;
          case "create-missing-node":
            li.append(h("span", { class: "plan-kind" }, ["空ノード作成"]), `${f.id}（${f.referencedBy.map(nameOf).join(", ")} が参照）`);
            break;
        }
        ul.append(li);
      }
      modal.append(ul);
    }

    if (plan.unresolved.length > 0) {
      modal.append(
        h("h4", { style: "margin:14px 0 4px;font-size:12px" }, [`判断が必要（${plan.unresolved.length}）`]),
      );
      const ul = h("ul", { class: "plan-list" });
      for (const u of plan.unresolved) {
        const li = h("li");
        if (u.kind === "cycle") {
          li.append(h("span", { class: "plan-kind" }, ["待ち合い"]), `${u.nodes.map(nameOf).join("・")}（分解が要る）`);
        } else if (u.kind === "near-duplicate") {
          li.append(h("span", { class: "plan-kind" }, ["表記ゆれ"]), u.ids.map(nameOf).join(" / "));
        } else if (u.kind === "contains-cycle") {
          li.append(
            h("span", { class: "plan-kind" }, ["内包の待ち合い"]),
            `${u.nodes.map(nameOf).join(" → ")} → …（割るのではなく、どれかの「これで構成」を外す）`,
          );
        } else if (u.kind === "oscillating") {
          li.append(
            h("span", { class: "plan-kind" }, ["決められない"]),
            `${nameOf(u.node)} — 達成と未達成を行き来するので、どちらが正しいか手で決めてください`,
          );
        } else {
          li.append(
            h("span", { class: "plan-kind" }, ["時刻が近すぎる"]),
            `${nameOf(u.node)} と ${nameOf(u.prerequisite)} — どちらが新しいか判断できません`,
          );
        }
        ul.append(li);
      }
      modal.append(ul);
    }

    // 読み取り時の問題。プランとは別立てにする——自動解決で直せるものではなく、
    // ファイルを開いて人が直すものなので、同じ箱に入れると「実行」で消えると
    // 誤解させる。
    if (state.issues.length > 0) {
      modal.append(
        h("h4", { style: "margin:14px 0 4px;font-size:12px" }, [`ファイルの問題（${state.issues.length}）`]),
      );
      const ul = h("ul", { class: "plan-list" });
      for (const i of state.issues) {
        const li = h("li");
        li.append(h("span", { class: "plan-kind" }, ["読めない"]), `${nameOf(i.id)} — ${i.problems.join(" / ")}`);
        ul.append(li);
      }
      modal.append(ul);
    }

    const actions = h("div", { class: "modal-actions" });
    const cancel = h("button", { class: "btn", type: "button" }, ["閉じる"]);
    cancel.addEventListener("click", closeModal);
    actions.append(cancel);
    if (plan.fixes.length > 0) {
      const ok = h("button", { class: "btn primary", type: "button" }, ["実行"]);
      ok.addEventListener("click", async () => {
        await store.reconcile(state.graph, plan);
        recompute();
        closeModal();
        render();
        toast(summarize(plan));
      });
      actions.append(ok);
    }
    modal.append(actions);
    openModal();
  };

  // ---- 描画 --------------------------------------------------------------
  const renderSidebar = (): void => {
    const actionableCount = countActionable(state.graph, state.cycles);
    const nav = el<HTMLButtonElement>("nav-actionable");
    nav.replaceChildren();
    // 俯瞰は「全体の今やれること」ではないので、ここは点かない。
    const onTopList = state.mode === "list" && state.query === "" && !state.scopeId;
    nav.className = `nav-item${onTopList && !state.recent ? " active" : ""}`;
    nav.append(iconSpan("listChecks", 15), document.createTextNode("今やれること"));
    nav.append(h("span", { class: "count" }, [String(actionableCount)]));
    nav.onclick = () => {
      state.query = "";
      searchInput.value = "";
      goList();
    };

    // 再開の手がかり（2026-09-14）。件数は出さない——「今やれること」の数は
    // 判断に使うが、書き換わった件数は何も決めない（数字は判断に使うものだけ）。
    const recentNav = el<HTMLButtonElement>("nav-recent");
    recentNav.replaceChildren();
    recentNav.className = `nav-item${onTopList && state.recent ? " active" : ""}`;
    recentNav.append(iconSpan("clock", 15), document.createTextNode("最近の変更"));
    recentNav.onclick = () => goList(undefined, true);

    const list = el("root-list");
    clear(list);
    // 並べるのは地図と入口ファイルと同じ「ゴール」（2026-09-14）。入次数0で
    // 拾っていた頃は、地図から外した終わらない根が居座り、中腹に宣言した
    // ゴールは出なかった——「ゴール」の答えが画面ごとに違っていた。
    const rootIds = state.goals.ids;
    if (rootIds.length === 0) {
      const empty = h("div", { class: "empty", style: "padding:12px 4px;font-size:12px" });
      // ノードはあるのにゴールが無いのは、根を全部地図から外したとき。
      // 「まだ無い」と言うと、作ったものが消えたように読める。
      const hasNodes = Object.keys(state.graph.nodes).length > 0;
      empty.append(h("div", {}, [hasNodes ? "地図に出している目的がありません" : "まだ目的がありません"]));
      // 文言だけ出して終わらない。ここが起動直後の画面なので、次の操作が
      // 同じ場所に無いと手が止まる。
      const make = h("button", { class: "btn", type: "button", style: "margin-top:8px" });
      make.append(iconSpan("plus", 13), "目的を作る");
      make.addEventListener("click", () => openAdd());
      empty.append(make);
      list.append(empty);
      return;
    }
    // 光らせるのは、今いる場所に一番近いゴール。中腹のゴールが並ぶようになったので、
    // 経路の先頭（根）で比べると、潜った先のゴールを押しても根の行が光る。
    const here = state.scopeId ?? state.focusId;
    const activeGoal =
      (state.mode === "graph" || state.scopeId) && here
        ? [...state.trail, here].reverse().find((id) => rootIds.includes(id))
        : undefined;
    for (const id of rootIds) {
      const p = progress(state.graph, id);
      const btn = h("button", {
        class: `root-item${activeGoal === id ? " active" : ""}`,
        type: "button",
      });
      // 付箋は状態ドットの手前、行の縁に細く出す。丸（状態）と棒（付箋）で
      // 形を分けてある——同じ形で色だけ違うと、2種類の色の意味が混ざる。
      const tag = state.graph.nodes[id]?.color;
      if (isGoalColor(tag)) btn.append(h("span", { class: `goal-tag goal-tag-${tag}` }));
      btn.append(stateDot(resolveState(state.graph, id, state.cycles.cyclic)));
      btn.append(h("span", {}, [state.graph.nodes[id]?.name ?? id]));
      btn.append(h("span", { class: "count" }, [`${p.done}/${p.total}`]));
      btn.addEventListener("click", () => focusFresh(id));
      list.append(btn);
    }
  };

  const renderBreadcrumb = (): void => {
    const bar = el("breadcrumb");
    clear(bar);

    /** 一覧とグラフを行き来する切り替え。パンくずの右端に置く。
     *
     * 同じ場所で往復するので、押した後に別の場所へ戻る形にはしない。
     * 文字だけにしてあるのは、この行の左側（「今やれること」）が既に
     * 文字ボタンで、アイコンを1つだけ混ぜると語彙が増えるため。 */
    // 切り替えのボタンは1つの入れ物にまとめて右端へ寄せる。ボタンごとに右寄せを
    // 掛けると、2つ（俯瞰・地図）のときに余った幅を分け合って「俯瞰」が行の
    // 真ん中に浮き、狭い窓では片方だけが次の行の左端へ折り返した（のっち 2026-09-14）。
    let actions: HTMLElement | undefined;
    const appendToggle = (label: string, onClick: () => void): void => {
      const btn = h("button", { class: "crumb-toggle", type: "button" }, [label]);
      btn.addEventListener("click", () => {
        if (Date.now() - lastSwitchAt < DOUBLE_TAP_GUARD_MS) return;
        lastSwitchAt = Date.now();
        onClick();
      });
      if (!actions) {
        actions = h("span", { class: "crumb-actions" });
        bar.append(actions);
      }
      actions.append(btn);
    };

    const appendSep = (): void => {
      bar.append(h("span", { class: "sep" }, []));
      bar.lastElementChild!.append(iconSpan("chevronRight", 12));
    };

    /** 辿ってきた道を、その地点のグラフへ戻るボタンとして並べる。
     *
     * 俯瞰でも同じものを出す——絞る対象が変わっても**今どこにいるか**は
     * 変わらないので、ここだけ道が消えると「どこの配下を見ているのか」の
     * 手がかりが `◯◯ の配下` の1語だけになる。 */
    const appendTrail = (): void => {
      const home = h("button", { type: "button" }, ["今やれること"]);
      home.addEventListener("click", () => goList());
      bar.append(home);
      state.trail.forEach((id, i) => {
        appendSep();
        const btn = h("button", { type: "button" }, [state.graph.nodes[id]?.name ?? id]);
        btn.addEventListener("click", () => {
          state.trail = state.trail.slice(0, i);
          state.focusId = id;
          state.selectedId = id;
          state.scopeId = undefined;
          state.mode = "graph";
          render();
        });
        bar.append(btn);
      });
    };

    if (state.mode === "list") {
      const scopeId = state.scopeId;
      const scope = scopeId ? state.graph.nodes[scopeId] : undefined;
      if (scopeId && scope) {
        appendTrail();
        appendSep();
        bar.append(h("span", { class: "current" }, [`${scope.name} の配下`]));
        appendToggle("グラフ", () => {
          state.mode = "graph";
          state.scopeId = undefined;
          state.focusId = scopeId;
          render();
        });
        return;
      }
      bar.append(
        h("span", { class: "current" }, [
          state.query !== "" ? `「${state.query}」の検索結果` : state.recent ? "最近の変更" : "今やれること",
        ]),
      );
      return;
    }

    appendTrail();
    const onMap = state.layer === "goals";
    if (state.focusId || onMap) {
      appendSep();
      const current = h("span", { class: "current" }, []);
      // 縮尺を文字で言う。押せるものが「グラフ」しか無い状態からでも推測は
      // できるが、半年ぶりに開いた人には推測させない。
      if (onMap) current.append(h("span", { class: "crumb-layer" }, ["地図"]));
      // 現在地が無いことがある（上にゴールが1つも無い場所から上がったとき）。
      // **無関係なゴールの名前を置くより「全体」と言う方が嘘が無い。**
      const name = state.focusId ? (state.graph.nodes[state.focusId]?.name ?? state.focusId) : undefined;
      current.append(document.createTextNode(name ?? "全体"));
      bar.append(current);
    }
    const focusId = state.focusId;
    if (state.layer === "goals") {
      // 地図では俯瞰を出さない。**同じ場所で往復する**のがこの切り替えの決まりで、
      // 地図 →俯瞰 →グラフ と渡ると、押した覚えのない縮尺に降りている。
      appendToggle("グラフ", () => goDetail());
      return;
    }
    // 今いる地点の配下を俯瞰する。目的で押せば目的の配下、潜った先で押せば
    // その枝の配下——グラフが「1クリック1階層」なのに対して、こちらは
    // 今いる場所から下を一息に見る。
    if (focusId) appendToggle("俯瞰", () => goList(focusId));
    // ゴールだけの地図へ上がる（「もっと俯瞰」）。俯瞰が「ここから下を一息に」
    // なのに対して、こちらは**間のノードを畳んでゴールだけを浮上させる**。
    if (focusId) appendToggle("地図", () => goMap());
  };

  const renderCenter = (): void => {
    const body = el("center-body");
    // グラフは表示窓の中で拡大縮小・移動する。外側の余白とスクロールが
    // 残っているとスクロールが二重になるので、モードで切り替える。
    // 地図は現在地が無くても描く（上にゴールが無い場所から上がったとき）。
    const graphMode = state.mode === "graph" && (!!state.focusId || state.layer === "goals");
    body.classList.toggle("graph", graphMode);
    if (graphMode) {
      // 地図では**描くグラフと状態を引くグラフが違う**。商グラフの上で状態を
      // 導くと、畳んだぶんだけ前提が消えて「今やれる」に見える。
      const map = state.layer === "goals";
      const drawn = map ? state.goals.graph : state.graph;
      const rev = map ? state.goals.rev : state.rev;
      renderGraph(
        body,
        drawn,
        state.focusId,
        rev,
        state.cycles.cyclic,
        { onSelect: select, onDrill: drill, onAscend: ascend, onInsert: openInsert, onMenu: openMenu },
        state.selectedId,
        map ? { stateGraph: state.graph, between: state.goals.between, roots: mapSeeds(state.goals) } : undefined,
      );
      return;
    }
    // 検索は常に全体にかける。検索欄はヘッダーにある全体の道具なので、
    // 俯瞰中だけ効き方が変わると、同じ場所で違う結果が出ることになる。
    const scopeId = state.query === "" ? state.scopeId : undefined;
    const scope = scopeId ? state.graph.nodes[scopeId] : undefined;
    const recent = state.query === "" && !scopeId && state.recent;
    const result = (() => {
      if (state.query !== "") return search(state.graph, state.rev, { query: state.query, cycles: state.cycles });
      if (!recent) return nextActions(state.graph, state.rev, { cycles: state.cycles, ...(scopeId ? { under: scopeId } : {}) });
      // 30件に切ってから並べ替える。先に並べ替えると「最近」の一覧ではなくなる。
      const r = recentlyChanged(state.graph, state.rev, { cycles: state.cycles, limit: RECENT_LIMIT });
      return { ...r, hits: sortRecentHits(state.graph, r.hits, state.recentSort) };
    })();
    renderList(
      body,
      state.graph,
      result,
      {
        title: state.query !== "" ? "検索結果" : recent ? "最近の変更" : "今やれること",
        query: state.query,
        ...(scope ? { scoped: true } : {}),
        ...(recent ? { recent: true, recentSort: state.recentSort } : {}),
      },
      {
        // 同じ列をもう一度押したら向きを返す。別の列に移ったら、その列の読みやすい
        // 向きから始める——更新日は新しい順、それ以外は昇順（状態なら今やれるものが先頭）。
        onSort: (key) => {
          const cur = state.recentSort;
          state.recentSort =
            cur.key === key
              ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
              : { key, dir: key === "mtime" ? "desc" : "asc" };
          render();
        },
        onSelect: (id) => {
          select(id);
          // 俯瞰から選んだときは、絞っていた目的を経路に残す。ここで経路ごと
          // 捨てると、俯瞰で見つけた枝から目的へ戻れなくなる。
          if (scopeId && scopeId !== id) {
            state.trail = [scopeId];
            state.focusId = id;
            state.selectedId = id;
            state.mode = "graph";
            state.scopeId = undefined;
            render();
            return;
          }
          openInContext(id);
        },
        onDecompose: (cycle) => openBulkAdd(cycle[0]!),
      },
    );
  };

  /** 前回描いたときに選んでいたもの。**選び直しの検出をここ1箇所に寄せる**——
   *  選択を動かす経路は7つある（選ぶ・潜る・戻る・入口から開く・一覧・地図・復元）
   *  ので、経路ごとに書くと必ずどれかが漏れる。 */
  let lastSelected: string | undefined = state.selectedId;
  /** 初回起動のチュートリアル。描き直しの終点で進み具合を見る（`tutorial.ts`）。 */
  let tutorial: Tutorial | undefined;

  const render = (): void => {
    // 描き直しはすべての操作の終点なので、場所の保存もここに1つ置けば足りる。
    savePlace(state);
    // 別のノードを開いたら、メモは読む顔に戻す。書きかけのものは `blur` で
    // 保存されるので消えない（保存の経路は編集欄と「閲覧」ボタンの2つだけ）。
    if (state.selectedId !== lastSelected) {
      lastSelected = state.selectedId;
      state.insp.noteEditing = false;
    }
    // 中身の一覧はホバー元の要素にぶら下がっている。描き直すとその要素ごと
    // 消えるので、ここで閉じる。グラフの描画側だけで閉じていると、一覧へ
    // 切り替えたときに宙に浮いたまま残った（2026-09-02）。
    hideFlyout();
    // 右クリックのメニューも閉じる。押した項目の側では先に閉じているが、外の
    // 編集を拾った描き直し（`watchNodes`）で残ることがある。
    closeContextMenu();
    // 何も選んでいない間はインスペクタごと畳む。起動直後は「どれをやるか選ぶ」
    // 段階で、まだ詳細を見る相手がいない。空のパネルで画面の3割を占めるより、
    // 一覧に幅を渡す方がこの画面の仕事に合っている。
    // 地図に載っていないものが現在地になっていたら、黙って詳細へ落とす。
    // ゴール宣言を外した・親が付いた・外でファイルが変わった、のどれでも起きる。
    // **現在地が無いのは地図では普通**（上にゴールが1つも無い場所から上がった
    // とき）なので、そこでは落とさない——落とすと地図そのものが消える。
    if (state.layer === "goals" && state.focusId !== undefined && !state.goals.graph.nodes[state.focusId]) {
      state.layer = "detail";
    }
    // 一覧は地図の縮尺を持たない。`goList` で同じことをしているが、削除で焦点が
    // 消えて一覧へ落ちる経路など、そこを通らない道がある。
    if (state.mode === "list") state.layer = "detail";
    document.body.classList.toggle("no-inspector", !state.selectedId || !state.graph.nodes[state.selectedId]);
    renderIssueBadge();
    renderUndoBtn();
    renderSidebar();
    renderBreadcrumb();
    renderCenter();
    renderInspector(el("inspector"), state.graph, state.selectedId, state.rev, state.cycles.cyclic, {
      onToggle: (id) => void toggle(id),
      onFocus: focusFresh,
      onBulkAdd: openBulkAdd,
      onNoteChange: (id, note) => void saveNote(id, note),
      onRename: (id, name) => void rename(id, name),
      onDelete: (id) => void removeNode(id),
      onColor: (id, color) => void setColor(id, color),
      onGoal: (id, on) => void setGoal(id, on),
      onMenu: openMenu,
      onMore: (open) => {
        state.insp.moreOpen = open;
        render();
      },
      onNoteEdit: (editing) => {
        state.insp.noteEditing = editing;
        render();
      },
    }, state.insp);
    tutorial?.update();
  };

  render();
  syncMocs(); // 起動時に1回。前回の終了後に手で書き換えられていても追いつく。

  tutorial = createTutorial(
    {
      graph: () => state.graph,
      cyclic: () => state.cycles.cyclic,
      selectedId: () => state.selectedId,
      // 片付けの「まとめて削除」。1件ずつの削除と違って戻す控えは作らない——
      // 確認のうえで押されたものなので、ここで戻せる必要は無い。手前で自分で
      // 消した1件の控えも捨てる（残すと、消えた相手を指したノードが戻ってくる）。
      deleteNodes: async (ids) => {
        for (const id of ids) {
          if (state.graph.nodes[id]) await store.deleteNode(state.graph, id);
        }
        lastUndo = undefined;
        if (state.focusId && !state.graph.nodes[state.focusId]) state.focusId = undefined;
        if (state.selectedId && !state.graph.nodes[state.selectedId]) state.selectedId = undefined;
        state.trail = state.trail.filter((t) => state.graph.nodes[t]);
        recompute();
        if (!state.focusId) state.mode = "list";
        render();
      },
    },
    (message) => toast(message),
  );
  el<HTMLButtonElement>("tour-btn").addEventListener("click", () => tutorial?.start());
  // 空の vault を開いたときだけ自動で始める。既にデータがある人には出さない。
  if (Object.keys(state.graph.nodes).length === 0 && !readTourDone()) tutorial.start();

  return {
    async reload() {
      const fresh = await store.load();
      state.graph = fresh.graph;
      state.issues = fresh.issues;
      // 選択・フォーカスしていたノードが外部で消えていることがある。
      if (state.focusId && !state.graph.nodes[state.focusId]) {
        state.focusId = undefined;
        state.trail = [];
        state.mode = "list";
      }
      if (state.selectedId && !state.graph.nodes[state.selectedId]) state.selectedId = undefined;
      state.trail = state.trail.filter((id) => state.graph.nodes[id]);
      recompute();
      render();
    },
  };
}
