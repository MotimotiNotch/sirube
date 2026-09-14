// 中身の一覧（フライアウト）。Warframe State Graph の `ts/web/graph-nav.ts`
// からの移植。
//
// グラフ本体は「今いる地点と直下だけ」を描くと決めてあるので、深い入れ子は
// 潜らないと見えない。潜る前に「下に何が積まれているか」を確かめる経路が無い
// と、目的を選ぶたびに何段も往復することになる——それを埋めるのがこれ。
//
// 「1クリック1階層」という通常の潜り方は変えない。これはその近道。
//
// **並ぶのは飛び先だけ（自分も下を持つノード）で、末端は出さない。** 移植元の
// コメントは「末端も含む（チェックリストとして読める）」と言っているが、実装は
// 末端を落としており、**実装の方が後から出した答え**だった——末端も並べる形を
// 一度試したら、実データで 12行 → 30行 に膨らんでホバーには重すぎた
// （2026-09-02、のっちの指摘で戻した）。
//
// 落とした役割は他が持っている: 配下で今やれるものは俯瞰、直下に何があるかは
// グラフ本体、下がどれだけ片付いたかは印の弧。

import { descendantOutline, descendantProgress, type OutlineItem } from "../core/engine.ts";
import type { Graph } from "../core/model.ts";
import { isEndlessRoot } from "../core/goals.ts";
import { h, iconSpan } from "./dom.ts";

/** 字下げの上限。これ以上は深さを数字で出す——字下げを積み続けると横に溢れ、
 *  字下げ自体が読めなくなる。深さの情報は数字側に残る。 */
const INDENT_CAP = 6;
const INDENT_PX = 12;
/** ノードとフライアウトの隙間を横切るあいだに閉じないための猶予。 */
const HIDE_DELAY_MS = 150;

let hideTimer: ReturnType<typeof setTimeout> | undefined;

function flyoutEl(): HTMLElement | undefined {
  return document.getElementById("flyout") ?? undefined;
}

export function hideFlyout(): void {
  clearTimeout(hideTimer);
  const fly = flyoutEl();
  if (!fly) return;
  fly.replaceChildren();
  fly.classList.add("hidden");
}

export function scheduleHideFlyout(): void {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideFlyout, HIDE_DELAY_MS);
}

function row(graph: Graph, item: OutlineItem, onPick: (id: string) => void): HTMLElement {
  const name = graph.nodes[item.id]?.name ?? item.id;
  // 並ぶ行は全部「下を持つノード」なので、潜れないのは合流点の2度目だけ。
  const clickable = !item.repeat;
  const indent = Math.min(item.depth, INDENT_CAP) * INDENT_PX;
  const el = h("div", {
    class: `fly-item${clickable ? "" : " static"}`,
    style: `padding-left:${8 + indent}px`,
    title: name,
  });

  if (item.depth >= INDENT_CAP) {
    el.append(h("span", { class: "fly-depth", title: `${item.depth + 1} 段下` }, [String(item.depth + 1)]));
  }
  const mark = iconSpan(item.done ? "circleCheck" : "circle", 12);
  // 済みの印は達成の色を使う。ここは本体の状態（4値）ではなく「中身が揃って
  // いるか」なので、状態バッジと同じ語彙にすると別のものを指してしまう——
  // 済み／未済の2値だけに留める。
  mark.classList.add(item.done ? "fly-done" : "fly-todo");
  el.append(mark);
  el.append(h("span", { class: "fly-name" }, [name]));
  if (item.repeat) el.append(h("span", { class: "fly-tag" }, ["既出"]));
  else el.append(iconSpan("chevronRight", 12));

  if (clickable) {
    el.addEventListener("click", () => {
      hideFlyout();
      onPick(item.id);
    });
  }
  return el;
}

/**
 * `nodeId` の下にあるものを全階層並べて、アンカー要素の下に出す。
 *
 * 何も無ければ出さない（空の箱を出すと、ホバーするたびに視界が揺れる）。
 */
export function showOutlineFlyout(
  anchor: Element,
  graph: Graph,
  nodeId: string,
  onPick: (id: string) => void,
): void {
  clearTimeout(hideTimer);
  const fly = flyoutEl();
  if (!fly) return;

  const items = descendantOutline(graph, nodeId);
  if (items.length === 0) {
    hideFlyout();
    return;
  }

  const c = descendantProgress(graph, nodeId);
  const head = h("div", { class: "fly-head" });
  head.append(iconSpan("layers", 12), h("span", {}, ["下にあるもの（クリックで直接ジャンプ）"]));
  // 終わらない根は分数にしない（`isEndlessRoot`）。件数は2つとも残す。
  head.append(
    h("span", { class: "fly-count" }, [isEndlessRoot(graph, nodeId) ? `達成 ${c.done} ／ 全 ${c.total}` : `${c.done}/${c.total}`]),
  );

  fly.replaceChildren(head, ...items.map((it) => row(graph, it, onPick)));
  fly.classList.remove("hidden");

  // 位置決めは表示してから測る（`hidden` のままだと寸法が 0 になる）。
  const a = anchor.getBoundingClientRect();
  const w = fly.offsetWidth;
  const hgt = fly.offsetHeight;
  const margin = 8;
  let left = a.left + a.width / 2 - w / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  let top = a.bottom + 6;
  // 下に入らなければノードの上へ回す。入れ子が深いほど縦に伸びるので、
  // 画面下寄りのノードでは日常的に起きる。
  if (top + hgt > window.innerHeight - margin) top = a.top - hgt - 6;
  top = Math.max(margin, top);
  fly.style.left = `${left}px`;
  fly.style.top = `${top}px`;

  fly.onmouseenter = () => clearTimeout(hideTimer);
  fly.onmouseleave = scheduleHideFlyout;
}
