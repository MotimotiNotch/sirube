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

  const finish = (message: string): void => {
    step = undefined;
    markTourDone();
    clearTarget();
    card?.remove();
    card = undefined;
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

  const update = (): void => {
    if (!step) return;
    advance();
    if (!step) return;
    clearTarget();
    target()?.classList.add(TARGET_CLASS);
    renderCard();
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
