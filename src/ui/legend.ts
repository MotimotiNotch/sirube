// 凡例。Chain View の隅に置く「！」から、ホバー（とクリック）で開く。
//
// ノードから文字を追い出した結果、**印の色4状態と線種の意味を画面上で説明する
// 場所が無くなった**（2026-09-02 の棚卸しで挙がった `#27`）。かといって常時
// 出すと、追い出したぶんの文字がそのまま別の場所に戻ってくる——表示量の原則3
// 「説明文は初回しか読まれない。畳んで、必要な人だけ開く」に従って畳む。
//
// 見本は色の四角ではなく**グラフと同じ印を描く**。凡例が本物と違う語彙で
// 描かれていると、照らし合わせる側がもう一段の翻訳をすることになる。

import type { NodeState } from "../core/model.ts";
import { STATE_LABEL, h, iconSpan } from "./dom.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

/** グラフのノードと同じ印を、凡例用の小さい寸法で描く。 */
function markSample(state: NodeState): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("class", `legend-mark graph-node st-${state}`);
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("class", "mark");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "8");
  svg.append(circle);
  return svg;
}

/** 線の見本（実線＝前提／破線＝内包／点線＝地図）。 */
function edgeSample(kind: "requires" | "contains" | "goal"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("class", "legend-mark");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M 2 11 L 20 11");
  path.setAttribute("class", `graph-edge ${kind === "requires" ? "" : kind}`.trim());
  svg.append(path);
  return svg;
}

/** 線の上に出る数字の見本（地図で畳んだ件数）。**本物と同じ組み合わせで描く**
 *  ——点線の上に数字が乗っている、という形そのものが説明になる。 */
function betweenSample(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("class", "legend-mark");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M 2 15 L 20 15");
  path.setAttribute("class", "graph-edge goal");
  const t = document.createElementNS(SVG_NS, "text");
  t.setAttribute("class", "edge-between");
  t.setAttribute("x", "11");
  t.setAttribute("y", "12");
  t.setAttribute("text-anchor", "middle");
  t.textContent = "2";
  svg.append(path, t);
  return svg;
}

/** 弧の見本（下にあるものの進み具合）。半分だけ進んだ状態を描く。 */
function ringSample(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("class", "legend-mark graph-node st-BLOCKED");
  const r = 7;
  const circumference = 2 * Math.PI * r;
  for (const [cls, dash] of [
    ["ring track", ""],
    ["ring arc", `${circumference / 2} ${circumference}`],
  ] as const) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", cls);
    c.setAttribute("cx", "11");
    c.setAttribute("cy", "11");
    c.setAttribute("r", String(r));
    if (dash) {
      c.setAttribute("stroke-dasharray", dash);
      c.setAttribute("transform", "rotate(-90 11 11)");
    }
    svg.append(c);
  }
  return svg;
}

function row(sample: SVGSVGElement, label: string): HTMLElement {
  const line = h("div", { class: "legend-row" });
  line.append(sample, h("span", {}, [label]));
  return line;
}

/**
 * 凡例のボタンと本体を `wrap` に足す。
 *
 * ホバーで開き、クリックで固定できる。ホバーだけだと読んでいる途中に手が
 * ずれて閉じるし、クリックだけだと「そこに説明がある」ことに気づけない。
 */
export function mountLegend(host: HTMLElement, map = false): void {
  const panel = h("div", { class: "legend-panel hidden" });
  const states: NodeState[] = ["ACTIONABLE", "BLOCKED", "SATISFIED", "CYCLIC"];
  for (const state of states) panel.append(row(markSample(state), STATE_LABEL[state]));
  panel.append(h("div", { class: "legend-sep" }, []));
  // **線の説明は縮尺で差し替える**（2026-09-12、のっち報告「エッジの数字ってなに？」）。
  // 地図の線は縮約で1種類に畳まれた点線なのに、凡例は実線＝前提／破線＝内包を
  // 出したままだった。**画面に無いものを説明し、出ている数字を説明していない。**
  if (map) {
    panel.append(row(edgeSample("goal"), "この先にあるゴール"));
    panel.append(row(betweenSample(), "線の上の数字は、間に畳んだ件数"));
  } else {
    panel.append(row(edgeSample("requires"), "これが必要（前提）"));
    panel.append(row(edgeSample("contains"), "これで構成（内包）"));
  }
  panel.append(h("div", { class: "legend-sep" }, []));
  panel.append(row(ringSample(), "下にあるものの進み具合"));
  panel.append(
    h("div", { class: "legend-row" }, [
      h("span", { class: "legend-mark legend-merge" }, ["2"]),
      // 入次数の読み方も縮尺で変わる。詳細では優先度（片付けると何個進むか）、
      // 地図では通り道の数。ノードのツールチップと同じ言い方に揃える。
      h("span", {}, [map ? "いくつのゴールがここを通るか" : "何箇所から要求されているか"]),
    ]),
  );

  const btn = h("button", { class: "legend-btn", type: "button", title: "凡例" });
  btn.append(iconSpan("info", 14));

  let pinned = false;
  const show = (): void => panel.classList.remove("hidden");
  const hide = (): void => {
    if (!pinned) panel.classList.add("hidden");
  };
  btn.addEventListener("mouseenter", show);
  btn.addEventListener("mouseleave", hide);
  panel.addEventListener("mouseenter", show);
  panel.addEventListener("mouseleave", hide);
  btn.addEventListener("click", () => {
    pinned = !pinned;
    btn.classList.toggle("pinned", pinned);
    if (pinned) show();
    else panel.classList.add("hidden");
  });

  host.append(panel, btn);
}
