// 右パネル。選択中のノードの詳細と、そこからの操作。
//
// ここに置く操作は「分解する」「達成をトグルする」の2つが主役。
// 分解こそがこのツールで人間にしかできないことなので、常に手の届く位置に置く。

import { DUE_FORMAT, effectiveDues, inDegree, progress, resolveState, type ReverseIndex } from "../core/engine.ts";
import { isAutoGoal, isEndlessRoot, isGoal } from "../core/goals.ts";
import { GOAL_COLORS, isGoalColor, type GoalColor, type Graph, type NodeState } from "../core/model.ts";
import { nodeCreatedAt } from "../core/ulid.ts";
import { COLOR_LABEL, formatDate, formatDateTime, h, iconSpan, stateBadge, stateDot } from "./dom.ts";
import type { MenuTarget } from "./context-menu.ts";
import { renderNote } from "./note-view.ts";
import { m } from "../i18n/index.ts";

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
  /** 自分の期限を付ける／外す（`undefined` で外す）。値は `YYYY-MM-DD`。 */
  onDue(id: string, due: string | undefined): void;
  /** 右クリック。**外す（`detach`）の入口はここへ移した**（2026-09-12）——
   *  以前は行にホバーすると出る `×` で、置いてあるだけで目に入るわりに
   *  「押すと何が消えるのか」はツールチップを読むまで分からなかった。 */
  onMenu(target: MenuTarget, x: number, y: number): void;
  /** 末尾の「その他」を開く／畳む。 */
  onMore(open: boolean): void;
  /** メモを編集モードにする／戻す。 */
  onNoteEdit(editing: boolean): void;
}

/** パネルが覚えている開閉。**ノードごとではなくパネルごと**——選び直すたびに
 *  畳み直すと、続けて同じ操作をするときに毎回開くことになる。 */
export interface InspectorView {
  moreOpen: boolean;
  noteEditing: boolean;
}

export function renderInspector(
  container: HTMLElement,
  graph: Graph,
  selectedId: string | undefined,
  rev: ReverseIndex,
  cyclic: ReadonlySet<string>,
  cb: InspectorCallbacks,
  view: InspectorView = { moreOpen: false, noteEditing: false },
): void {
  container.replaceChildren();

  if (!selectedId || !graph.nodes[selectedId]) {
    container.append(h("div", { class: "insp-empty" }, [m.inspector.empty]));
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
  const renameBtn = h("button", { class: "icon-btn", type: "button", title: m.inspector.rename });
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
    row.append(h("span", { class: "insp-number", title: m.inspector.numberTitle }, [`#${node.number}`]));
  }
  row.append(stateBadge(state));
  // 期限は上から伝わったものも出す（`effectiveDues`）。どこから来たかは文字で言う
  // ——詳細パネルは読むための場所なので、ツールチップに隠さない。
  // 「◯◯の期限から」は起点（その日から数える）にも読めたので、伝わる理由を言う
  // 「◯◯に間に合わせる」にした（2026-09-28、のっち）。
  const due = effectiveDues(graph).get(selectedId);
  let dueFrom: HTMLElement | undefined;
  if (due && due.from !== selectedId) {
    const from = graph.nodes[due.from]?.name ?? due.from;
    const own = node.due && node.due !== due.date ? m.inspector.ownDue(node.due) : "";
    row.append(h("span", { class: "hit-indegree due-inherited" }, [m.inspector.dueBadge(due.date)]));
    dueFrom = h("div", { class: "insp-due-from" }, [m.inspector.dueFrom(from, own)]);
  } else if (due || node.due) {
    row.append(h("span", { class: "hit-indegree" }, [m.inspector.dueBadge((due?.date ?? node.due)!)]));
  }
  container.append(row);
  if (dueFrom) container.append(dueFrom);

  // 進捗（自分を含む子孫の達成率）
  const p = progress(graph, selectedId);
  if (p.total > 1 && isEndlessRoot(graph, selectedId, rev)) {
    // 終わらない根は割合（分数・バー）を出さない。件数は2つとも残す——
    // 全体の数は「どこまで」ではなく「どれだけ広がったか」を言う（`isEndlessRoot`）。
    const prow = h("div", { class: "insp-row" });
    prow.append(
      h("span", { class: "progress-label", title: m.inspector.endlessTitle }, [
        m.inspector.endlessProgress(p.done, p.total),
      ]),
    );
    container.append(prow);
  } else if (p.total > 1) {
    const prow = h("div", { class: "insp-row" });
    const bar = h("div", { class: "progress-bar" });
    bar.append(h("div", { class: "progress-fill", style: `width:${Math.round((p.done / p.total) * 100)}%` }));
    prow.append(bar, h("span", { class: "progress-label" }, [`${p.done}/${p.total}`]));
    container.append(prow);
  }

  // 主要な操作
  const actions = h("div", { class: "insp-row" });
  const toggle = h("button", { class: `btn${state === "SATISFIED" ? "" : " primary"}`, type: "button", "data-tour": "toggle" });
  toggle.append(iconSpan("circleCheck", 14), state === "SATISFIED" ? m.inspector.unmarkDone : m.inspector.markDone);
  toggle.addEventListener("click", () => cb.onToggle(selectedId));
  actions.append(toggle);

  const bulk = h("button", { class: "btn", type: "button", "data-tour": "decompose" });
  bulk.append(iconSpan("plus", 14), m.inspector.breakDown);
  bulk.addEventListener("click", () => cb.onBulkAdd(selectedId));
  actions.append(bulk);
  container.append(actions);

  if (state === "CYCLIC") {
    const warn = h("div", { class: "cycle-notice" });
    const t = h("h3");
    t.append(iconSpan("repeat", 14), m.inspector.cycleTitle);
    warn.append(t);
    warn.append(
      h("p", {}, [m.inspector.cycleHint]),
    );
    container.append(warn);
  }

  // 「その他」。**たまにしか押さないが、押す前に読ませたい説明があるもの**を
  // ここへ畳む（2026-09-12、のっち「右のパネルも整理できるね」）。畳めるように
  // なったのは、日々のゴール切り替えが右クリックでも届くようになったため。
  // 中身は「期限」「ゴール（地図に出す・外す）」「削除」の3つ。
  const more = h("div", { class: "insp-more" });
  const moreBody = h("div", { class: "insp-more-body" });
  const moreBtn = h("button", {
    class: `insp-more-btn${view.moreOpen ? " open" : ""}`,
    type: "button",
    "data-tour": "more",
    "aria-expanded": view.moreOpen ? "true" : "false",
  });
  moreBtn.append(iconSpan("chevronRight", 12), m.inspector.more);
  moreBtn.addEventListener("click", () => cb.onMore(!view.moreOpen));
  // 畳んでいるときは**中身を作らない**（`display:none` で隠さない）。隠すだけだと
  // 「画面に無いのに探すと見つかる」ものになり、テストからも人からも同じに見えない。
  more.append(moreBtn);
  if (view.moreOpen) more.append(moreBody);

  // 期限（2026-09-28）。それまでは表示と伝播だけで、**人が期限を付ける口が
  // 無かった**（書き込みの入口は「人はアプリから」なのに）。マニュアルの6章を
  // 書いていて気づいた。
  //
  // 「その他」に置くのは、付けるのが稀で、付ける前に読ませたい方針があるから
  // ——期限は外の都合で日付が決まっているものだけ（自分で決めた目安は付けない）。
  // 上の行の期限の表示は読むためのもので、押しても何も起きない。入口を1つにする。
  //
  // 付けられるのは**自分の期限だけ**。伝わってきた期限（破線）は上のノードの
  // ものなので、ここで書くと下に書き写すことになる（AGENTS.md が禁じている形）。
  {
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan("calendar", 12), m.inspector.due);
    sec.append(head);

    const row = h("div", { class: "insp-due-row" });
    const input = h("input", { class: "insp-due-input", type: "date", "aria-label": m.inspector.due }) as HTMLInputElement;
    input.value = node.due && DUE_FORMAT.test(node.due) ? node.due : "";
    // 日付が1つ決まるたびに `change` が来る（年月日が揃うまでは来ない）。空に
    // されたら外す。形が崩れた値はここでは書かない——伝播は `YYYY-MM-DD` しか
    // 扱わないので、書いても効かない期限になる。
    input.addEventListener("change", () => {
      const v = input.value;
      if (v === "") cb.onDue(selectedId, undefined);
      else if (DUE_FORMAT.test(v)) cb.onDue(selectedId, v);
    });
    row.append(input);
    if (node.due !== undefined) {
      const clear = h("button", { class: "btn", type: "button" }, [m.inspector.clearDue]);
      clear.addEventListener("click", () => cb.onDue(selectedId, undefined));
      row.append(clear);
    }
    sec.append(row);

    // 伝わっている期限があれば、自分で付ける意味があるのは「それより早い日付が
    // 外で決まっている」ときだけ。遅い日付を付けても効かない（早い方が効く）。
    const inherited = due && due.from !== selectedId ? due : undefined;
    const note = inherited
      ? m.inspector.dueNoteInherited(graph.nodes[inherited.from]?.name ?? inherited.from, inherited.date)
      : node.due !== undefined
        ? m.inspector.dueNoteOwn
        : m.inspector.dueNoteNone;
    sec.append(h("p", { class: "insp-note" }, [note]));
    moreBody.append(sec);
  }

  // ゴール宣言。**中腹を地図へ浮上させる1ビット**（2026-09-11）。
  //
  // 実データで目的が1つに畳まれ、64ノードが根から11段下までぶら下がった。
  // 「それ全部を1つの目的に入れると、深いところが遠くなってカオスマップになる」
  // （のっち）。かといって切り離すと、何のためにあったのかが消える。**位置は
  // そのままで、入口としても扱う**ためにここで指す。
  {
    // 入次数0のノードも**外せる**（2026-09-11）。以前はここを出していなかった
    // ——外しても次の読み込みでゴールに戻るので効かないボタンになる、という理由
    // だった。`goal: false` を降格として保存するようにしたので、その前提が消えた。
    // 終わらない根（`哲学を体現する`）が地図の段を1つ食っていたのを外すための口。
    const auto = isAutoGoal(graph, selectedId, rev);
    const on = isGoal(graph, selectedId, rev);
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan("compass", 12), m.inspector.goal);
    sec.append(head);

    const btn = h("button", { class: `btn${on ? " primary" : ""}`, type: "button", "aria-pressed": on ? "true" : "false" });
    btn.append(iconSpan("compass", 14), on ? m.inspector.hideFromMap : m.inspector.showOnMap);
    btn.addEventListener("click", () => cb.onGoal(selectedId, !on));
    sec.append(btn);

    // 説明は3通り。**外したときに何が起きるかを、押す前に読める位置に置く**
    // ——根を外すと、その下に `goal: true` が1つも無い場合、一帯が地図から消える。
    const note = on
      ? auto
        ? inDegree(selectedId, rev) > 0
          ? // 輪の代表（`isAutoGoal`）。「どこからも要求されていない」と書くと、
            // 画面に見えている輪の線と食い違う。
            m.inspector.goalNoteRing
          : m.inspector.goalNoteAuto
        : m.inspector.goalNoteOn
      : auto
        ? m.inspector.goalNoteOffAuto
        : m.inspector.goalNoteOff;
    sec.append(h("p", { class: "insp-note" }, [note]));
    moreBody.append(sec);
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
    head.append(iconSpan("stickyNote", 12), m.inspector.colorTag);
    sec.append(head);

    const row = h("div", { class: "swatch-row" });
    const current = isGoalColor(node.color) ? node.color : undefined;
    const swatch = (color: GoalColor | undefined): HTMLButtonElement => {
      const on = current === color;
      const b = h("button", {
        class: `swatch${color === undefined ? " swatch-none" : ` swatch-${color}`}${on ? " on" : ""}`,
        type: "button",
        title: color === undefined ? m.inspector.noColor : COLOR_LABEL[color],
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
    edge: "requires" | "contains",
  ): void => {
    if (ids.length === 0) return;
    const sec = h("div", { class: "insp-section" });
    const head = h("h4");
    head.append(iconSpan(iconName, 12), m.inspector.linkHead(title, ids.length));
    sec.append(head);
    const list = h("div", { class: "insp-list" });
    for (const id of ids) {
      const child = graph.nodes[id];
      const row = h("div", { class: "insp-link-row" });
      const btn = h("button", { class: "insp-link", type: "button" });
      btn.append(child ? stateDot(resolveState(graph, id, cyclic)) : stateDot("BLOCKED"));
      btn.append(h("span", {}, [child?.name ?? m.inspector.missing(id)]));
      btn.addEventListener("click", () => cb.onFocus(id));

      // この繋がりだけを切る口は**右クリック**へ移した（2026-09-12）。ホバーで
      // 出る `×` は、押すと何が消えるのかがツールチップを読むまで分からず、
      // 行の右端を常に1つ占めていた。グラフの線と同じメニューが出るので、
      // 「外す」の覚え方が1つになる。
      row.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        cb.onMenu({ kind: "edge", parentId: id, childId: selectedId, edge }, ev.clientX, ev.clientY);
      });

      row.append(btn);
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
  linkList(m.inspector.waitingOnThis, "listChecks", rev.requiredBy.get(selectedId) ?? [], "requires");
  linkList(m.inspector.partOf, "chevronRight", rev.containedBy.get(selectedId) ?? [], "contains");

  // メモ（Markdown 本文そのもの。Obsidian で開いても同じものが見える）。
  //
  // **既定は閲覧**（2026-09-12、のっち依頼）。読む時間の方が長い道具で、将来は
  // ここに他の人のコメントが積まれていく。入力欄を出しっぱなしにすると、
  // パネルで一番大きい塊が常に「書く顔」になる。
  const noteSec = h("div", { class: "insp-section" });
  const noteHead = h("h4");
  noteHead.append(iconSpan("pencil", 12), m.inspector.note);
  const modeBtn = h("button", { class: "insp-mode-btn", type: "button" }, [view.noteEditing ? m.inspector.viewMode : m.inspector.editMode]);
  noteHead.append(modeBtn);
  noteSec.append(noteHead);
  if (view.noteEditing) {
    const area = h("textarea", { class: "note-area", placeholder: m.inspector.notePlaceholder }) as HTMLTextAreaElement;
    area.value = node.note;
    const commit = (): void => {
      if (area.value !== node.note) cb.onNoteChange(selectedId, area.value);
    };
    area.addEventListener("blur", commit);
    // 閲覧へ戻すときも書き戻す。**押す順で保存が変わらないようにする**——
    // ボタンを押すと blur も走るが、経路によって先後が入れ替わるので、
    // どちらからも同じ関数を通す（変化が無ければ何もしない）。
    modeBtn.addEventListener("click", () => {
      commit();
      cb.onNoteEdit(false);
    });
    noteSec.append(area);
  } else {
    modeBtn.addEventListener("click", () => cb.onNoteEdit(true));
    // メモの右クリック（2026-09-12、のっち依頼）。**奪うのは閲覧のときだけ。**
    // 入力欄の上では貼り付けが要るし、**文字を選んでいるときも既定に任せる**
    // ——選んだところをコピーするのが右クリックの一番よくある用途で、そこを
    // 潰すと「読む画面」から文字が持ち出せなくなる。
    noteSec.addEventListener("contextmenu", (ev) => {
      if ((window.getSelection()?.toString() ?? "") !== "") return;
      ev.preventDefault();
      cb.onMenu({ kind: "note", id: selectedId }, ev.clientX, ev.clientY);
    });
    if (node.note.trim() === "") {
      noteSec.append(h("p", { class: "insp-note" }, [m.inspector.noNote]));
    } else {
      const body = h("div", { class: "note-view" });
      renderNote(body, node.note);
      noteSec.append(body);
    }
  }
  container.append(noteSec);

  // 作成日と更新日（2026-09-14、のっち依頼）。**どちらもファイルに書かない。**
  //  - 作成: id（ULID）に埋まった時刻。振り直した id は持っていないので出さない
  //  - 更新: ファイルの mtime。構造の付け足しやカスケード、AI の書き込みでも進む
  //    ——「最後にこのファイルが書き換わった日」であって、本人が触った日ではない
  // 読む頻度は低いので、メモの下に小さく置く。日付だけ出し、時刻はツールチップ。
  {
    const created = nodeCreatedAt(selectedId);
    const updated = node.mtimeMs > 0 ? node.mtimeMs : undefined;
    if (created !== undefined || updated !== undefined) {
      const dates = h("div", { class: "insp-dates" });
      if (created !== undefined) {
        dates.append(h("span", { title: m.inspector.created(formatDateTime(created)) }, [m.inspector.created(formatDate(created))]));
      }
      if (updated !== undefined) {
        dates.append(h("span", { title: m.inspector.updated(formatDateTime(updated)) }, [m.inspector.updated(formatDate(updated))]));
      }
      container.append(dates);
    }
  }

  // 削除は押した瞬間に消え、参照の掃除まで走る。取り消しも無いので、その場で
  // 一度受け止める（2026-09-02 の棚卸し。押した瞬間に消えることを実機で確認した）。
  //
  // 消える件数だけでなく**「目的」が何件生えるか**も先に言う。ルート判定が
  // 入次数0なので、中間ノードを消すとその子が目的としてサイドバーに現れる——
  // 構造としては正しいが、削除の副作用としては予想できない。
  const delBox = h("div", { class: "insp-delete" });
  const del = h("button", { class: "btn danger", type: "button", "data-tour": "delete" });
  del.append(iconSpan("trash2", 14), m.inspector.deleteNode);
  del.addEventListener("click", () => {
    const orphans = (node.requires.concat(node.contains)).filter(
      (childId) => graph.nodes[childId] && inDegree(childId, rev) === 1,
    );
    delBox.replaceChildren();
    // 戻せるのは直後の1手だけ（次に何か操作すると控えが入れ替わる）。「戻せます」
    // とだけ書くと、いつでも戻せるように読める。
    const warn = h("div", { class: "insp-confirm-text" }, [
      m.inspector.deleteConfirm(node.name),
    ]);
    delBox.append(warn);
    if (orphans.length > 0) {
      delBox.append(
        h("div", { class: "insp-confirm-note" }, [
          m.inspector.deleteOrphans(orphans.length, orphans.map((id) => graph.nodes[id]!.name).join(m.inspector.nameSep)),
        ]),
      );
    }
    const row = h("div", { class: "insp-row", style: "margin:8px 0 0" });
    const yes = h("button", { class: "btn danger", type: "button", "data-tour": "delete-confirm" }, [m.inspector.deleteYes]);
    yes.addEventListener("click", () => cb.onDelete(selectedId));
    const no = h("button", { class: "btn", type: "button" }, [m.inspector.deleteNo]);
    no.addEventListener("click", () => {
      delBox.replaceChildren(del);
    });
    row.append(yes, no);
    delBox.append(row);
  });
  delBox.append(del);
  moreBody.append(delBox);

  // 「その他」はパネルの一番下。畳んであるので、開かない限り1行しか取らない。
  container.append(more);
}
