// 初回起動のチュートリアル（2026-09-25、のっち要望。チケット「初回起動のチュートリアルを作る」）。
//
// 本物の画面の上で本物の操作をしてもらう。スライドで説明を読ませない——表示量の
// 原則3「説明文は初回しか読まれない」と同じ失敗になるため。押す場所を光らせて
// 一言添え、**操作が済んだかはグラフの状態から判定して**次へ進む。ボタンの押下を
// 数えないのは、同じことに入口が複数あるから（目的は「＋」でも「まとめて追加」
// でも作れる）。どの入口から来ても、結果のグラフが同じなら同じ手順を終えている。
//
// 手順は 目的 → 前提 → 中身 → 達成 → 片付け。前提と中身を同じ目的に両方付けない
// （判別基準「揃ったあと、まだ自分でやることが残っているか」と矛盾する）ので、
// 中身は前提の下に作る:
//
//   引っ越す（目的）
//     └ 前提: 荷造りを終える
//               └ 中身: 本を箱に詰める / 服を箱に詰める
//
// 中身を全部達成にすると「荷造りを終える」が自動で達成になり、「引っ越す」が
// 「今やれる」に変わる。前提・中身・達成が1本で繋がって見える。

import type { Graph } from "../core/model.ts";
import { resolveState } from "../core/engine.ts";
import { h } from "./dom.ts";

/** 済んだ（またはスキップした）印。vault ではなくアプリ単位で持つ——別の空の
 *  フォルダを開くたびに出ると、2回目からはただの邪魔になる。 */
export const TOUR_DONE_KEY = "sirube.tour.done";

export interface TutorialDeps {
  graph(): Graph;
  cyclic(): ReadonlySet<string>;
  selectedId(): string | undefined;
  /** 残りをまとめて消す。消した後の描き直しまで呼び出し側がやる。 */
  deleteNodes(ids: string[]): Promise<void>;
}

export interface Tutorial {
  start(): void;
  /** 描き直しのたびに呼ぶ。進み具合の判定と、光らせる場所の付け直し。 */
  update(): void;
  active(): boolean;
}

type Step = "goal" | "requires" | "contains" | "achieve" | "delete" | "cleanup";
const NUMBERED: Step[] = ["goal", "requires", "contains", "achieve", "delete"];

const TARGET_CLASS = "tour-target";

// ---- 暗くする幕と、案内カードの置き場所（2026-09-25、のっち要望） ----
//
// 押す場所以外を暗くし、**暗いところは押せなくする**（のっち決定）。幕は1枚の
// 固定要素で、押す場所の形に clip-path で穴を開ける。穴の部分は幕が無いのと同じ
// なので、下のボタンがそのまま押せる。押す場所の要素に影を付けて周りを塗る方法は
// 取らない——グラフのノードは SVG の <g> で影が描けず、スクロールする枠の中では
// 影が枠で切れる。
//
// モーダルが開いている間は幕を出さない。モーダルは自分の背景で既に暗く、押せなく
// なっているので、重ねると二重に暗くなるうえ、書く欄（前提・中身の名前）まで
// 塞いでしまう。

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 穴の周りの余白と角の丸み。押す場所の枠（outline-offset 2px + 2px）が穴に収まる大きさ。 */
const HOLE_PAD = 6;
const HOLE_RADIUS = 8;
/** カードと押す場所の間、カードと画面の端の間。 */
const CARD_GAP = 12;
const CARD_MARGIN = 8;

const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const pad = (r: Rect, p: number): Rect => ({ left: r.left - p, top: r.top - p, right: r.right + p, bottom: r.bottom + p });

/** 画面と重なる部分があるか。幅や高さが0のもの（描かれていない要素）は見えていない扱い。 */
export function visibleIn(r: Rect, vw: number, vh: number): boolean {
  return r.right > r.left && r.bottom > r.top && intersects(r, { left: 0, top: 0, right: vw, bottom: vh });
}

/** 幕の clip-path。画面全体の矩形から、穴を evenodd でくり抜く。 */
export function shadePath(holes: Rect[], vw: number, vh: number): string {
  const n = (v: number): string => String(Math.round(v * 10) / 10);
  let d = `M0 0H${n(vw)}V${n(vh)}H0Z`;
  for (const h0 of holes) {
    const h = pad(h0, HOLE_PAD);
    const w = h.right - h.left;
    const ht = h.bottom - h.top;
    const r = Math.min(HOLE_RADIUS, w / 2, ht / 2);
    d +=
      `M${n(h.left + r)} ${n(h.top)}H${n(h.right - r)}A${n(r)} ${n(r)} 0 0 1 ${n(h.right)} ${n(h.top + r)}` +
      `V${n(h.bottom - r)}A${n(r)} ${n(r)} 0 0 1 ${n(h.right - r)} ${n(h.bottom)}` +
      `H${n(h.left + r)}A${n(r)} ${n(r)} 0 0 1 ${n(h.left)} ${n(h.bottom - r)}` +
      `V${n(h.top + r)}A${n(r)} ${n(r)} 0 0 1 ${n(h.left + r)} ${n(h.top)}Z`;
  }
  return `path(evenodd, "${d}")`;
}

/**
 * 案内カードの置き場所。押す場所の下 → 上 → 右 → 左の順に試し、画面に収まって
 * `avoid`（押す場所と、書く欄を含むモーダル）のどれにも被らない最初の位置を返す。
 * 押す場所の周りに置けなければ、avoid 全体の外側で同じ順に試す（モーダルの中の
 * タブを押すときは、モーダルの横に出る）。どこにも置けなければ undefined——
 * 呼び出し側は今までどおり左下に置く。
 */
export function placeCard(
  anchors: Rect[],
  avoid: Rect[],
  size: { w: number; h: number },
  vw: number,
  vh: number,
): { left: number; top: number } | undefined {
  const { w, h } = size;
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const fits = (left: number, top: number): boolean => {
    if (left < CARD_MARGIN || top < CARD_MARGIN || left + w > vw - CARD_MARGIN || top + h > vh - CARD_MARGIN) return false;
    const box = { left, top, right: left + w, bottom: top + h };
    return !avoid.some((a) => intersects(box, pad(a, CARD_GAP / 2)));
  };
  for (const r of anchors) {
    const x = clamp(r.left, CARD_MARGIN, vw - w - CARD_MARGIN);
    const y = clamp(r.top, CARD_MARGIN, vh - h - CARD_MARGIN);
    const candidates: Array<[number, number]> = [
      [x, r.bottom + CARD_GAP],
      [x, r.top - CARD_GAP - h],
      [r.right + CARD_GAP, y],
      [r.left - CARD_GAP - w, y],
    ];
    for (const [left, top] of candidates) if (fits(left, top)) return { left, top };
  }
  return undefined;
}

const union = (rs: Rect[]): Rect => ({
  left: Math.min(...rs.map((r) => r.left)),
  top: Math.min(...rs.map((r) => r.top)),
  right: Math.max(...rs.map((r) => r.right)),
  bottom: Math.max(...rs.map((r) => r.bottom)),
});

export function readTourDone(): boolean {
  try {
    return localStorage.getItem(TOUR_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markTourDone(): void {
  try {
    localStorage.setItem(TOUR_DONE_KEY, "1");
  } catch {
    // 書けなければ次もまた出るだけ。操作は止めない。
  }
}

export function createTutorial(deps: TutorialDeps, onFinish: (message: string) => void): Tutorial {
  let step: Step | undefined;
  /** 始めた時点で既にあったノード。ここに無いものが「チュートリアルで作ったもの」。 */
  let before = new Set<string>();
  /** 一度でも現れた「作ったもの」。消えたことに気づくために、生きているものとは別に持つ。 */
  const seen = new Set<string>();
  let goalId: string | undefined;
  let prereqId: string | undefined;
  let cleanupReason: "finished" | "skipped" = "finished";
  let card: HTMLElement | undefined;

  const createdAlive = (): string[] => {
    const g = deps.graph();
    return Object.keys(g.nodes).filter((id) => !before.has(id)).sort();
  };
  const nameOf = (id: string | undefined): string => (id ? deps.graph().nodes[id]?.name ?? "" : "");
  const modalOpen = (): boolean => !document.getElementById("modal-backdrop")?.classList.contains("hidden");
  const nodeEl = (id: string | undefined): Element | null =>
    id ? document.querySelector(`[data-node-id="${CSS.escape(id)}"]`) : null;
  const tour = (name: string): Element | null => document.querySelector(`[data-tour="${name}"]`);

  const clearTarget = (): void => {
    for (const el of Array.from(document.querySelectorAll(`.${TARGET_CLASS}`))) el.classList.remove(TARGET_CLASS);
  };

  let shade: HTMLElement | undefined;
  let lastTarget: Element | null = null;

  const finish = (message: string): void => {
    step = undefined;
    markTourDone();
    clearTarget();
    card?.remove();
    card = undefined;
    shade?.remove();
    shade = undefined;
    lastTarget = null;
    onFinish(message);
  };

  /** 片付けへ。作ったものが1件も残っていなければ聞かずに終える。 */
  const toCleanup = (reason: "finished" | "skipped"): void => {
    cleanupReason = reason;
    if (createdAlive().length === 0) {
      finish("チュートリアルを終えました。ヘッダーの「使い方」からいつでもやり直せます。");
      return;
    }
    step = "cleanup";
  };

  /** グラフを見て、済んだ手順を先へ送る。1回の描き直しで複数進むことがある
   *  （例: 中身を全部達成にした瞬間に、達成の手順が済む）。 */
  const advance = (): void => {
    const g = deps.graph();
    for (const id of createdAlive()) seen.add(id);
    for (let guard = 0; guard < 6; guard++) {
      // 片付けは聞いている最中。グラフを見て進める手順ではない（見ると、消えた
      // 前提を「前提の手順へ戻る」と読んでしまう）。
      if (step === "cleanup") return;
      const created = new Set(createdAlive());
      if (step === "goal") {
        // 作ったものの中で、作ったものから参照されていないもの＝目的。
        const referenced = new Set([...created].flatMap((id) => [...g.nodes[id]!.requires, ...g.nodes[id]!.contains]));
        const root = [...created].find((id) => !referenced.has(id));
        if (!root) return;
        goalId = root;
        step = "requires";
        continue;
      }
      const goal = goalId ? g.nodes[goalId] : undefined;
      if (!goal) {
        // 目的を途中で消された。最初からやり直してもらう方が、途中の手順を
        // 別の目的へ付け替えるより分かりやすい。
        goalId = undefined;
        prereqId = undefined;
        step = "goal";
        continue;
      }
      if (step === "requires") {
        const p = [...goal.requires, ...goal.contains].find((id) => created.has(id));
        if (!p) return;
        prereqId = p;
        step = "contains";
        continue;
      }
      const prereq = prereqId ? g.nodes[prereqId] : undefined;
      if (!prereq) {
        prereqId = undefined;
        step = "requires";
        continue;
      }
      if (step === "contains") {
        if (!prereq.contains.some((id) => created.has(id))) return;
        step = "achieve";
        continue;
      }
      if (step === "achieve") {
        const st = resolveState(g, goal.id, deps.cyclic());
        if (st !== "ACTIONABLE" && st !== "SATISFIED") return;
        step = "delete";
        continue;
      }
      if (step === "delete") {
        const deleted = [...seen].some((id) => !g.nodes[id]);
        if (!deleted) return;
        toCleanup("finished");
        return;
      }
      return;
    }
  };

  /** 末端（中身）のうち最初のもの。達成の手順ではまだ未達のもの、片付けでは何でも。 */
  const leaf = (unsatisfiedOnly: boolean): string | undefined => {
    const g = deps.graph();
    const prereq = prereqId ? g.nodes[prereqId] : undefined;
    if (!prereq) return undefined;
    return prereq.contains.find((id) => g.nodes[id] && !before.has(id) && (!unsatisfiedOnly || !g.nodes[id]!.satisfied));
  };

  /** 今の手順で光らせる場所。**選ぶべきノードを選んでいなければ、まずそのノード。** */
  const target = (): Element | null => {
    const sel = deps.selectedId();
    const pick = (id: string | undefined, then: () => Element | null): Element | null =>
      id && sel !== id ? nodeEl(id) : then();
    switch (step) {
      case "goal":
        return modalOpen() ? null : document.getElementById("new-root-btn");
      case "requires":
        return pick(goalId, () => (modalOpen() ? tour("tab-requires") : tour("decompose")));
      case "contains":
        return pick(prereqId, () => (modalOpen() ? tour("tab-contains") : tour("decompose")));
      case "achieve":
        return pick(leaf(true), () => tour("toggle"));
      case "delete":
        return pick(leaf(false), () => tour("delete-confirm") ?? tour("delete") ?? tour("more"));
      default:
        return null;
    }
  };

  const body = (): string => {
    const goal = `『${nameOf(goalId)}』`;
    const prereq = `『${nameOf(prereqId)}』`;
    const sel = deps.selectedId();
    switch (step) {
      case "goal":
        return "左の「目的」の ＋ から、達成したいことを1つ作ります。例: 引っ越す（自分の目的をそのまま書いても大丈夫です）";
      case "requires":
        return sel !== goalId
          ? `まず${goal}を選んでください。`
          : `右の「分解する」の「前提」タブに、${goal}には何が必要かを書きます。例: 荷造りを終える。前提ができると${goal}は「前提待ち」になります。`;
      case "contains":
        return sel !== prereqId
          ? `次は${prereq}を選んでください。`
          : `「分解する」の「中身」タブに、${prereq}が何でできているかを書きます。例: 本を箱に詰める、服を箱に詰める（1行に1つ）。前提は揃ったあとも自分の作業が残るもの、中身は全部揃えば終わるもの、という違いです。`;
      case "achieve": {
        const l = leaf(true);
        return l && sel !== l
          ? `中身の『${nameOf(l)}』を選んでください。`
          : `右の「達成にする」を押します。中身が全部達成になると${prereq}は自動で達成になり、${goal}が「今やれる」に変わります。`;
      }
      case "delete": {
        const l = leaf(false);
        return l && sel !== l
          ? `${goal}が「今やれる」になりました。目的から下ろして、末端から片付ける——使い方はこれだけです。最後に片付けます。中身の『${nameOf(l)}』を選んでください。`
          : "右の一番下の「その他」→「このノードを削除」で消してみてください。直後ならヘッダーの「戻す」で戻せます。";
      }
      case "cleanup": {
        const rest = createdAlive();
        const names = rest.map((id) => nameOf(id)).join("・");
        const lead = cleanupReason === "finished" ? `残り ${rest.length} 件` : `チュートリアルで作った ${rest.length} 件`;
        return `${lead}（${names}）もまとめて削除しますか？ 自分の目的を書いた場合は残してください。`;
      }
      default:
        return "";
    }
  };

  const renderCard = (): void => {
    if (!step) return;
    if (!card) {
      card = h("div", { class: "tour-card", role: "dialog", "aria-label": "チュートリアル" });
      document.body.append(card);
    }
    const idx = NUMBERED.indexOf(step);
    const head = h("div", { class: "tour-head" }, [
      h("span", { class: "tour-title" }, ["使い方"]),
      h("span", { class: "tour-count" }, [idx >= 0 ? `${idx + 1} / ${NUMBERED.length}` : "片付け"]),
    ]);
    const actions = h("div", { class: "tour-actions" });
    if (step === "cleanup") {
      const del = h("button", { class: "btn danger", type: "button" }, ["まとめて削除"]);
      del.addEventListener("click", async () => {
        const ids = createdAlive();
        await deps.deleteNodes(ids);
        finish(`${ids.length} 件を削除しました。ヘッダーの「使い方」からいつでもやり直せます。`);
      });
      const keep = h("button", { class: "btn", type: "button" }, ["残す"]);
      keep.addEventListener("click", () => finish("残しました。ヘッダーの「使い方」からいつでもやり直せます。"));
      actions.append(keep, del);
    } else {
      const skip = h("button", { class: "btn", type: "button" }, ["スキップ"]);
      skip.addEventListener("click", () => {
        toCleanup("skipped");
        update();
      });
      actions.append(skip);
    }
    card.replaceChildren(head, h("p", { class: "tour-body" }, [body()]), actions);
  };

  /**
   * 幕の穴とカードの位置を、今の画面に合わせて置き直す。
   *
   * 幕を出すのは「モーダルが閉じていて、押す場所が画面に見えている」ときと、
   * 押す場所の無い片付けのとき（カードのボタンだけが押せればよい）。押す場所が
   * 見つからない・画面の外にあるときは幕を出さない——グラフのノードがパンで
   * 画面外に出ていると、幕で塞いだままでは戻す手段が無くなる。
   */
  const layout = (): void => {
    if (!step || !card) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const t = document.querySelector(`.${TARGET_CLASS}`);
    const tr = t?.getBoundingClientRect();
    const tRect: Rect | undefined = tr && visibleIn(tr, vw, vh) ? tr : undefined;
    const open = modalOpen();

    // 押す場所の他に開けておく所。削除の手順の案内で「ヘッダーの『戻す』で戻せます」
    // と書いているので、消した直後は「戻す」も押せるようにしておく。
    const extra: Rect[] = [];
    if (step === "delete" || step === "cleanup") {
      const undo = document.getElementById("undo-btn");
      const ur = undo && !undo.classList.contains("hidden") ? undo.getBoundingClientRect() : undefined;
      if (ur && visibleIn(ur, vw, vh)) extra.push(ur);
    }

    const wantShade = !open && (tRect !== undefined || step === "cleanup");
    if (wantShade) {
      if (!shade) {
        shade = h("div", { class: "tour-shade", "aria-hidden": "true" });
        document.body.append(shade);
      }
      const clip = shadePath(tRect ? [tRect, ...extra] : extra, vw, vh);
      if (shade.style.clipPath !== clip) shade.style.clipPath = clip;
    } else if (shade) {
      shade.remove();
      shade = undefined;
    }

    // カードは押す場所の近く。モーダルの中を押すときは、書く欄を塞がないように
    // モーダルごと避ける。
    // 押す場所が無くてもモーダルが開いていれば（目的の名前を書いている最中など）、
    // 書いている所の隣に置く。
    const modalEl = open ? document.getElementById("modal") : null;
    const mr0 = modalEl?.getBoundingClientRect();
    const mr: Rect | undefined = mr0 && visibleIn(mr0, vw, vh) ? mr0 : undefined;
    const avoid: Rect[] = [tRect, mr].filter((r): r is Rect => r !== undefined);
    let pos: { left: number; top: number } | undefined;
    if (avoid.length > 0) {
      const anchors = avoid.length > 1 ? [avoid[0]!, union(avoid)] : avoid;
      pos = placeCard(anchors, avoid, { w: card.offsetWidth, h: card.offsetHeight }, vw, vh);
    }
    card.classList.toggle("placed", pos !== undefined);
    const left = pos ? `${Math.round(pos.left)}px` : "";
    const top = pos ? `${Math.round(pos.top)}px` : "";
    if (card.style.left !== left) card.style.left = left;
    if (card.style.top !== top) card.style.top = top;
  };

  // 画面は描き直し以外でも動く（モーダルの開閉のアニメーション、グラフの
  // パン・ズーム、枠のスクロール、窓の大きさ）。出来事のたびに短い間だけ毎フレーム
  // 置き直す。ずっと回し続けないのは、使っていないときに何もしないため。
  let followUntil = 0;
  let following = false;
  const follow = (): void => {
    followUntil = Date.now() + 600;
    if (following || typeof requestAnimationFrame !== "function") return;
    following = true;
    const frame = (): void => {
      layout();
      if (step && Date.now() < followUntil) requestAnimationFrame(frame);
      else following = false;
    };
    requestAnimationFrame(frame);
  };

  const update = (): void => {
    if (!step) return;
    advance();
    if (!step) return;
    clearTarget();
    const t = target();
    t?.classList.add(TARGET_CLASS);
    // 押す場所が変わったら、枠の中でスクロールして見える所へ出す（幕で塞いだ後は
    // 自分ではスクロールできないため）。グラフのノードは出さない——グラフは変換で
    // 動いていて、スクロールさせると別の所がずれる。見えなければ幕を出さないだけ。
    if (t && t !== lastTarget && t instanceof HTMLElement) t.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    lastTarget = t;
    renderCard();
    layout();
    follow();
  };

  // 描き直しを通らずに画面が変わる操作がある（モーダルの開閉とタブ、削除の確認欄）。
  // そこでも光らせる場所を付け直すため、クリックとキー入力のあとに1回見直す。
  // 描き直しの後に走るよう、同期では呼ばずに次のタスクへ回す。
  let listening = false;
  const listen = (): void => {
    if (listening) return;
    listening = true;
    const later = (): void => void setTimeout(() => update(), 0);
    document.addEventListener("click", later, true);
    document.addEventListener("keyup", later, true);
    const move = (): void => {
      if (step) follow();
    };
    window.addEventListener("resize", move);
    document.addEventListener("scroll", move, true);
    document.addEventListener("wheel", move, { capture: true, passive: true });
    document.addEventListener("pointerup", move, true);
  };

  return {
    start() {
      listen();
      before = new Set(Object.keys(deps.graph().nodes));
      seen.clear();
      goalId = undefined;
      prereqId = undefined;
      step = "goal";
      update();
    },
    update,
    active: () => step !== undefined,
  };
}
