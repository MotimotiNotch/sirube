// 右パネル。選択中のノードの詳細と、そこからの操作。
//
// ここに置く操作は「分解する」「達成をトグルする」の2つが主役。
// 分解こそがこのツールで人間にしかできないことなので、常に手の届く位置に置く。

import { progress, resolveState, type ReverseIndex } from "../core/engine.ts";
import type { Graph, NodeState } from "../core/model.ts";
import { h, iconSpan, stateBadge, stateDot } from "./dom.ts";

export interface InspectorCallbacks {
  onToggle(id: string): void;
  onSelect(id: string): void;
  onDrill(id: string): void;
  onBulkAdd(id: string): void;
  onNoteChange(id: string, note: string): void;
  onDelete(id: string): void;
}

export function renderInspector(
  container: HTMLElement,
  graph: Graph,
  selectedId: string | undefined,
  rev: ReverseIndex,
  cyclic: ReadonlySet<string>,
  cb: InspectorCallbacks,
): void {
  container.replaceChildren();

  if (!selectedId || !graph.nodes[selectedId]) {
    container.append(h("div", { class: "insp-empty" }, ["ノードを選ぶとここに出ます"]));
    return;
  }
  const node = graph.nodes[selectedId];
  const state: NodeState = resolveState(graph, selectedId, cyclic);

  container.append(h("h3", { class: "insp-name" }, [node.name]));

  const row = h("div", { class: "insp-row" });
  row.append(stateBadge(state));
  if (node.due) row.append(h("span", { class: "hit-indegree" }, [`期限 ${node.due}`]));
  container.append(row);

  // 進捗（自分を含む子孫の達成率）
  const p = progress(graph, selectedId);
  if (p.total > 1) {
    const prow = h("div", { class: "insp-row" });
    const bar = h("div", { class: "progress-bar" });
    bar.append(h("div", { class: "progress-fill", style: `width:${Math.round((p.done / p.total) * 100)}%` }));
    prow.append(bar, h("span", { class: "progress-label" }, [`${p.done}/${p.total}`]));
    container.append(prow);
  }

  // 主要な操作
  const actions = h("div", { class: "insp-row" });
  const toggle = h("button", { class: `btn${state === "SATISFIED" ? "" : " primary"}`, type: "button" });
  toggle.append(iconSpan("circleCheck", 14), state === "SATISFIED" ? "達成を取り消す" : "達成にする");
  toggle.addEventListener("click", () => cb.onToggle(selectedId));
  actions.append(toggle);

  const bulk = h("button", { class: "btn", type: "button" });
  bulk.append(iconSpan("plus", 14), "前提を一括追加");
  bulk.addEventListener("click", () => cb.onBulkAdd(selectedId));
  actions.append(bulk);
  container.append(actions);

  if (state === "CYCLIC") {
    const warn = h("div", { class: "cycle-notice" });
    const t = h("h3");
    t.append(iconSpan("repeat", 14), "輪の上にいます");
    warn.append(t);
    warn.append(
      h("p", {}, [
        "このノードを2つに割ると輪がほどけることがあります（例:「案件を取る」→「小さい案件」「大きい案件」）。「前提を一括追加」で分解できます。",
      ]),
    );
    container.append(warn);
  }

  const linkList = (
    title: string,
    iconName: Parameters<typeof iconSpan>[0],
    ids: string[],
    drill: boolean,
  ): void => {
    if (ids.length === 0) return;
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan(iconName, 12), `${title}（${ids.length}）`);
    sec.append(head);
    const list = h("div", { class: "insp-list" });
    for (const id of ids) {
      const child = graph.nodes[id];
      const btn = h("button", { class: "insp-link", type: "button" });
      btn.append(child ? stateDot(resolveState(graph, id, cyclic)) : stateDot("BLOCKED"));
      btn.append(h("span", {}, [child?.name ?? `${id}（未作成）`]));
      btn.addEventListener("click", () => (drill ? cb.onDrill(id) : cb.onSelect(id)));
      list.append(btn);
    }
    sec.append(list);
    container.append(sec);
  };

  linkList("これが必要（前提）", "cornerDownRight", node.requires, true);
  linkList("これで構成（内包）", "layers", node.contains, true);
  linkList("これを待っている", "listChecks", rev.requiredBy.get(selectedId) ?? [], false);
  linkList("属する先", "chevronRight", rev.containedBy.get(selectedId) ?? [], false);

  // メモ（Markdown 本文そのもの。Obsidian で開いても同じものが見える）
  const noteSec = h("div", { class: "insp-section" });
  const noteHead = h("h4");
  noteHead.append(iconSpan("pencil", 12), "メモ");
  noteSec.append(noteHead);
  const area = h("textarea", { class: "note-area", placeholder: "このノードについてのメモ" }) as HTMLTextAreaElement;
  area.value = node.note;
  area.addEventListener("blur", () => {
    if (area.value !== node.note) cb.onNoteChange(selectedId, area.value);
  });
  noteSec.append(area);
  container.append(noteSec);

  const del = h("button", { class: "btn danger", type: "button", style: "margin-top:18px" });
  del.append(iconSpan("trash2", 14), "このノードを削除");
  del.addEventListener("click", () => cb.onDelete(selectedId));
  container.append(del);
}
