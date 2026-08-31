// Chain View: 「今いる地点」から見た局所的な木を描く。
//
// データ構造はフラットな有向グラフ（リゾーム）で、ツリーは描画の都合でしかない。
// 全体を一望させず、フォーカスしたノードとその直下だけを描いて、クリックで
// 潜っていく。入り口を変えれば違う木が現れる——地図であって複写ではない。

import type { Graph, NodeState } from "../core/model.ts";
import type { ReverseIndex } from "../core/engine.ts";
import { resolveState } from "../core/engine.ts";

const NODE_H = 40;
const GAP_X = 18;
const GAP_Y = 66;
const PAD = 20;
const CHAR_W = 13; // 日本語混じりの概算。実測より広めに取って被りを防ぐ

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  state: NodeState;
  kind: "focus" | "requires" | "contains";
}

function boxWidth(label: string): number {
  return Math.max(88, Math.min(240, label.length * CHAR_W + 24));
}

export interface GraphViewCallbacks {
  onSelect(id: string): void;
  onDrill(id: string): void;
}

/**
 * フォーカスノードと直下の子（requires / contains）を1枚に描く。
 *
 * `requires` は実線、`contains` は破線で区別する。循環しているエッジは
 * 色を変えて、「前提待ち」と「輪で詰まっている」が一目で分かるようにする
 * ——ここを潰していたのが Warframe 版の問題だった。
 */
export function renderGraph(
  container: HTMLElement,
  graph: Graph,
  focusId: string,
  rev: ReverseIndex,
  cyclic: ReadonlySet<string>,
  cb: GraphViewCallbacks,
): void {
  const focus = graph.nodes[focusId];
  container.replaceChildren();
  if (!focus) {
    container.append(Object.assign(document.createElement("div"), { className: "empty", textContent: "ノードが見つかりません" }));
    return;
  }

  const reqIds = focus.requires.filter((id) => graph.nodes[id]);
  const conIds = focus.contains.filter((id) => graph.nodes[id]);

  const boxes: Box[] = [];
  const focusW = boxWidth(focus.name);

  const rowWidth = (ids: string[]): number =>
    ids.reduce((acc, id) => acc + boxWidth(graph.nodes[id]!.name) + GAP_X, -GAP_X);

  const reqW = rowWidth(reqIds);
  const conW = rowWidth(conIds);
  const contentW = Math.max(focusW, reqW, conW, 240);
  const totalW = contentW + PAD * 2;

  const centerX = PAD + contentW / 2;
  boxes.push({ id: focusId, x: centerX - focusW / 2, y: PAD, w: focusW, state: resolveState(graph, focusId, cyclic), kind: "focus" });

  let y = PAD + NODE_H + GAP_Y;
  const layRow = (ids: string[], kind: "requires" | "contains", rowY: number): void => {
    let x = PAD + (contentW - rowWidth(ids)) / 2;
    for (const id of ids) {
      const w = boxWidth(graph.nodes[id]!.name);
      boxes.push({ id, x, y: rowY, w, state: resolveState(graph, id, cyclic), kind });
      x += w + GAP_X;
    }
  };
  if (reqIds.length > 0) {
    layRow(reqIds, "requires", y);
    y += NODE_H + GAP_Y;
  }
  if (conIds.length > 0) {
    layRow(conIds, "contains", y);
    y += NODE_H + GAP_Y;
  }
  const totalH = Math.max(y - GAP_Y + PAD, PAD * 2 + NODE_H);

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("width", String(totalW));
  svg.setAttribute("height", String(totalH));
  svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const focusBox = byId.get(focusId)!;

  // エッジ（先に描いてノードの下に敷く）
  for (const b of boxes) {
    if (b.kind === "focus") continue;
    const path = document.createElementNS(svgNs, "path");
    const x1 = focusBox.x + focusBox.w / 2;
    const y1 = focusBox.y + NODE_H;
    const x2 = b.x + b.w / 2;
    const y2 = b.y;
    const mid = (y1 + y2) / 2;
    path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
    const isCyclic = cyclic.has(b.id) && cyclic.has(focusId);
    path.setAttribute("class", `graph-edge ${b.kind === "contains" ? "contains" : ""} ${isCyclic ? "cyclic" : ""}`.trim());
    svg.append(path);
  }

  // ラベル（requires / contains の区別を文字でも出す。線種だけだと分かりにくい）
  const rows: [string, Box | undefined][] = [
    ["これが必要（前提）", boxes.find((b) => b.kind === "requires")],
    ["これで構成（内包）", boxes.find((b) => b.kind === "contains")],
  ];
  for (const [label, sample] of rows) {
    if (!sample) continue;
    const t = document.createElementNS(svgNs, "text");
    t.setAttribute("x", String(PAD));
    t.setAttribute("y", String(sample.y - 8));
    t.setAttribute("class", "edge-label");
    t.textContent = label;
    svg.append(t);
  }

  for (const b of boxes) {
    const node = graph.nodes[b.id]!;
    const g = document.createElementNS(svgNs, "g");
    g.setAttribute("class", `graph-node st-${b.state}${b.kind === "focus" ? " focused" : ""}`);
    g.setAttribute("transform", `translate(${b.x}, ${b.y})`);

    const rect = document.createElementNS(svgNs, "rect");
    rect.setAttribute("class", "box");
    rect.setAttribute("width", String(b.w));
    rect.setAttribute("height", String(NODE_H));
    rect.setAttribute("rx", "7");
    g.append(rect);

    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("x", String(b.w / 2));
    label.setAttribute("y", "18");
    label.setAttribute("text-anchor", "middle");
    label.textContent = truncate(node.name, Math.floor((b.w - 16) / CHAR_W));
    g.append(label);

    const childCount = node.requires.length + node.contains.length;
    const sub = document.createElementNS(svgNs, "text");
    sub.setAttribute("x", String(b.w / 2));
    sub.setAttribute("y", "32");
    sub.setAttribute("text-anchor", "middle");
    sub.setAttribute("class", "sub");
    const inDeg = (rev.requiredBy.get(b.id)?.length ?? 0) + (rev.containedBy.get(b.id)?.length ?? 0);
    sub.textContent = [childCount > 0 ? `下に${childCount}` : "", inDeg > 1 ? `合流${inDeg}` : ""].filter(Boolean).join(" / ");
    g.append(sub);

    const title = document.createElementNS(svgNs, "title");
    title.textContent = node.name;
    g.append(title);

    g.addEventListener("click", () => {
      if (b.kind === "focus") cb.onSelect(b.id);
      else cb.onDrill(b.id);
    });
    svg.append(g);
  }

  const wrap = document.createElement("div");
  wrap.className = "graph-wrap";
  wrap.append(svg);
  container.append(wrap);

  if (reqIds.length === 0 && conIds.length === 0) {
    const hint = document.createElement("div");
    hint.className = "empty";
    hint.textContent = "このノードにはまだ下がありません。右のパネルから「前提を一括追加」で分解できます。";
    container.append(hint);
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}
