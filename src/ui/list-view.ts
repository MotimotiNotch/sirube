// 検索結果 ＝ 横断 Next Action ビュー。同じ1画面。
//
//   テキストクエリ        → 全文検索
//   空クエリ + ACTIONABLE → 「今やれること」（起動直後の画面）
//
// タグを持たない代わりに、行に**状態とパンくず**を出す。どの目的の下にいるかが
// 見えれば、それがタグの代わりになる。複数並べば合流点＝片付けると2つ進む。

import type { Graph } from "../core/model.ts";
import type { SearchResult } from "../core/search.ts";
import { h, iconSpan, stateBadge } from "./dom.ts";

export interface ListCallbacks {
  onSelect(id: string): void;
  onDecompose(cycleNodes: string[]): void;
}

export function renderList(
  container: HTMLElement,
  graph: Graph,
  result: SearchResult,
  opts: { title: string; query: string },
  cb: ListCallbacks,
): void {
  container.replaceChildren();

  const head = h("div", { class: "list-head" }, []);
  head.append(h("h2", { class: "list-title" }, [opts.title]));
  head.append(h("span", { class: "list-count" }, [`${result.total} 件`]));
  container.append(head);

  // 詰まっている輪は結果より先に出す。「今やれることが空」の理由が
  // 見えないまま終わるのが、このツールで一番まずい失敗の仕方。
  for (const cycle of result.cycles) {
    container.append(cycleNotice(cycle, cb));
  }

  if (result.hits.length === 0) {
    const msg =
      opts.query !== ""
        ? "一致するノードがありません。"
        : result.cycles.length > 0
          ? "今やれることがありません。上の輪をほどくと動き出します。"
          : "今やれることがありません。";
    container.append(h("div", { class: "empty" }, [msg]));
    return;
  }

  for (const hit of result.hits) {
    const node = graph.nodes[hit.id];
    if (!node) continue;

    const card = h("div", { class: "hit" });
    const main = h("button", { class: "hit-main", type: "button" });
    main.append(h("span", { class: "hit-name" }, [node.name]));

    const meta = h("div", { class: "hit-meta" });
    if (hit.inDegree > 1) {
      meta.append(h("span", { class: "hit-indegree", title: `${hit.inDegree} 箇所から要求されている` }, [`合流 ${hit.inDegree}`]));
    }
    if (hit.due) meta.append(h("span", { class: "hit-indegree", title: "期限" }, [hit.due]));
    meta.append(stateBadge(hit.state));
    main.append(meta);
    main.addEventListener("click", () => cb.onSelect(hit.id));
    card.append(main);

    if (hit.breadcrumb.length > 0) {
      const crumb = h("div", { class: "hit-crumb" });
      crumb.append(iconSpan("arrowLeft", 12));
      crumb.append(hit.breadcrumb.join(" / "));
      card.append(crumb);
    }

    if (hit.neighbors) {
      const groups: [string, string[], Parameters<typeof iconSpan>[0]][] = [
        ["これが必要", hit.neighbors.requires, "cornerDownRight"],
        ["これを待っている", hit.neighbors.requiredBy, "listChecks"],
        ["構成要素", hit.neighbors.contains, "layers"],
        ["属する先", hit.neighbors.containedBy, "chevronRight"],
      ];
      const shown = groups.filter(([, ids]) => ids.length > 0);
      if (shown.length > 0) {
        const box = h("div", { class: "neighbors" });
        for (const [label, ids, iconName] of shown) {
          const grp = h("div", { class: "neighbor-group" });
          const lab = h("span", { class: "neighbor-label" });
          lab.append(iconSpan(iconName, 11), label);
          grp.append(lab);
          for (const id of ids.slice(0, 6)) {
            const chip = h("button", { class: "chip", type: "button" }, [graph.nodes[id]?.name ?? id]);
            chip.addEventListener("click", () => cb.onSelect(id));
            grp.append(chip);
          }
          if (ids.length > 6) grp.append(h("span", { class: "neighbor-label" }, [`他 ${ids.length - 6}`]));
          box.append(grp);
        }
        card.append(box);
      }
    }
    container.append(card);
  }
}

/** 「切れ」ではなく「割れ」を出す。切れだと人の手が止まるが、割れなら
 * 次の操作が決まる——しかも割る操作は既存の一括追加がそのまま使える。 */
function cycleNotice(cycle: string[], cb: ListCallbacks): HTMLElement {
  const box = h("div", { class: "cycle-notice" });
  const title = h("h3");
  title.append(iconSpan("repeat", 14), "この輪の中に、2つに分かれるノードがあるかもしれません");
  box.append(title);
  box.append(
    h("p", {}, [
      "輪ができるのは、1つの名前に2つの違うものが混ざっているサインです。どれかを割ると要求の向きが揃ってほどけます。",
    ]),
  );

  const ring = h("div", { class: "cycle-ring" });
  cycle.forEach((id, i) => {
    const chip = h("button", { class: "chip", type: "button" }, [id]);
    chip.addEventListener("click", () => cb.onSelect(id));
    ring.append(chip);
    if (i < cycle.length - 1) ring.append(iconSpan("chevronRight", 12));
  });
  ring.append(iconSpan("repeat", 12));
  box.append(ring);

  const act = h("button", { class: "btn", type: "button", style: "margin-top:10px" });
  act.append(iconSpan("plus", 13), "この輪のノードを割る");
  act.addEventListener("click", () => cb.onDecompose(cycle));
  box.append(act);
  return box;
}
