// アプリ本体の配線。
//
// サーバは無い。ストアもエンジンもここ（フロント）で動き、ファイルアクセスだけ
// `SirubeFs` の実装を差し替える（開発中はメモリ、Tauri ではプラグイン fs）。

import { buildReverseIndex, cyclicNodes, progress, resolveState, roots, type ReverseIndex } from "../core/engine.ts";
import type { Graph } from "../core/model.ts";
import { planReconcile, summarize, type ReconcilePlan } from "../core/reconcile.ts";
import { nextActions, search } from "../core/search.ts";
import type { SirubeFs } from "../store/fs.ts";
import { MarkdownGraphStore } from "../store/store.ts";
import { clear, el, h, iconSpan, stateDot, toast } from "./dom.ts";
import { renderGraph } from "./graph-view.ts";
import { renderInspector } from "./inspector.ts";
import { renderList } from "./list-view.ts";

interface AppState {
  graph: Graph;
  rev: ReverseIndex;
  cyclic: Set<string>;
  mode: "list" | "graph";
  focusId?: string;
  selectedId?: string;
  query: string;
  /** ドリルダウンの経路。パンくずと「戻る」に使う。 */
  trail: string[];
}

export interface AppHandle {
  /** ファイルが外部から変わったときに呼ぶ。選択・フォーカスは保ったまま読み直す。
   *
   * 入口が複数ある（エディタ / Obsidian / エージェント / git のマージ）以上、
   * 画面が古いまま次の保存で他人の作業を消すのが一番まずい。file watch から
   * これを叩く。 */
  reload(): Promise<void>;
}

export async function startApp(fs: SirubeFs): Promise<AppHandle> {
  const store = new MarkdownGraphStore(fs);
  const { graph, issues } = await store.load();

  const state: AppState = {
    graph,
    rev: buildReverseIndex(graph),
    cyclic: cyclicNodes(graph),
    mode: "list",
    query: "",
    trail: [],
  };

  if (issues.length > 0) {
    toast(`${issues.length} 件のファイルに読み取り上の問題があります`);
  }

  // ---- 再計算 ------------------------------------------------------------
  const recompute = (): void => {
    state.rev = buildReverseIndex(state.graph);
    state.cyclic = cyclicNodes(state.graph);
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

  const reconcileBtn = el<HTMLButtonElement>("reconcile-btn");
  reconcileBtn.replaceChildren(iconSpan("wandSparkles", 14), document.createTextNode("自動解決"));
  reconcileBtn.addEventListener("click", () => openReconcile());

  // ---- 操作 --------------------------------------------------------------
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
    state.trail = [];
    state.focusId = id;
    state.selectedId = id;
    state.mode = "graph";
    render();
  };

  const goList = (): void => {
    state.mode = "list";
    render();
  };

  const toggle = async (id: string): Promise<void> => {
    const changed = await store.toggle(state.graph, id);
    recompute();
    render();
    if (changed.length > 1) toast(`${changed.length} 件が連動して変わりました`);
  };

  const saveNote = async (id: string, note: string): Promise<void> => {
    const node = state.graph.nodes[id];
    if (!node) return;
    node.note = note;
    await store.persist(state.graph, [id]);
    toast("メモを保存しました");
  };

  const removeNode = async (id: string): Promise<void> => {
    await store.deleteNode(state.graph, id);
    if (state.focusId === id) state.focusId = undefined;
    if (state.selectedId === id) state.selectedId = undefined;
    state.trail = state.trail.filter((t) => t !== id);
    recompute();
    if (!state.focusId) state.mode = "list";
    render();
    toast(`「${id}」を削除しました`);
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
  const openBulkAdd = (targetId: string): void => {
    clear(modal);
    modal.append(h("h3", {}, [`「${targetId}」には何が必要？`]));
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

    if (plan.fixes.length === 0 && plan.unresolved.length === 0) {
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
      for (const f of plan.fixes) {
        const li = h("li");
        switch (f.kind) {
          case "satisfy-prerequisite":
            li.append(h("span", { class: "plan-kind" }, ["前提を埋める"]), `${f.prerequisite}（${f.node} の方が新しい）`);
            break;
          case "unsatisfy-node":
            li.append(h("span", { class: "plan-kind" }, ["達成を戻す"]), `${f.node}（${f.prerequisite} の方が新しい）`);
            break;
          case "satisfy-contains-parent":
            li.append(h("span", { class: "plan-kind" }, ["親を達成に"]), `${f.parent}（子が全部揃った）`);
            break;
          case "create-missing-node":
            li.append(h("span", { class: "plan-kind" }, ["空ノード作成"]), `${f.id}（${f.referencedBy.join(", ")} が参照）`);
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
          li.append(h("span", { class: "plan-kind" }, ["輪"]), `${u.nodes.join(" → ")} → …（分解が要る）`);
        } else if (u.kind === "near-duplicate") {
          li.append(h("span", { class: "plan-kind" }, ["表記ゆれ"]), u.ids.join(" / "));
        } else {
          li.append(h("span", { class: "plan-kind" }, ["時刻が同着"]), `${u.node} と ${u.prerequisite}`);
        }
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
    const actionableCount = nextActions(state.graph, state.rev).total;
    const nav = el<HTMLButtonElement>("nav-actionable");
    nav.replaceChildren();
    nav.className = `nav-item${state.mode === "list" && state.query === "" ? " active" : ""}`;
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
      list.append(h("div", { class: "empty", style: "padding:12px 4px;font-size:12px" }, ["まだ目的がありません"]));
      return;
    }
    for (const id of rootIds) {
      const p = progress(state.graph, id);
      const btn = h("button", {
        class: `root-item${state.mode === "graph" && (state.trail[0] ?? state.focusId) === id ? " active" : ""}`,
        type: "button",
      });
      btn.append(stateDot(resolveState(state.graph, id, state.cyclic)));
      btn.append(h("span", {}, [state.graph.nodes[id]?.name ?? id]));
      btn.append(h("span", { class: "count" }, [`${p.done}/${p.total}`]));
      btn.addEventListener("click", () => focusFresh(id));
      list.append(btn);
    }
  };

  const renderBreadcrumb = (): void => {
    const bar = el("breadcrumb");
    clear(bar);
    if (state.mode === "list") {
      bar.append(h("span", { class: "current" }, [state.query === "" ? "今やれること" : `「${state.query}」の検索結果`]));
      return;
    }
    const home = h("button", { type: "button" }, ["今やれること"]);
    home.addEventListener("click", goList);
    bar.append(home);
    const path = [...state.trail, state.focusId].filter((x): x is string => !!x);
    path.forEach((id, i) => {
      bar.append(h("span", { class: "sep" }, []));
      bar.lastElementChild!.append(iconSpan("chevronRight", 12));
      if (i === path.length - 1) {
        bar.append(h("span", { class: "current" }, [state.graph.nodes[id]?.name ?? id]));
      } else {
        const btn = h("button", { type: "button" }, [state.graph.nodes[id]?.name ?? id]);
        btn.addEventListener("click", () => {
          state.trail = state.trail.slice(0, i);
          state.focusId = id;
          state.selectedId = id;
          render();
        });
        bar.append(btn);
      }
    });
  };

  const renderCenter = (): void => {
    const body = el("center-body");
    if (state.mode === "graph" && state.focusId) {
      renderGraph(body, state.graph, state.focusId, state.rev, state.cyclic, { onSelect: select, onDrill: drill });
      return;
    }
    const result =
      state.query === ""
        ? nextActions(state.graph, state.rev)
        : search(state.graph, state.rev, { query: state.query });
    renderList(
      body,
      state.graph,
      result,
      { title: state.query === "" ? "今やれること" : "検索結果", query: state.query },
      {
        onSelect: (id) => {
          select(id);
          focusFresh(id);
        },
        onDecompose: (cycle) => openBulkAdd(cycle[0]!),
      },
    );
  };

  const render = (): void => {
    // 何も選んでいない間はインスペクタごと畳む。起動直後は「どれをやるか選ぶ」
    // 段階で、まだ詳細を見る相手がいない。空のパネルで画面の3割を占めるより、
    // 一覧に幅を渡す方がこの画面の仕事に合っている。
    document.body.classList.toggle("no-inspector", !state.selectedId || !state.graph.nodes[state.selectedId]);
    renderSidebar();
    renderBreadcrumb();
    renderCenter();
    renderInspector(el("inspector"), state.graph, state.selectedId, state.rev, state.cyclic, {
      onToggle: (id) => void toggle(id),
      onSelect: select,
      onDrill: drill,
      onBulkAdd: openBulkAdd,
      onNoteChange: (id, note) => void saveNote(id, note),
      onDelete: (id) => void removeNode(id),
    });
  };

  render();

  return {
    async reload() {
      const fresh = await store.load();
      state.graph = fresh.graph;
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
