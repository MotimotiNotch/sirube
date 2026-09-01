// アプリアイコン（`assets/app-icon.svg`）を生成する。
//
// 作者の手描きラフ（2026-08-31）の清書。図の意味はそのまま Sirube の
// 主張になっている——大きい円（目的）から実線で辿って小さくなっていき、
// 最後は**破線**でアクセント色の点に届く。破線の先が「まだ手が届いて
// いないが、今やれること」。
//
// 円の縁から縁へ線を引くため、端点は中心と半径から計算する。手で座標を
// 置くとサイズを変えるたびに合わなくなるので、ここで出す。

const VB = 64; // viewBox は 0 0 64 64

interface Node { x: number; y: number; r: number }

// 位置はラフの構図（左下に大、右に中、左上に小、右上に点）を踏襲。
const big: Node = { x: 22.4, y: 46.6, r: 11.9 };
const mid: Node = { x: 46.1, y: 31.5, r: 7.6 };
const small: Node = { x: 15.8, y: 22.9, r: 6.5 };
const dot: Node = { x: 49.2, y: 10.6, r: 4.9 };

/** a の縁から b の縁までの線分。円に線が食い込まないよう半径ぶん詰める。 */
function edge(a: Node, b: Node, gap = 0.9): [number, number, number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const round = (n: number): number => Math.round(n * 100) / 100;
  return [
    round(a.x + ux * (a.r + gap)),
    round(a.y + uy * (a.r + gap)),
    round(b.x - ux * (b.r + gap)),
    round(b.y - uy * (b.r + gap)),
  ];
}

const [x1, y1, x2, y2] = edge(big, mid);
const [x3, y3, x4, y4] = edge(mid, small);
const [x5, y5, x6, y6] = edge(small, dot);

// フラグと色を取り違えないよう、`--` で始まらない最初の引数だけを色として読む。
const accent = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "#d98b8b";

// 一番下の円（最大・目的）は中を塗る。点のサーモンと同じトーン
// （HSL の S50% / L70%）で色相だけ回した青。RGB が (217,139,139) と
// (140,179,217) で対称になり、上下に並べても片方だけ浮かない。
const baseColor = "#8cb3d9";

// 小サイズ用の簡略版。16〜24px では円3つ＋破線が団子になって読めない
// （2026-08-31 に並べて確認）。要素を減らし、線を太くし、破線を2本に減らす。
// 意味の核（実線で辿る → 破線の先に点）は落とさない。
const SMALL = process.argv.includes("--small");

// ink は currentColor。単体で開いたときのために svg の color で既定を持たせる。
// アプリに埋め込むと CSS の color を継ぐので、明暗どちらでも成立する。
const svg = SMALL
  ? (() => {
      // 16px は実質16デバイスピクセルしかなく、円3つ＋辺は物理的に載らない
      // （並べて確認済み）。核だけ残す——「輪の外に、破線の先の点がある」。
      const c = { x: 25, y: 40, r: 15.5 };
      const d = { x: 48, y: 15, r: 7.4 };
      const [p1, p2, p3, p4] = edge(c, d, 1.4);
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}" color="#1c1c1a" fill="none" role="img" aria-label="Sirube">
  <g stroke="currentColor" stroke-linecap="round">
    <line x1="${p1}" y1="${p2}" x2="${p3}" y2="${p4}" stroke-width="3.8" stroke-dasharray="4 4.2"/>
    <circle cx="${c.x}" cy="${c.y}" r="${c.r}" stroke-width="4.4"/>
  </g>
  <circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${accent}"/>
</svg>
`;
    })()
  : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}" color="#1c1c1a" fill="none" role="img" aria-label="Sirube">
  <g stroke="currentColor" stroke-linecap="round">
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="2.3"/>
    <line x1="${x3}" y1="${y3}" x2="${x4}" y2="${y4}" stroke-width="2.3"/>
    <line x1="${x5}" y1="${y5}" x2="${x6}" y2="${y6}" stroke-width="2.3" stroke-dasharray="4.6 4.1"/>
    <circle cx="${big.x}" cy="${big.y}" r="${big.r}" fill="${baseColor}" stroke="${baseColor}" stroke-width="2.8"/>
    <circle cx="${mid.x}" cy="${mid.y}" r="${mid.r}" stroke-width="2.6"/>
    <circle cx="${small.x}" cy="${small.y}" r="${small.r}" stroke-width="2.5"/>
  </g>
  <circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${accent}"/>
</svg>
`;

const out = SMALL ? "assets/app-icon-small.svg" : "assets/app-icon.svg";

await Bun.write(out, svg);
console.log(`${out} を書き出しました（accent ${accent}）`);
