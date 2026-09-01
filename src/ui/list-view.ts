// 検索結果 ＝ 横断 Next Action ビュー。同じ1画面。
//
//   テキストクエリ        → 全文検索
//   空クエリ + ACTIONABLE → 「今やれること」（起動直後の画面）
//
// タグを持たない代わりに、行に**パンくず**を出す。どの目的の下にいるかが
// 見えれば、それがタグの代わりになる。複数並べば合流点＝片付けると2つ進む。
//
// 表示量の原則（2026-08-31、のっちの実機確認で全面的に絞った）:
//
//   1. 同じ情報を2つの入れ物で出さない。上方向の隣接（これを待っている／
//      属する先）はパンくずと同じものを指すので、並べると行が二段になる。
//   2. 全行で同じ値になるものは出さない。「今やれること」は定義上すべて
//      ACTIONABLE なので、状態バッジを6行並べても情報量はゼロ。
//   3. 説明文は初回しか読まれない。畳んで、必要な人だけ開く。

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
  const isSearch = opts.query !== "";

  // 見出しはパンくずが出している。ここで繰り返さない。件数だけは検索時に要る
  // （サイドバーのカウントは「今やれること」の数しか持っていない）。
  if (isSearch) {
    container.append(h("div", { class: "list-head" }, [h("span", { class: "list-count" }, [`${result.total} 件`])]));
  }

  // 詰まっている輪は結果より先に出す。「今やれることが空」の理由が
  // 見えないまま終わるのが、このツールで一番まずい失敗の仕方。
  for (const cycle of result.cycles) {
    container.append(cycleNotice(graph, cycle, cb));
  }

  if (result.hits.length === 0) {
    const msg = isSearch
      ? "一致するノードがありません。"
      : result.cycles.length > 0
        ? "今やれることがありません。上の輪をほどくと動き出します。"
        : "今やれることがありません。";
    container.append(h("div", { class: "empty" }, [msg]));
    return;
  }

  // 状態は「混ざっているときだけ」出す。揃っているなら見出しが既に言っている。
  const mixedState = new Set(result.hits.map((x) => x.state)).size > 1;

  for (const hit of result.hits) {
    const node = graph.nodes[hit.id];
    if (!node) continue;

    const card = h("div", { class: "hit" });
    const main = h("button", { class: "hit-main", type: "button" });
    main.append(h("span", { class: "hit-name" }, [node.name]));

    // パンくずは名前と同じ行の右側へ。二段組をやめると行数が半分以下になる。
    // 空でも要素は置く——右寄せの基準をこの1つに集約しておかないと、
    // meta 側の auto マージンと余白を分け合って中途半端な位置で止まる。
    //
    // `breadcrumb` は id の配列（コアは表示を決めない）。ここで名前に直す——
    // id/name を分けたあと、ここだけ id をそのまま出して行の右端に ULID が
    // 並んでいた（2026-09-01）。並び順も id ではなく名前で決める。
    const crumbText = hit.breadcrumb
      .map((rootId) => graph.nodes[rootId]?.name ?? rootId)
      .sort((a, b) => a.localeCompare(b, "ja"))
      .join(" / ");
    const crumb = h("span", { class: "hit-crumb" }, [crumbText]);
    if (crumbText) crumb.title = `${crumbText} の下`;
    main.append(crumb);

    const meta = h("div", { class: "hit-meta" });
    if (hit.inDegree > 1) {
      meta.append(h("span", { class: "hit-indegree", title: `${hit.inDegree} 箇所から要求されている（片付けると複数が進む）` }, [`合流 ${hit.inDegree}`]));
    }
    if (hit.due) meta.append(h("span", { class: "hit-indegree", title: "期限" }, [hit.due]));
    if (mixedState) meta.append(stateBadge(hit.state));
    main.append(meta);
    main.addEventListener("click", () => cb.onSelect(hit.id));
    card.append(main);

    // 隣接（1ホップ）は検索のための機能。「CI/CD」で検索したときに「手順書」も
    // 浮かぶことで、単語を思い出せなくても到達できる、というのが元の狙いだった。
    // 「今やれること」では思い出す対象が無いので出さない。
    if (isSearch && hit.neighbors) {
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
          // ラベルはアイコンだけにして、語はツールチップへ逃がす。4方向 × 文字だと
          // チップより見出しの方が長くなる。
          const lab = h("span", { class: "neighbor-label", title: label });
          lab.append(iconSpan(iconName, 11));
          grp.append(lab);
          for (const id of ids.slice(0, 6)) {
            const chip = h("button", { class: "chip", type: "button" }, [graph.nodes[id]?.name ?? id]);
            chip.addEventListener("click", () => cb.onSelect(id));
            grp.append(chip);
          }
          if (ids.length > 6) grp.append(h("span", { class: "neighbor-label" }, [`+${ids.length - 6}`]));
          box.append(grp);
        }
        card.append(box);
      }
    }
    container.append(card);
  }
}

/** 「切れ」ではなく「割れ」を出す。切れだと人の手が止まるが、割れなら
 * 次の操作が決まる——しかも割る操作は既存の一括追加がそのまま使える。
 *
 * 理由の説明は畳んでおく。毎回同じ文が画面の1/4を占めていた。 */
function cycleNotice(graph: Graph, cycle: string[], cb: ListCallbacks): HTMLElement {
  const box = h("div", { class: "cycle-notice" });

  const head = h("div", { class: "cycle-head" });
  const title = h("h3");
  title.append(iconSpan("repeat", 14), "この輪の中に、2つに分かれるノードがあるかもしれません");
  head.append(title);

  const ring = h("div", { class: "cycle-ring" });
  cycle.forEach((id, i) => {
    const chip = h("button", { class: "chip", type: "button" }, [graph.nodes[id]?.name ?? id]);
    chip.addEventListener("click", () => cb.onSelect(id));
    ring.append(chip);
    if (i < cycle.length - 1) ring.append(iconSpan("chevronRight", 12));
  });
  ring.append(iconSpan("repeat", 12));

  const act = h("button", { class: "btn", type: "button" });
  act.append(iconSpan("plus", 13), "割る");
  act.addEventListener("click", () => cb.onDecompose(cycle));

  const row = h("div", { class: "cycle-row" });
  row.append(ring, act);

  const why = h("details", { class: "cycle-why" });
  why.append(h("summary", {}, ["なぜ輪ができるのか"]));
  why.append(
    h("p", {}, [
      "輪ができるのは、1つの名前に2つの違うものが混ざっているサインです。どれかを割ると要求の向きが揃ってほどけます。",
    ]),
  );

  box.append(head, row, why);
  return box;
}
