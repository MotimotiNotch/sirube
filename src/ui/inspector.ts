// 右パネル。選択中のノードの詳細と、そこからの操作。
//
// ここに置く操作は「分解する」「達成をトグルする」の2つが主役。
// 分解こそがこのツールで人間にしかできないことなので、常に手の届く位置に置く。

import { inDegree, progress, resolveState, type ReverseIndex } from "../core/engine.ts";
import { isGoal } from "../core/goals.ts";
import { GOAL_COLORS, isGoalColor, type GoalColor, type Graph, type NodeState } from "../core/model.ts";
import { COLOR_LABEL, h, iconSpan, stateBadge, stateDot } from "./dom.ts";

export interface InspectorCallbacks {
  onToggle(id: string): void;
  /** 上向きのリンク（これを待っている／属する先）から、その親へ移る。
   *
   * 右パネルだけ差し替える形にしていたが、**グラフとパンくずが元のノードの
   * まま残って画面の3箇所が食い違った**（のっち報告 2026-09-03）。ここは
   * 「その親を見に行く」ための移動手段——合流ノードから他の親へ渡る唯一の道
   * でもある——なので、押したら画面ごと移す。 */
  onFocus(id: string): void;
  onBulkAdd(id: string): void;
  onNoteChange(id: string, note: string): void;
  onRename(id: string, name: string): void;
  onDelete(id: string): void;
  /** 付箋の色を貼る／外す（`undefined` で外す）。 */
  onColor(id: string, color: GoalColor | undefined): void;
  /** ゴールとして浮上させる／やめる。 */
  onGoal(id: string, on: boolean): void;
  /** `parentId` から選択中のノードへの繋がりだけを切る（ノードは残す）。 */
  onDetach(parentId: string, childId: string): void;
}

export function renderInspector(
  container: HTMLElement,
  graph: Graph,
  selectedId: string | undefined,
  rev: ReverseIndex,
  cyclic: ReadonlySet<string>,
  cb: InspectorCallbacks,
): void {
  container.replaceChildren();

  if (!selectedId || !graph.nodes[selectedId]) {
    container.append(h("div", { class: "insp-empty" }, ["ノードを選ぶとここに出ます"]));
    return;
  }
  const node = graph.nodes[selectedId];
  const state: NodeState = resolveState(graph, selectedId, cyclic);

  // 名前と、その場で書き換える口。改名は `name` の1行を書き換えるだけで済み
  // 参照は id のままなので切れない——という設計にしておきながら、アプリから
  // 変える手段が無かった（2026-09-02 の棚卸し）。モーダルにせず見出しをその場で
  // 入力欄に差し替えるのは、改名が「開いて確認して閉じる」ほどの操作ではないため。
  const nameRow = h("div", { class: "insp-name-row" });
  const nameEl = h("h3", { class: "insp-name" }, [node.name]);
  const renameBtn = h("button", { class: "icon-btn", type: "button", title: "名前を変える" });
  renameBtn.append(iconSpan("pencil", 13));
  const startRename = (): void => {
    const input = h("input", { class: "insp-rename", type: "text" }) as HTMLInputElement;
    input.value = node.name;
    const finish = (commit: boolean): void => {
      if (input.parentElement !== nameRow) return; // 二重発火（Enter → blur）を無視
      nameRow.replaceChildren(nameEl, renameBtn);
      if (commit) cb.onRename(selectedId, input.value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
      // 取り消せる口を必ず用意する。名前は消えると参照から辿るしかなくなる。
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    nameRow.replaceChildren(input);
    input.focus();
    input.select();
  };
  renameBtn.addEventListener("click", startRename);
  nameEl.addEventListener("dblclick", startRename);
  nameRow.append(nameEl, renameBtn);
  container.append(nameRow);

  const row = h("div", { class: "insp-row" });
  // 番号はここに置く。見出し（名前）の横に出すと改名の入力欄と場所を取り合う。
  if (node.number !== undefined) {
    row.append(h("span", { class: "insp-number", title: "このノードの番号" }, [`#${node.number}`]));
  }
  row.append(stateBadge(state));
  if (node.due) row.append(h("span", { class: "hit-indegree" }, [`期限 ${node.due}`]));
  container.append(row);

  // 進捗（自分を含む子孫の達成率）
  const p = progress(graph, selectedId);
  if (p.total > 1) {
    const prow = h("div", { class: "insp-row" });
    const bar = h("div", { class: "progress-bar" });
    bar.append(h("div", { class: "progress-fill", style: `width:${Math.round((p.done / p.total) * 100)}%` }));
    prow.append(bar, h("span", { class: "progress-label" }, [`${p.done}/${p.total}`]));
    container.append(prow);
  }

  // 主要な操作
  const actions = h("div", { class: "insp-row" });
  const toggle = h("button", { class: `btn${state === "SATISFIED" ? "" : " primary"}`, type: "button" });
  toggle.append(iconSpan("circleCheck", 14), state === "SATISFIED" ? "達成を取り消す" : "達成にする");
  toggle.addEventListener("click", () => cb.onToggle(selectedId));
  actions.append(toggle);

  const bulk = h("button", { class: "btn", type: "button" });
  bulk.append(iconSpan("plus", 14), "前提を一括追加");
  bulk.addEventListener("click", () => cb.onBulkAdd(selectedId));
  actions.append(bulk);
  container.append(actions);

  if (state === "CYCLIC") {
    const warn = h("div", { class: "cycle-notice" });
    const t = h("h3");
    t.append(iconSpan("repeat", 14), "輪の上にいます");
    warn.append(t);
    warn.append(
      h("p", {}, [
        "このノードを2つに割ると輪がほどけることがあります（例:「案件を取る」→「小さい案件」「大きい案件」）。「前提を一括追加」で分解できます。",
      ]),
    );
    container.append(warn);
  }

  // ゴール宣言。**中腹を地図へ浮上させる1ビット**（2026-09-11）。
  //
  // 実データで目的が1つに畳まれ、64ノードが根から11段下までぶら下がった。
  // 「それ全部を1つの目的に入れると、深いところが遠くなってカオスマップになる」
  // （のっち）。かといって切り離すと、何のためにあったのかが消える。**位置は
  // そのままで、入口としても扱う**ためにここで指す。
  {
    // 誰からも要求されていないノードは、書かなくてもゴール。ここで外させない
    // ——外しても次の読み込みでまたゴールに戻るので、効かないボタンになる。
    const auto = inDegree(selectedId, rev) === 0;
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan("compass", 12), "ゴール");
    sec.append(head);
    if (auto) {
      sec.append(h("p", { class: "insp-note" }, ["どこからも要求されていないので、自動でゴールです。"]));
    } else {
      const on = node.goal === true;
      const btn = h("button", { class: `btn${on ? " primary" : ""}`, type: "button", "aria-pressed": on ? "true" : "false" });
      btn.append(iconSpan("compass", 14), on ? "ゴールをやめる" : "ゴールにする");
      btn.addEventListener("click", () => cb.onGoal(selectedId, !on));
      sec.append(btn);
      sec.append(
        h("p", { class: "insp-note" }, [
          on
            ? "地図に出ます。ここまでの道は畳まれ、間の件数だけが線に残ります。"
            : "地図に出したいときに押します。構造は変わりません（状態も進捗もそのまま）。",
        ]),
      );
    }
    container.append(sec);
  }

  // 付箋。**ゴールにだけ貼れる。**
  //
  // 末端まで貼れるようにすると、それは model.ts の原則4 が禁じているタグその
  // ものになる。原則が代替として挙げる「優先度＝合流点の入次数」「分類＝エッジ」
  // はゴールには効かない（ゴール同士を結ぶのは縮約した線で、そこにタグの
  // 代わりは無い）ので、そこだけを例外として開けている。
  //
  // 判定を入次数0から `isGoal` へ広げた（2026-09-11）。目的が1本に畳まれた
  // 瞬間、貼れる先が2件に減って**機能ごと死んでいた**。宣言したゴールにも
  // 貼れれば元の用途（この2つは同じ話／今期はこれ）に戻る。
  //
  // 色に序列は付けない。同じ色を2つの目的に貼れば、それがそのまま括りになる。
  if (isGoal(graph, selectedId, rev)) {
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan("stickyNote", 12), "付箋");
    sec.append(head);

    const row = h("div", { class: "swatch-row" });
    const current = isGoalColor(node.color) ? node.color : undefined;
    const swatch = (color: GoalColor | undefined): HTMLButtonElement => {
      const on = current === color;
      const b = h("button", {
        class: `swatch${color === undefined ? " swatch-none" : ` swatch-${color}`}${on ? " on" : ""}`,
        type: "button",
        title: color === undefined ? "貼らない" : COLOR_LABEL[color],
        "aria-pressed": on ? "true" : "false",
      });
      // 押した色をもう一度押したら外す。「貼らない」まで手を伸ばさずに戻せる。
      b.addEventListener("click", () => cb.onColor(selectedId, on ? undefined : color));
      return b;
    };
    row.append(swatch(undefined));
    for (const c of GOAL_COLORS) row.append(swatch(c));
    sec.append(row);
    container.append(sec);
  }

  const linkList = (
    title: string,
    iconName: Parameters<typeof iconSpan>[0],
    ids: string[],
  ): void => {
    if (ids.length === 0) return;
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan(iconName, 12), `${title}（${ids.length}）`);
    sec.append(head);
    const list = h("div", { class: "insp-list" });
    for (const id of ids) {
      const child = graph.nodes[id];
      const row = h("div", { class: "insp-link-row" });
      const btn = h("button", { class: "insp-link", type: "button" });
      btn.append(child ? stateDot(resolveState(graph, id, cyclic)) : stateDot("BLOCKED"));
      btn.append(h("span", {}, [child?.name ?? `${id}（未作成）`]));
      btn.addEventListener("click", () => cb.onFocus(id));

      // この繋がりだけを切る。**確認は挟まない**——ノードは残るし、戻すのは
      // 「まとめて追加」に1行書くだけで済む（既存の名前を書けばそこへ繋がる）。
      // 代わりにホバーで出す形にして、置いてあるだけで押される事故を避ける。
      const cut = h("button", {
        class: "icon-btn insp-cut",
        type: "button",
        title: `${child?.name ?? id} との繋がりを外す（ノードは残る）`,
      });
      cut.append(iconSpan("x", 12));
      cut.addEventListener("click", () => cb.onDetach(id, selectedId));

      row.append(btn, cut);
      list.append(row);
    }
    sec.append(list);
    container.append(sec);
  };

  // 下向き（これが必要／これで構成）は出さない。Chain View が同じものを
  // 描いており、ボックスもクリックでドリルできて状態色も付いている。完全な重複。
  //
  // 上向きは Chain View に無いので残す。グラフは下向きしか描かず、パンくずは
  // 自分が辿ってきた道しか持たないため、親が複数ある合流ノードでは
  // ここを消すと他の親に到達できなくなる。
  linkList("これを待っている", "listChecks", rev.requiredBy.get(selectedId) ?? []);
  linkList("属する先", "chevronRight", rev.containedBy.get(selectedId) ?? []);

  // メモ（Markdown 本文そのもの。Obsidian で開いても同じものが見える）
  const noteSec = h("div", { class: "insp-section" });
  const noteHead = h("h4");
  noteHead.append(iconSpan("pencil", 12), "メモ");
  noteSec.append(noteHead);
  const area = h("textarea", { class: "note-area", placeholder: "このノードについてのメモ" }) as HTMLTextAreaElement;
  area.value = node.note;
  area.addEventListener("blur", () => {
    if (area.value !== node.note) cb.onNoteChange(selectedId, area.value);
  });
  noteSec.append(area);
  container.append(noteSec);

  // 削除は押した瞬間に消え、参照の掃除まで走る。取り消しも無いので、その場で
  // 一度受け止める（2026-09-02 の棚卸し。押した瞬間に消えることを実機で確認した）。
  //
  // 消える件数だけでなく**「目的」が何件生えるか**も先に言う。ルート判定が
  // 入次数0なので、中間ノードを消すとその子が目的としてサイドバーに現れる——
  // 構造としては正しいが、削除の副作用としては予想できない。
  const delBox = h("div", { class: "insp-delete" });
  const del = h("button", { class: "btn danger", type: "button" });
  del.append(iconSpan("trash2", 14), "このノードを削除");
  del.addEventListener("click", () => {
    const orphans = (node.requires.concat(node.contains)).filter(
      (childId) => graph.nodes[childId] && inDegree(childId, rev) === 1,
    );
    delBox.replaceChildren();
    const warn = h("div", { class: "insp-confirm-text" }, [`「${node.name}」を削除します。取り消せません。`]);
    delBox.append(warn);
    if (orphans.length > 0) {
      delBox.append(
        h("div", { class: "insp-confirm-note" }, [
          `${orphans.length} 件（${orphans.map((id) => graph.nodes[id]!.name).join("・")}）が目的として一覧に出るようになります。`,
        ]),
      );
    }
    const row = h("div", { class: "insp-row", style: "margin:8px 0 0" });
    const yes = h("button", { class: "btn danger", type: "button" }, ["削除する"]);
    yes.addEventListener("click", () => cb.onDelete(selectedId));
    const no = h("button", { class: "btn", type: "button" }, ["やめる"]);
    no.addEventListener("click", () => {
      delBox.replaceChildren(del);
    });
    row.append(yes, no);
    delBox.append(row);
  });
  delBox.append(del);
  container.append(delBox);
}
