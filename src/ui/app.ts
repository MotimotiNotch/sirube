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

  /** 前提の一括追加。分解の流れに直結する MVP の中核。 */
  const openBulkAdd = (targetId: string): void => {
    clear(modal);
    modal.append(h("h3", {}, [`「${targetId}」には何が必要？`]));
    modal.append(
      h("p", { class: "hint" }, [
        "1行に1つ書く。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。",
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
