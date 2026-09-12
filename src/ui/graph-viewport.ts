// Chain View の拡大縮小と移動（2026-09-02、のっち依頼）。
//
// Warframe 版はネイティブスクロール（`overflow: auto`）の上にドラッグを重ねる
// 形だったが、こちらは拡大縮小が要る。スクロール位置と拡大率を別々に持つと
// 「拡大したら見ていた場所が飛ぶ」が避けられないので、**両方をひとつの
// 変換行列に寄せる**——描画そのものは触らず、内容を包む `<g>` の transform
// だけを動かす。
//
// 拡大率と位置は**絵ごと**に保つ（`viewKey`）。達成をトグルしただけで描き直しが
// 走るので、そのたびに表示が初期位置へ戻ると手元が飛ぶ。潜って別のノードへ
// 移ったときだけリセットする。鍵をノード id にしていたが、地図は**どのゴールを
// 選んでいても同じ1枚**なので、そこだけ固定の鍵を渡している（2026-09-12）。

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
/** ホイール1目盛りあたりの倍率の効き。大きいと1回で飛びすぎる。 */
const WHEEL_SENSITIVITY = 0.0015;
/** ピンチ（トラックパッドの2本指の開閉）用の効き。
 *
 * ブラウザはピンチのときだけ `wheel` に `ctrlKey` を立てる、という決まりがある。
 * 送られてくる `deltaY` はホイール1目盛り（100前後）より**一桁小さい**ので、
 * 同じ係数を使うと指を大きく開いてもほとんど動かない。ここだけ分ける。
 *
 * **トラックパッドの実機で確かめていない**（この環境に無い）。効きが合わなければ
 * この定数だけで調整できる。 */
const PINCH_SENSITIVITY = 0.01;
/** これ以上動いたらドラッグとみなし、離したときのクリックを飲む。
 *  小さすぎると手ぶれでノードが選べなくなる。 */
const DRAG_SLOP_PX = 4;

interface ViewportState {
  key: string;
  k: number;
  tx: number;
  ty: number;
  /** 初期位置（リセット判定とリセット先）。 */
  base: { k: number; tx: number; ty: number };
}

let current: ViewportState | undefined;

/** 直前の mouseup がドラッグの終わりだったか。次のクリック1回で消費する。 */
let dragEndPending = false;

/**
 * 「今のクリックはドラッグの後始末か」を1回だけ返す。ノードのクリック処理が
 * 頭で呼ぶ。
 *
 * 表示窓の中で押したものは全部この mousedown を通るので（リセットボタンも
 * 含む）、合図は押し直すたびに捨てられる。消費されないまま残って**次に押した
 * ものが何であれ飲まれる**、という取りこぼしが起きない。
 */
export function consumeDragEnd(): boolean {
  const pending = dragEndPending;
  dragEndPending = false;
  return pending;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** ホイールの単位差（ピクセル / 行 / ページ）を吸収する。 */
function wheelDelta(e: WheelEvent, viewportH: number): number {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * viewportH;
  return e.deltaY;
}

export interface MountViewportOptions {
  /** 表示窓。ここに収まらないぶんは変換で動かす（スクロールバーは出さない）。 */
  wrap: HTMLElement;
  /** 内容を包む `<g>`。transform はこれにだけ書く。 */
  view: SVGGElement;
  /** 拡大率（リセット）ボタンの置き場。表示窓は子が無いと 140px に縮むので、
   *  そこに置くと隅の高さがノードの並びで動く。凡例と同じくペインへ固定する。 */
  host: HTMLElement;
  /** この絵を指す鍵。**変わるとリセット**する。詳細はフォーカスノードの id、
   *  地図は1枚ぶんの固定値（`graph-view.ts` の `MAP_VIEW_KEY`）。 */
  viewKey: string;
  contentW: number;
  contentH: number;
  /** ドラッグ・拡大縮小の最中に開いていると位置がずれるものを閉じる。 */
  onInteract?: () => void;
}

/**
 * `wrap` に拡大縮小（ホイール）と移動（ドラッグ）を配線する。
 *
 * 要素は描き直しのたびに作り直されるので、リスナーもそのたびに張り直す
 * （要素と一緒に捨てられる）。持ち越すのは変換の値だけ。
 */
export function mountViewport(opts: MountViewportOptions): void {
  const { wrap, view, host, viewKey, contentW, contentH, onInteract } = opts;

  const vw = wrap.clientWidth;
  const vh = wrap.clientHeight;
  // 横は中央。縦は、収まるなら中央・はみ出すなら上端。
  //
  // 以前は縦を常に上端に置いていた。ビューポートを入れる前と同じ見え方に
  // するためだったが、末端に近いノードだと2つの丸が上 1/4 に貼り付いて、
  // 残り 600px が空白になる（のっち報告）。はみ出すときに上端なのは要る——
  // 上から下へ辿る道具なので、切れるなら下であってほしい。
  const ty = contentH < vh ? (vh - contentH) / 2 : 0;
  const base = { k: 1, tx: (vw - contentW) / 2, ty };

  if (!current || current.key !== viewKey) {
    current = { key: viewKey, ...base, base };
  } else {
    // 同じノードを描き直しただけ。ペイン幅が変わっていることはあるので
    // リセット先だけ更新する。
    current.base = base;
  }
  const st = current;

  // 触った後にだけ出す。常時置くと、拡大していない間もずっと数字が居座る。
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "graph-reset hidden";
  resetBtn.title = "表示を元に戻す";
  resetBtn.addEventListener("click", () => {
    st.k = st.base.k;
    st.tx = st.base.tx;
    st.ty = st.base.ty;
    apply();
  });
  host.append(resetBtn);

  // 内容を表示窓の外へ完全に追い出せないようにする。制限が無いと、上へ少し
  // ドラッグしただけでノードが上端から消え、戻す手段がリセットボタンしか
  // 残らない（のっち報告）。端が必ず KEEP_PX ぶん窓に残る位置まで戻す。
  //
  // ドラッグと拡大の両方の経路から呼ばれるよう apply の中でやる。片方だけに
  // 書くと、拡大して外へ出す道が開いたままになる。
  /** 動かせる範囲。**内容の縁より外は見せない。**
   *
   * 窓に収まっているなら内容ごと窓の中に留める（動かしても切れない）。
   * はみ出しているなら縁で止める（外側に余白を作らない）。端を何 px か
   * 残す形にしていた時期があるが、収まっている絵まで切れる位置へ動かせて
   * 「変なところで見切れる」（のっち報告）。 */
  const range = (content: number, viewport: number): [number, number] =>
    content <= viewport ? [0, viewport - content] : [viewport - content, 0];

  const clampPan = (): void => {
    // 窓が測れないときは何もしない（happy-dom の clientWidth / clientHeight は
    // 0 を返す）。0 のまま計算すると初期位置ですら範囲外と見なしてしまう。
    if (vw <= 0 || vh <= 0) return;
    st.tx = clamp(st.tx, ...range(contentW * st.k, vw));
    st.ty = clamp(st.ty, ...range(contentH * st.k, vh));
  };

  const apply = (): void => {
    clampPan();
    view.setAttribute("transform", `translate(${st.tx} ${st.ty}) scale(${st.k})`);
    const moved = st.k !== st.base.k || Math.abs(st.tx - st.base.tx) > 0.5 || Math.abs(st.ty - st.base.ty) > 0.5;
    resetBtn.classList.toggle("hidden", !moved);
    resetBtn.textContent = `${Math.round(st.k * 100)}%`;
  };

  wrap.addEventListener(
    "wheel",
    (e) => {
      // 表示窓は overflow: hidden なので、既定動作はページ側のスクロールに
      // 化けるだけ。ここで止める（passive にできないのはこのため）。
      e.preventDefault();
      onInteract?.();
      const rect = wrap.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // `ctrlKey` はピンチの合図。既定動作はブラウザ全体の拡大なので、
      // `preventDefault()` していなければページごと拡大されていた。
      const sensitivity = e.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
      const next = clamp(st.k * Math.exp(-wheelDelta(e, rect.height) * sensitivity), MIN_SCALE, MAX_SCALE);
      if (next === st.k) return;
      // カーソルの下にある点を動かさない。中心を基準にすると、拡大するほど
      // 見たかった場所が画面外へ逃げる。
      st.tx = px - (px - st.tx) * (next / st.k);
      st.ty = py - (py - st.ty) * (next / st.k);
      st.k = next;
      apply();
    },
    { passive: false },
  );

  wrap.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // 左だけ。右・中は触らない
    // 前のドラッグの合図が消費されずに残っていることがある（窓の外で指を
    // 離すと、その後にクリックが来ない）。押し直した時点で必ず捨てる。
    // タイマーで外す方式は、本物のクリックとの前後関係がブラウザ任せになる。
    dragEndPending = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const originTx = st.tx;
    const originTy = st.ty;
    let dragged = false;
    // ノード名の上でドラッグを始めたときのテキスト選択とゴースト画像を止める。
    // 動かさずに離したときのクリック（ノード選択）は消えない。
    e.preventDefault();

    const move = (ev: MouseEvent): void => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP_PX) return;
      if (!dragged) {
        dragged = true;
        wrap.classList.add("dragging");
        onInteract?.();
      }
      st.tx = originTx + dx;
      st.ty = originTy + dy;
      apply();
    };

    const up = (): void => {
      // 窓の外へ出てもドラッグを続けるため、window で受ける。
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      wrap.classList.remove("dragging");
      // 掴んで動かした指を離した先にノードがあると、そのまま選択されてしまう。
      // 直後のクリックを1回だけ飲ませる合図を立てる。
      if (dragged) dragEndPending = true;
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  });

  apply();
}

/** フォーカスが外れた（グラフを離れた）ときに、持ち越している変換を捨てる。 */
export function resetViewport(): void {
  current = undefined;
}
