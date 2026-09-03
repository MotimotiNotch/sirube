// Chain View: 「今いる地点」から見た局所的な木を描く。
//
// データ構造はフラットな有向グラフ（リゾーム）で、ツリーは描画の都合でしかない。
// 全体を一望させはしないが、**前提（requires）は辿り切って描き、内包（contains）は
// 直下1段に留める**。前提の鎖が見えないと「なぜ今これがやれるのか」が追えず、
// 内包まで広げると自己相似な入れ子が際限なく1画面に載る。潜るのはクリックで、
// 入り口を変えれば違う木が現れる——地図であって複写ではない。

import type { Graph, NodeState } from "../core/model.ts";
import type { ReverseIndex } from "../core/engine.ts";
import { descendantProgress, hasChildren, resolveState } from "../core/engine.ts";
import { hideFlyout, scheduleHideFlyout, showOutlineFlyout } from "./flyout.ts";
import { consumeDragEnd, mountViewport } from "./graph-viewport.ts";
import { mountLegend } from "./legend.ts";

// ノードは「印＋その下の名前」で描く（2026-09-02、のっち判断）。箱の中に名前と
// 数字を入れていた頃は、6個並ぶとカードの列に見えてグラフに見えなかった。
// **画面に文字で出るのはノード名と合流の数だけ**で、状態は色、下に何がどれだけ
// あるかは印を囲む弧が持つ。数値はツールチップへ逃がす。
//
// style.css の「状態の色分けが情報の本体なので、そこだけ彩度とコントラストを
// 確保し、それ以外は徹底して静かにする」に照らすと、240px の箱を状態色で塗るのは
// 一番うるさいものを自前で作っていたことになる。印なら面積は小さいが、周りが
// 静かなぶん拾える。

const MARK_R = 12; // 印の半径
const MARK_R_FOCUS = 15;
const MARK_CY = 17; // ノードの上端から印の中心まで
const LABEL_Y = 50; // 名前のベースライン（印の縁から4px 空ける）
const NODE_H = 56; // 印＋名前を収めた高さ
const GAP_X = 14;
const GAP_Y = 48;
const WRAP_GAP_Y = 16; // 折り返した同じ階層の段どうしの間隔（階層間より狭くする）
const PAD = 20;
const CHAR_W = 12; // 日本語混じりの概算。実測より広めに取って被りを防ぐ

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  state: NodeState;
  kind: "focus" | "requires" | "contains";
}

/** ノードが占める幅。**ラベルが決める**（固定の列幅にはしない）。
 *
 * 固定幅にすると短い名前のところで場所を無駄にし、「収まる幅で段を増やす」が
 * 壊れて行数が増える。印を外に出しても密度を落とさないための要点。 */
function boxWidth(label: string): number {
  return Math.max(72, Math.min(240, label.length * CHAR_W + 16));
}

export interface GraphViewCallbacks {
  onSelect(id: string): void;
  onDrill(id: string): void;
  /** エッジを押した。その2つの**間に**新しいノードを差し込む。 */
  onInsert(parentId: string, childId: string, kind: "requires" | "contains"): void;
}

/**
 * フォーカスノードから、前提を辿り切った鎖と直下の内包を1枚に描く。
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
  /** 右パネルが今どれを出しているか。潜らずに選ぶだけの操作があるので、
   *  グラフ側にも印が要る——押しても絵が変わらないと「効いていない」に見える。 */
  selectedId?: string,
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

  // 段を組む。**`requires` は全展開、`contains` は直下1ホップだけ**
  // （2026-09-02、Warframe 版に合わせた。あちらの `computeLayout` は
  // 「前提の鎖は常に見えていなければならない」と明記して同じ区別をしている）。
  //
  // 両方を1ホップに縮めていた頃は、10段の鎖の先頭を開いても次の1つしか見えず、
  // **実際に今やれる末端へ辿り着くのに9回潜る**ことになっていた。「分解の向きで
  // 末端に今日やれることが現れる」がこの道具の売りなので、そこが見えないのは痛い。
  // `contains` を全展開しないのは、自己相似な入れ子が際限なく1画面へ広がるため。
  const edges: { from: string; to: string; kind: "requires" | "contains" }[] = [];
  const tiers: { ids: string[]; kind: "requires" | "contains" }[] = [];
  // 同じノードは最初に出てきた段にだけ置く。合流点も輪もこれで止まる
  // （線は毎回引くので、複数の親から要求されていることは見た目に残る）。
  const placed = new Set<string>([focusId]);

  let frontier = [focusId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const pid of frontier) {
      for (const cid of graph.nodes[pid]?.requires ?? []) {
        if (!graph.nodes[cid]) continue;
        edges.push({ from: pid, to: cid, kind: "requires" });
        if (placed.has(cid)) continue;
        placed.add(cid);
        next.push(cid);
      }
    }
    if (next.length > 0) tiers.push({ ids: next, kind: "requires" });
    frontier = next;
  }

  for (const cid of conIds) edges.push({ from: focusId, to: cid, kind: "contains" });
  const conFresh = conIds.filter((id) => !placed.has(id));
  for (const id of conFresh) placed.add(id);
  if (conFresh.length > 0) tiers.push({ ids: conFresh, kind: "contains" });

  const tierLines = tiers.map((t) => ({ kind: t.kind, lines: wrapRows(t.ids) }));
  const widest = Math.max(focusW, ...tierLines.flatMap((t) => t.lines.map(rowWidth)), 240);
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
  for (const tier of tierLines) {
    y += layLines(tier.lines, tier.kind, y) + GAP_Y;
  }
  const totalH = Math.max(y - GAP_Y + PAD, PAD * 2 + NODE_H);

  const svgNs = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNs, "svg");
  // SVG は表示窓いっぱいに広げ、内容の位置と大きさは view の transform だけで
  // 決める。内容と同じ寸法にして親をスクロールさせる形だと、拡大率とスクロール
  // 位置という2つの状態を同期し続けることになる。
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  const view = document.createElementNS(svgNs, "g");
  svg.append(view);

  const byId = new Map(boxes.map((b) => [b.id, b]));

  // エッジ（先に描いてノードの下に敷く）。**起点は親であって focus ではない。**
  // 全展開にした以上、深い段の線を focus から引くと、実際には繋がっていない
  // ノードどうしが繋がって見える。
  for (const e of edges) {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    if (!from || !to) continue;
    const path = document.createElementNS(svgNs, "path");
    const x1 = from.x + from.w / 2;
    // 親は名前の下から出し、子は印の上で受ける。印から出すと線が親の名前を
    // 突っ切る（移植元はそうなっている）。
    const y1 = from.y + NODE_H;
    const x2 = to.x + to.w / 2;
    const y2 = to.y + MARK_CY - MARK_R - 3;
    const mid = (y1 + y2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
    path.setAttribute("d", d);
    const isCyclic = cyclic.has(e.from) && cyclic.has(e.to);
    // 選んだノードに繋がる線は明るくする。段が増えて折り返しが起きると線が
    // 400〜550px 走ることがあり、薄いまま重なると**どれとどれが繋がっているか
    // 追えない**（のっち報告 2026-09-03）。1本ずつ確かめる手がかりを足す。
    const touchesSelection = selectedId !== undefined && (e.from === selectedId || e.to === selectedId);
    path.setAttribute(
      "class",
      `graph-edge ${e.kind === "contains" ? "contains" : ""} ${isCyclic ? "cyclic" : ""} ${touchesSelection ? "on" : ""}`.trim(),
    );
    // 端点を持たせておく。ホバーのたびにグラフを組み直さず、この属性を見て
    // クラスを付け替えるだけで済ませる。
    path.dataset.from = e.from;
    path.dataset.to = e.to;
    view.append(path);

    // 当たり判定。線は 1.5px しかないので、そのままでは掴めない。太い透明な
    // 線を重ねて、押せる幅を確保する（ノードの当たり判定に矩形を敷くのと同じ手）。
    const hit = document.createElementNS(svgNs, "path");
    hit.setAttribute("d", d);
    hit.setAttribute("class", "graph-edge-hit");
    const hitTitle = document.createElementNS(svgNs, "title");
    hitTitle.textContent = `${graph.nodes[e.from]?.name ?? e.from} と ${graph.nodes[e.to]?.name ?? e.to} の間に差し込む`;
    hit.append(hitTitle);
    hit.addEventListener("click", () => {
      if (consumeDragEnd()) return;
      cb.onInsert(e.from, e.to, e.kind);
    });
    // 押せることを見せる。細い線の上を通っただけで太くなると鬱陶しいので、
    // 強調は当たり判定に乗ったときだけにする。
    hit.addEventListener("mouseenter", () => path.classList.add("hover"));
    hit.addEventListener("mouseleave", () => path.classList.remove("hover"));
    view.append(hit);
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
    view.append(t);
  }

  /**
   * ホバーしているノードに繋がる線を明るくする。**選択ではなくホバーで出す。**
   *
   * 選択で出す形にしていたが、子があるノードは押すと潜ってしまうので、
   * 「この枝がどこへ繋がっているか」を確かめる手段にならなかった。ホバーなら
   * 画面が変わらない。指を外したら、選んでいるノードの線に戻す。
   */
  const highlightEdges = (hovered: string | undefined): void => {
    const target = hovered ?? selectedId;
    for (const p of Array.from(view.querySelectorAll<SVGPathElement>(".graph-edge"))) {
      p.classList.toggle("on", target !== undefined && (p.dataset.from === target || p.dataset.to === target));
    }
  };

  for (const b of boxes) {
    const node = graph.nodes[b.id]!;
    const g = document.createElementNS(svgNs, "g");
    g.setAttribute(
      "class",
      `graph-node st-${b.state}${b.kind === "focus" ? " focused" : ""}${b.id === selectedId ? " selected" : ""}`,
    );
    g.setAttribute("transform", `translate(${b.x}, ${b.y})`);

    // ノード全体のツールチップは最初の子に置く。弧や合流の数にも `<title>` が
    // 付いているので、後ろに回すと SVG も `querySelector` もそちらを先に拾う。
    const title = document.createElementNS(svgNs, "title");
    title.textContent = node.name;
    g.append(title);

    // 当たり判定。印だけだと小さすぎて掴めないので、名前まで含めた矩形を
    // 透明で敷く（移植元も同じ理由で、後からラベルにハンドラを足している）。
    const hit = document.createElementNS(svgNs, "rect");
    hit.setAttribute("class", "hit");
    hit.setAttribute("width", String(b.w));
    hit.setAttribute("height", String(NODE_H));
    g.append(hit);

    const r = b.kind === "focus" ? MARK_R_FOCUS : MARK_R;
    const cx = b.w / 2;
    const mark = document.createElementNS(svgNs, "circle");
    mark.setAttribute("class", "mark");
    mark.setAttribute("cx", String(cx));
    mark.setAttribute("cy", String(MARK_CY));
    mark.setAttribute("r", String(r));
    g.append(mark);

    // 選んでいるノードは輪で囲う。**印そのものは太らせない**——印の色は状態
    // （今やれる・達成済み・輪）を言っているので、そこを太くすると状態が強く
    // なったように見える。外に1本足す方が、状態と選択が別の語彙のまま残る。
    if (b.id === selectedId) {
      const ring = document.createElementNS(svgNs, "circle");
      ring.setAttribute("class", "sel-ring");
      ring.setAttribute("cx", String(cx));
      ring.setAttribute("cy", String(MARK_CY));
      ring.setAttribute("r", String(r + 4));
      g.append(ring);
    }

    // 下に何かあるか＝弧が出るかどうか、どれだけ済んでいるか＝弧の長さ。
    // `下にN` という文字を置き換えたもの。数は title へ逃がす。
    const below = descendantProgress(graph, b.id);
    if (below.total > 0) {
      const ringR = r * 0.58;
      const circumference = 2 * Math.PI * ringR;
      const frac = below.done / below.total;
      const track = document.createElementNS(svgNs, "circle");
      track.setAttribute("class", "ring track");
      track.setAttribute("cx", String(cx));
      track.setAttribute("cy", String(MARK_CY));
      track.setAttribute("r", String(ringR));
      const ringTitle = document.createElementNS(svgNs, "title");
      ringTitle.textContent = `下に ${below.done}/${below.total}`;
      track.append(ringTitle);
      g.append(track);
      // 0% のときは軌道だけ。長さ0の破線は丸い点になって「少し進んでいる」
      // ように見えてしまう。
      if (frac > 0) {
        const arc = document.createElementNS(svgNs, "circle");
        arc.setAttribute("class", "ring arc");
        arc.setAttribute("cx", String(cx));
        arc.setAttribute("cy", String(MARK_CY));
        arc.setAttribute("r", String(ringR));
        arc.setAttribute("stroke-dasharray", `${circumference * frac} ${circumference}`);
        arc.setAttribute("transform", `rotate(-90 ${cx} ${MARK_CY})`);
        g.append(arc);
      }
    }

    // 合流の数だけは文字で残す。「片付けると何個の枝が進むか」＝構造から出る
    // 優先度で、数が読めないと優先度として使えない（形にすると「いくつ」が
    // 落ちる）。他に出す場所も無い——中身の一覧は `contains` しか辿らない。
    const inDeg = (rev.requiredBy.get(b.id)?.length ?? 0) + (rev.containedBy.get(b.id)?.length ?? 0);
    if (inDeg > 1) {
      const merge = document.createElementNS(svgNs, "text");
      merge.setAttribute("class", "merge");
      merge.setAttribute("x", String(cx + r + 3));
      merge.setAttribute("y", String(MARK_CY - r + 7));
      merge.textContent = String(inDeg);
      const mergeTitle = document.createElementNS(svgNs, "title");
      mergeTitle.textContent = `${inDeg} 箇所から要求されている（片付けると ${inDeg} つ進む）`;
      merge.append(mergeTitle);
      g.append(merge);
    }

    const label = document.createElementNS(svgNs, "text");
    label.setAttribute("class", "label");
    label.setAttribute("x", String(cx));
    label.setAttribute("y", String(LABEL_Y));
    label.setAttribute("text-anchor", "middle");
    label.textContent = truncate(node.name, Math.floor((b.w - 8) / CHAR_W));
    g.append(label);


    g.addEventListener("click", () => {
      // 掴んで動かした指を、たまたまノードの上で離しただけのとき。
      if (consumeDragEnd()) return;
      // 潜るのは下に何かあるときだけ。末端まで潜れると、丸1つだけの画面へ
      // 行って戻るのに往復2クリックかかる（のっち報告 2026-09-03「無駄に前提で
      // ドリルされるとよく分からない。クリックが余計に要求されてる」）。
      // 潜って得られるものは、選んだときに右パネルへ出るものと同じ。
      if (b.kind === "focus" || !hasChildren(graph, b.id)) cb.onSelect(b.id);
      else cb.onDrill(b.id);
    });

    // 下があるノードはホバーで全階層の一覧を出す。フォーカスノードも
    // 対象にする——ここは移植元と違うところで、あちらはグラフが requires を
    // 全展開していたので起点を除いていた。こちらは直下1ホップしか描かない
    // ぶん、起点の配下こそ一覧が要る。
    // 線の強調は全ノードに付ける。フライアウト（下にあるものの一覧）は
    // 子があるときだけなので、条件を分けてある。
    g.addEventListener("mouseenter", () => highlightEdges(b.id));
    g.addEventListener("mouseleave", () => highlightEdges(undefined));
    if (hasChildren(graph, b.id)) {
      g.addEventListener("mouseenter", () => showOutlineFlyout(g, graph, b.id, cb.onDrill));
      g.addEventListener("mouseleave", scheduleHideFlyout);
    }
    view.append(g);
  }

  const wrap = document.createElement("div");
  // 子が無いときは表示窓を伸ばさない。動かすものが無い上に、案内文が
  // ペインの下端まで押し出されてノードから離れてしまう。
  wrap.className = `graph-wrap${reqIds.length === 0 && conIds.length === 0 ? " short" : ""}`;
  wrap.append(svg);
  container.append(wrap);
  // 表示窓の寸法が要るので、DOM へ入れてから配線する。
  mountViewport({ wrap, view, host: container, focusId, contentW: totalW, contentH: totalH, onInteract: hideFlyout });
  // 凡例は表示窓ではなくペインに置く。窓は子が無いと 140px に縮むので、
  // 窓基準だと「！」がノードの隣あたりまで上がってきて、開くたびに高さが違う。
  mountLegend(container);

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
