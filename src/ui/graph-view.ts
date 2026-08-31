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
const WRAP_GAP_Y = 12; // 折り返した同じ階層の段どうしの間隔（階層間より狭くする）
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

  // 収まる幅に折り返す。分解すればするほど子が増えるツールなので、
  // 増えた瞬間に横スクロールへ逃がすと「作ったものが見えない」状態になる
  // （2026-08-31 の実機確認。子が8個で右端が切れた）。縮尺を縮める案は
  // 文字が読めなくなり、グリッドは「1段 = 1階層」という読み方を壊すので、
  // 段を増やす方を採る。
  const avail = Math.max(320, (container.clientWidth || 640) - PAD * 2 - 8);

  /** ids を、1行が avail に収まるように分割する。 */
  const wrapRows = (ids: string[]): string[][] => {
    const lines: string[][] = [];
    let line: string[] = [];
    let w = 0;
    for (const id of ids) {
      const bw = boxWidth(graph.nodes[id]!.name);
      const next = line.length === 0 ? bw : w + GAP_X + bw;
      if (line.length > 0 && next > avail) {
        lines.push(line);
        line = [id];
        w = bw;
      } else {
        line.push(id);
        w = next;
      }
    }
    if (line.length > 0) lines.push(line);
    return lines;
  };

  const reqLines = wrapRows(reqIds);
  const conLines = wrapRows(conIds);
  const widest = Math.max(focusW, ...reqLines.map(rowWidth), ...conLines.map(rowWidth), 240);
  const contentW = Math.min(widest, avail);
  const totalW = contentW + PAD * 2;

  const centerX = PAD + contentW / 2;
  boxes.push({ id: focusId, x: centerX - focusW / 2, y: PAD, w: focusW, state: resolveState(graph, focusId, cyclic), kind: "focus" });

  let y = PAD + NODE_H + GAP_Y;
  /** 折り返した各段を中央揃えで置き、使った高さを返す。 */
  const layLines = (lines: string[][], kind: "requires" | "contains", startY: number): number => {
    let rowY = startY;
    for (const line of lines) {
      let x = PAD + (contentW - rowWidth(line)) / 2;
      for (const id of line) {
        const w = boxWidth(graph.nodes[id]!.name);
        boxes.push({ id, x, y: rowY, w, state: resolveState(graph, id, cyclic), kind });
        x += w + GAP_X;
      }
      rowY += NODE_H + WRAP_GAP_Y;
    }
    return rowY - WRAP_GAP_Y - startY;
  };
  if (reqLines.length > 0) {
    y += layLines(reqLines, "requires", y) + GAP_Y;
  }
  if (conLines.length > 0) {
    y += layLines(conLines, "contains", y) + GAP_Y;
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
