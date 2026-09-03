// アプリ本体の配線。
//
// サーバは無い。ストアもエンジンもここ（フロント）で動き、ファイルアクセスだけ
// `SirubeFs` の実装を差し替える（開発中はメモリ、Tauri ではプラグイン fs）。

import { analyzeCycles, buildReverseIndex, progress, resolveState, roots, type CycleInfo, type ReverseIndex } from "../core/engine.ts";
import { isGoalColor, type GoalColor, type Graph } from "../core/model.ts";
import { parseDsl } from "../core/dsl.ts";
import { normalizeForDuplicateCheck, planReconcile, summarize, type ReconcilePlan } from "../core/reconcile.ts";
import { countActionable, nextActions, pathFromRoot, search } from "../core/search.ts";
import type { SirubeFs } from "../store/fs.ts";
import { MarkdownGraphStore } from "../store/store.ts";
import { clear, el, h, iconSpan, stateDot, toast } from "./dom.ts";
import { hideFlyout } from "./flyout.ts";
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
  /** 一覧をこのノードの配下だけに絞る（目的の「俯瞰」）。
   *
   * 一覧は俯瞰モードであって潜る画面ではない（2026-09-02 のっち）。だから
   * 目的の入口はこれまでどおり Chain View のままで、俯瞰はそこから切り替える
   * ——入口を差し替えると、分解しに行く導線が1クリック遠くなる。 */
  scopeId?: string;
}

export interface AppHandle {
  /** ファイルが外部から変わったときに呼ぶ。選択・フォーカスは保ったまま読み直す。
   *
   * 入口が複数ある（エディタ / Obsidian / エージェント / git のマージ）以上、
   * 画面が古いまま次の保存で他人の作業を消すのが一番まずい。file watch から
   * これを叩く。 */
  reload(): Promise<void>;
}

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
  focusId?: string;
  trail: string[];
  scopeId?: string;
}

function savePlace(state: AppState): void {
  const place: SavedPlace = {
    mode: state.mode,
    ...(state.focusId ? { focusId: state.focusId } : {}),
    trail: state.trail,
    ...(state.scopeId ? { scopeId: state.scopeId } : {}),
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

  if (saved.mode === "graph" && alive(saved.focusId)) {
    state.mode = "graph";
    state.focusId = saved.focusId;
    // グラフに立つときは必ず何かを選んでいる（潜る操作が両方を同時に置く）。
    // 復元でもそれを崩さない。崩すと、詳細パネルだけ空のグラフ画面ができる。
    state.selectedId = saved.focusId;
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

export async function startApp(fs: SirubeFs, options: AppOptions = {}): Promise<AppHandle> {
  const store = new MarkdownGraphStore(fs);
  const { graph, issues } = await store.load();

  const state: AppState = {
    graph,
    rev: buildReverseIndex(graph),
    cycles: analyzeCycles(graph),
    mode: "list",
    query: "",
    trail: [],
    issues,
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
    state.cycles = analyzeCycles(state.graph);
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
  newRootBtn.addEventListener("click", () => openNewGoal());

  const importBtn = el<HTMLButtonElement>("import-btn");
  importBtn.replaceChildren(iconSpan("plus", 14), document.createTextNode("まとめて追加"));
  importBtn.addEventListener("click", () => openImport());

  const reconcileBtn = el<HTMLButtonElement>("reconcile-btn");
  reconcileBtn.replaceChildren(iconSpan("wandSparkles", 14), document.createTextNode("自動解決"));
  reconcileBtn.addEventListener("click", () => openReconcile());
  // ファイルの問題だけはボタンに件数を出す。トーストは消えるので、
  // 起動直後に見ていないと二度と気づけない。プランの件数を出さないのは、
  // 描画のたびに Tarjan と収束ループを回すことになるため。
  const renderIssueBadge = (): void => {
    reconcileBtn.querySelector(".count")?.remove();
    if (state.issues.length > 0) {
      reconcileBtn.append(h("span", { class: "count" }, [String(state.issues.length)]));
    }
  };

  // ---- 操作 --------------------------------------------------------------
  /** 画面に出す名前。id は ULID なので、そのまま出すと読めない
   *  （2026-09-01 の id/name 分離のあと、3箇所が素の id を出していた）。
   *  ノードが既に消えている場合だけ id に落ちる。 */
  const nameOf = (id: string): string => state.graph.nodes[id]?.name ?? id;

  const select = (id: string): void => {
    state.selectedId = id;
    render();
  };

  const drill = (id: string): void => {
    if (!state.graph.nodes[id]) return;
    if (state.focusId && state.focusId !== id) state.trail.push(state.focusId);
    state.focusId = id;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  const focusFresh = (id: string): void => {
    // 入口が3つ（サイドバーの目的・一覧の行・インスペクタの上向きリンク）ある
    // ので、`drill` と同じ番人をここにも置く。今はどの経路も実在するノードしか
    // 渡さないが、片方にだけ番人がある状態は次に入口が増えたときに破れる。
    if (!state.graph.nodes[id]) return;
    // 「この目的から見直す」入口なので、拡大率と位置も初期に戻す。潜って移った
    // ときと違い、ここは同じノードを選び直すことがある。
    resetViewport();
    // 目的からの経路をパンくずに積む。一覧から飛ぶと、**それが目的の中のどこ
    // なのか画面のどこにも出ていなかった**（のっち報告 2026-09-03）。目的そのもの
    // を押したときは経路が空なので、これまでどおり1段だけになる。
    state.trail = pathFromRoot(state.graph, state.rev, id);
    state.focusId = id;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  const goList = (scopeId?: string): void => {
    state.mode = "list";
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

  const toggle = async (id: string): Promise<void> => {
    const changed = await store.toggle(state.graph, id);
    recompute();
    render();
    if (changed.length > 1) toast(`${changed.length} 件が連動して変わりました`);
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
    await store.deleteNode(state.graph, id);
    if (state.focusId === id) state.focusId = undefined;
    if (state.selectedId === id) state.selectedId = undefined;
    state.trail = state.trail.filter((t) => t !== id);
    recompute();
    if (!state.focusId) state.mode = "list";
    render();
    toast(`「${name}」を削除しました`);
  };

  // ---- モーダル ----------------------------------------------------------
  const backdrop = el("modal-backdrop");
  const modal = el("modal");
  const closeModal = (): void => backdrop.classList.add("hidden");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
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
    backdrop.classList.remove("hidden");
  };

  /** 新しい目的を1つ起こす。
   *
   * 空の vault ではノードが1つも無く、選択も無いので、インスペクタ側の
   * 「前提を一括追加」には辿り着けない——**最初の1個を作る道がそこしか無いと
   * 詰む**（2026-08-31 に懸念として記録し、2026-09-01 にコードで確認した）。
   * サイドバーの見出しに常設し、0件のときは空表示からも同じ操作を出す。
   *
   * ここで作るのは「目的」だが、モデル上はただのノード（`type` は無い）。
   * ルートかどうかは入次数0から導かれるので、後から誰かの前提として繋がれば
   * 自然に目的ではなくなる。 */
  const openNewGoal = (): void => {
    clear(modal);
    modal.append(h("h3", {}, ["新しい目的"]));
    modal.append(
      h("p", { class: "hint" }, [
        "達成したいことを1つ書く。分解（何が必要か）は作ったあとで足せる。Enter で作成。",
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
    backdrop.classList.remove("hidden");
    input.focus();
  };

  /**
   * DSL でまとめて構造を作る。
   *
   * 「前提を一括追加」が1つのノードの下に `requires` をフラットに生やすのに対し、
   * こちらは**入れ子と合流を含む形をそのまま書き下す**ための入口。パーサ
   * （`parseDsl`）もストア側（`importDsl`）も先にあったのに画面から呼ぶ道が無く、
   * `AGENTS.md` はエージェントへ「アプリの一括生成に貼る」と案内していた——
   * 存在しないドアを案内している状態だった（2026-09-02 の棚卸しで発覚）。
   */
  const openImport = (): void => {
    clear(modal);
    modal.append(h("h3", {}, ["まとめて追加"]));
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
    });
    actions.append(cancel, ok);
    modal.append(actions);
    backdrop.classList.remove("hidden");
    ta.focus();
  };

  const openBulkAdd = (targetId: string): void => {
    clear(modal);
    modal.append(h("h3", {}, [`「${nameOf(targetId)}」には何が必要？`]));
    modal.append(
      h("p", { class: "hint" }, [
        "1行に1つ書く。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。Ctrl+Enter で追加。",
      ]),
    );
    const ta = h("textarea", { placeholder: "引っ越し先の家\nお金を貯める\n不動産に行く" }) as HTMLTextAreaElement;
    modal.append(ta);

    const preview = h("div", { class: "hint", style: "margin-top:8px;font-size:12px" });
    const updatePreview = (): void => {
      const lines = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      preview.textContent = lines.length === 0 ? "" : `${lines.length} 件の前提を追加します`;
    };
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
      const res = await store.addBulkRequires(state.graph, targetId, ta.value);
      if (res.errors.length > 0) {
        toast(res.errors[0]!.message);
        return;
      }
      recompute();
      closeModal();
      focusFresh(targetId);
      toast(`${res.created.length} 件を追加しました`);
    });
    actions.append(cancel, ok);
    modal.append(actions);
    backdrop.classList.remove("hidden");
    ta.focus();
  };

  /** 自動解決。宣言して実行し、残りを報告する。 */
  const openReconcile = (): void => {
    const plan: ReconcilePlan = planReconcile(state.graph);
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
          li.append(h("span", { class: "plan-kind" }, ["輪"]), `${u.nodes.map(nameOf).join(" → ")} → …（分解が要る）`);
        } else if (u.kind === "near-duplicate") {
          li.append(h("span", { class: "plan-kind" }, ["表記ゆれ"]), u.ids.map(nameOf).join(" / "));
        } else if (u.kind === "contains-cycle") {
          li.append(
            h("span", { class: "plan-kind" }, ["内包の輪"]),
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
    backdrop.classList.remove("hidden");
  };

  // ---- 描画 --------------------------------------------------------------
  const renderSidebar = (): void => {
    const actionableCount = countActionable(state.graph, state.cycles);
    const nav = el<HTMLButtonElement>("nav-actionable");
    nav.replaceChildren();
    // 俯瞰は「全体の今やれること」ではないので、ここは点かない。
    nav.className = `nav-item${state.mode === "list" && state.query === "" && !state.scopeId ? " active" : ""}`;
    nav.append(iconSpan("listChecks", 15), document.createTextNode("今やれること"));
    nav.append(h("span", { class: "count" }, [String(actionableCount)]));
    nav.onclick = () => {
      state.query = "";
      searchInput.value = "";
      goList();
    };

    const list = el("root-list");
    clear(list);
    const rootIds = roots(state.graph, state.rev);
    if (rootIds.length === 0) {
      const empty = h("div", { class: "empty", style: "padding:12px 4px;font-size:12px" });
      empty.append(h("div", {}, ["まだ目的がありません"]));
      // 文言だけ出して終わらない。ここが起動直後の画面なので、次の操作が
      // 同じ場所に無いと手が止まる。
      const make = h("button", { class: "btn", type: "button", style: "margin-top:8px" });
      make.append(iconSpan("plus", 13), "目的を作る");
      make.addEventListener("click", () => openNewGoal());
      empty.append(make);
      list.append(empty);
      return;
    }
    for (const id of rootIds) {
      const p = progress(state.graph, id);
      const btn = h("button", {
        class: `root-item${(state.mode === "graph" || state.scopeId) && (state.trail[0] ?? state.focusId) === id ? " active" : ""}`,
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
    const appendToggle = (label: string, onClick: () => void): void => {
      const btn = h("button", { class: "crumb-toggle", type: "button" }, [label]);
      btn.addEventListener("click", onClick);
      bar.append(btn);
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
      bar.append(h("span", { class: "current" }, [state.query === "" ? "今やれること" : `「${state.query}」の検索結果`]));
      return;
    }

    appendTrail();
    if (state.focusId) {
      appendSep();
      bar.append(h("span", { class: "current" }, [state.graph.nodes[state.focusId]?.name ?? state.focusId]));
    }
    // 今いる地点の配下を俯瞰する。目的で押せば目的の配下、潜った先で押せば
    // その枝の配下——グラフが「1クリック1階層」なのに対して、こちらは
    // 今いる場所から下を一息に見る。
    const focusId = state.focusId;
    if (focusId) appendToggle("俯瞰", () => goList(focusId));
  };

  const renderCenter = (): void => {
    const body = el("center-body");
    // グラフは表示窓の中で拡大縮小・移動する。外側の余白とスクロールが
    // 残っているとスクロールが二重になるので、モードで切り替える。
    body.classList.toggle("graph", state.mode === "graph" && !!state.focusId);
    if (state.mode === "graph" && state.focusId) {
      renderGraph(body, state.graph, state.focusId, state.rev, state.cycles.cyclic, { onSelect: select, onDrill: drill }, state.selectedId);
      return;
    }
    // 検索は常に全体にかける。検索欄はヘッダーにある全体の道具なので、
    // 俯瞰中だけ効き方が変わると、同じ場所で違う結果が出ることになる。
    const scopeId = state.query === "" ? state.scopeId : undefined;
    const scope = scopeId ? state.graph.nodes[scopeId] : undefined;
    const result =
      state.query === ""
        ? nextActions(state.graph, state.rev, { cycles: state.cycles, ...(scopeId ? { under: scopeId } : {}) })
        : search(state.graph, state.rev, { query: state.query, cycles: state.cycles });
    renderList(
      body,
      state.graph,
      result,
      {
        title: state.query === "" ? "今やれること" : "検索結果",
        query: state.query,
        ...(scope ? { scoped: true } : {}),
      },
      {
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
          focusFresh(id);
        },
        onDecompose: (cycle) => openBulkAdd(cycle[0]!),
      },
    );
  };

  const render = (): void => {
    // 描き直しはすべての操作の終点なので、場所の保存もここに1つ置けば足りる。
    savePlace(state);
    // 中身の一覧はホバー元の要素にぶら下がっている。描き直すとその要素ごと
    // 消えるので、ここで閉じる。グラフの描画側だけで閉じていると、一覧へ
    // 切り替えたときに宙に浮いたまま残った（2026-09-02）。
    hideFlyout();
    // 何も選んでいない間はインスペクタごと畳む。起動直後は「どれをやるか選ぶ」
    // 段階で、まだ詳細を見る相手がいない。空のパネルで画面の3割を占めるより、
    // 一覧に幅を渡す方がこの画面の仕事に合っている。
    document.body.classList.toggle("no-inspector", !state.selectedId || !state.graph.nodes[state.selectedId]);
    renderIssueBadge();
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
    });
  };

  render();
  syncMocs(); // 起動時に1回。前回の終了後に手で書き換えられていても追いつく。

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
