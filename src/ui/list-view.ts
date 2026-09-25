// 検索結果 ＝ 横断 Next Action ビュー。同じ1画面。
//
//   テキストクエリ        → 全文検索
//   空クエリ + ACTIONABLE → 「今やれること」（起動直後の画面）
//
// タグを持たない代わりに、行に**パンくず**を出す。どの目的の下にいるかが
// 見えれば、それがタグの代わりになる。複数並べば合流点＝片付けると2つ進む。
//
// 表示量の原則（2026-08-31、のっちの実機確認で全面的に絞った）:
//
//   1. 同じ情報を2つの入れ物で出さない。上方向の隣接（これを待っている／
//      属する先）はパンくずと同じものを指すので、並べると行が二段になる。
//   2. 全行で同じ値になるものは出さない。「今やれること」は定義上すべて
//      ACTIONABLE なので、状態バッジを6行並べても情報量はゼロ。
//   3. 説明文は初回しか読まれない。畳んで、必要な人だけ開く。

import { isGoalColor, type GoalColor, type Graph } from "../core/model.ts";
import type { RecentSort, RecentSortKey, SearchResult } from "../core/search.ts";
import { formatDate, formatDateTime, h, iconSpan, stateBadge } from "./dom.ts";

export interface ListCallbacks {
  onSelect(id: string): void;
  onDecompose(cycleNodes: string[]): void;
  /** 「最近の変更」の列の見出しを押した。向きの決め方は呼び出し側が持つ。 */
  onSort?(key: RecentSortKey): void;
}

/** 「最近の変更」の列。見出しと行を同じ5列の grid に載せる（`.recent`）。
 *  名前は並べ替えない——名前順に並んでも再開の手がかりにならない。 */
const RECENT_COLUMNS: { label: string; key?: RecentSortKey }[] = [
  { label: "番号", key: "number" },
  { label: "名前" },
  { label: "目的", key: "goal" },
  { label: "状態", key: "state" },
  { label: "更新日", key: "mtime" },
];

function recentHeader(sort: RecentSort, cb: ListCallbacks): HTMLElement {
  const row = h("div", { class: "list-cols recent" });
  for (const col of RECENT_COLUMNS) {
    if (!col.key) {
      row.append(h("span", { class: "list-col" }, [col.label]));
      continue;
    }
    const key = col.key;
    const active = sort.key === key;
    const btn = h("button", {
      class: active ? "list-col sortable active" : "list-col sortable",
      type: "button",
      "data-sort": key,
      "aria-pressed": String(active),
      title: `${col.label}で並べ替え`,
    });
    btn.append(h("span", {}, [col.label]));
    // 向きの印は並べている列にだけ出す。全列に薄く出すと、どれで並んでいるかが
    // 印の濃さの差でしか読めなくなる。
    if (active) btn.append(iconSpan(sort.dir === "asc" ? "chevronUp" : "chevronDown", 12));
    btn.addEventListener("click", () => cb.onSort?.(key));
    row.append(btn);
  }
  return row;
}

export function renderList(
  container: HTMLElement,
  graph: Graph,
  result: SearchResult,
  opts: { title: string; query: string; scoped?: boolean; recent?: boolean; recentSort?: RecentSort },
  cb: ListCallbacks,
): void {
  container.replaceChildren();
  const isSearch = opts.query !== "";
  const recent = opts.recent === true && !isSearch;

  // 見出しはパンくずが出している。ここで繰り返さない。件数だけは検索時に要る
  // （サイドバーのカウントは「今やれること」の数しか持っていない）。
  //
  // 俯瞰の進捗はここに出さない。目的なら**サイドバーの行**が、目的以外なら
  // **インスペクタのバー**が同じ数を既に出しており、3つ並べた画面を実際に
  // 作ってしまった（2026-09-02 の棚卸しで実測。`4/11` が同時に3箇所）。
  if (isSearch) {
    container.append(h("div", { class: "list-head" }, [h("span", { class: "list-count" }, [`${result.total} 件`])]));
  }

  // 詰まっている輪は結果より先に出す。「今やれることが空」の理由が
  // 見えないまま終わるのが、このツールで一番まずい失敗の仕方。
  for (const cycle of result.cycles) {
    container.append(cycleNotice(graph, cycle, cb));
  }

  if (result.hits.length === 0) {
    const msg = isSearch
      ? "一致するノードがありません。"
      : recent
        ? "まだ書き換わったノードがありません。"
        : result.cycles.length > 0
        ? "今やれることがありません。上の待ち合いをほどくと動き出します。"
        : "今やれることがありません。";
    container.append(h("div", { class: "empty" }, [msg]));
    return;
  }

  // 状態は「混ざっているときだけ」出す。揃っているなら見出しが既に言っている。
  const mixedState = new Set(result.hits.map((x) => x.state)).size > 1;

  // 「最近の変更」は並べ替えられる表として出す（2026-09-14、のっち依頼）。見出しが
  // 無いと、行の右に並ぶ値がそれぞれ何かを読み手が推し量ることになる。
  // 「今やれること」には付けない——並びは構造から出る優先度で、手で崩させない。
  if (recent && opts.recentSort) container.append(recentHeader(opts.recentSort, cb));

  for (const hit of result.hits) {
    const node = graph.nodes[hit.id];
    if (!node) continue;

    const card = h("div", { class: recent ? "hit recent" : "hit" });

    // 付箋は行の左の縁に。**俯瞰では出さない**——全行が同じ目的の下にいるので
    // 全行で同じ色になる（規則2）。パンくずを消しているのと同じ理由。
    //
    // 並べる順はパンくずと揃える（名前順）。行の中で色と文字が別の順で並ぶと、
    // 3つ目の色がどの目的のものか読めない。
    if (!opts.scoped) {
      const tags = hit.breadcrumb
        .map((rootId) => graph.nodes[rootId])
        .filter((n) => n !== undefined)
        .sort((x, y) => x.name.localeCompare(y.name, "ja"))
        .map((n) => n.color)
        .filter(isGoalColor);
      if (tags.length > 0) card.append(tagStripe(tags));
    }

    const main = h("button", { class: "hit-main", type: "button" });
    // 番号は名前の前。行頭で揃うと「一覧の中の場所」ではなく「その札」として
    // 読める（右端に置くと、パンくずや期限と並んで属性の1つに見える）。
    // 表の形（最近の変更）では番号が無くても枠を置く。grid の列がずれる。
    if (hit.number !== undefined) main.append(h("span", { class: "hit-number" }, [`#${hit.number}`]));
    else if (recent) main.append(h("span", { class: "hit-number" }));
    const name = h("span", { class: "hit-name" }, [node.name]);

    // パンくずは名前と同じ行の右側へ。二段組をやめると行数が半分以下になる。
    // 空でも要素は置く——右寄せの基準をこの1つに集約しておかないと、
    // meta 側の auto マージンと余白を分け合って中途半端な位置で止まる。
    //
    // `breadcrumb` は id の配列（コアは表示を決めない）。ここで名前に直す——
    // id/name を分けたあと、ここだけ id をそのまま出して行の右端に ULID が
    // 並んでいた（2026-09-01）。並び順も id ではなく名前で決める。
    // 俯瞰では全行が同じ目的の下なので出さない（規則2）。パンくずは
    // 「どの目的に属するか」を言うためのもので、絞った時点で言い終わっている。
    const crumbText = opts.scoped
      ? ""
      : hit.breadcrumb
          .map((rootId) => graph.nodes[rootId]?.name ?? rootId)
          .sort((a, b) => a.localeCompare(b, "ja"))
          .join(" / ");
    const crumb = h("span", { class: "hit-crumb" }, [crumbText]);
    if (crumbText) crumb.title = `${crumbText} の下`;

    const meta = h("div", { class: "hit-meta" });
    if (hit.inDegree > 1) {
      meta.append(h("span", { class: "hit-indegree", title: `${hit.inDegree} 箇所から要求されている（片付けると複数が進む）` }, [`合流 ${hit.inDegree}`]));
    }
    // 上から伝わった期限は枠を破線にして、どこから来たかをツールチップで言う。
    // 同じ見た目にすると、自分で書いていない日付を書いたように読める。
    if (hit.due) {
      const from = hit.dueFrom ? graph.nodes[hit.dueFrom]?.name ?? hit.dueFrom : undefined;
      meta.append(
        h(
          "span",
          { class: from ? "hit-indegree due-inherited" : "hit-indegree", title: from ? `「${from}」の期限から` : "期限" },
          [hit.due],
        ),
      );
    }

    if (recent) {
      // 表の形。合流・期限は列を持たない（見出しで並べ替える軸ではない）ので、
      // 名前の後ろに寄せて名前の列の中に収める。状態は列なので揃っていても出す
      // ——空欄の列は「無い」ではなく「読み込めていない」に見える。
      const nameCell = h("span", { class: "hit-namecell" }, [name]);
      if (meta.childElementCount > 0) nameCell.append(meta);
      main.append(nameCell, crumb, h("span", { class: "hit-state" }, [stateBadge(hit.state)]));
      // 日付だけ出して時刻はツールチップ（詳細パネルと同じ出し方）。
      const date = h("span", { class: "hit-date" }, node.mtimeMs > 0 ? [formatDate(node.mtimeMs)] : []);
      if (node.mtimeMs > 0) date.title = `更新 ${formatDateTime(node.mtimeMs)}`;
      main.append(date);
    } else {
      main.append(name, crumb);
      if (mixedState) meta.append(stateBadge(hit.state));
      main.append(meta);
    }
    main.addEventListener("click", () => cb.onSelect(hit.id));
    card.append(main);

    // 隣接（1ホップ）は検索のための機能。「CI/CD」で検索したときに「手順書」も
    // 浮かぶことで、単語を思い出せなくても到達できる、というのが元の狙いだった。
    // 「今やれること」では思い出す対象が無いので出さない。
    if (isSearch && hit.neighbors) {
      const groups: [string, string[], Parameters<typeof iconSpan>[0]][] = [
        ["これが必要", hit.neighbors.requires, "cornerDownRight"],
        ["これを待っている", hit.neighbors.requiredBy, "listChecks"],
        ["構成要素", hit.neighbors.contains, "layers"],
        ["属する先", hit.neighbors.containedBy, "chevronRight"],
      ];
      const shown = groups.filter(([, ids]) => ids.length > 0);
      if (shown.length > 0) {
        const box = h("div", { class: "neighbors" });
        for (const [label, ids, iconName] of shown) {
          const grp = h("div", { class: "neighbor-group" });
          // ラベルはアイコンだけにして、語はツールチップへ逃がす。4方向 × 文字だと
          // チップより見出しの方が長くなる。
          const lab = h("span", { class: "neighbor-label", title: label });
          lab.append(iconSpan(iconName, 11));
          grp.append(lab);
          for (const id of ids.slice(0, 6)) {
            const chip = h("button", { class: "chip", type: "button" }, [graph.nodes[id]?.name ?? id]);
            chip.addEventListener("click", () => cb.onSelect(id));
            grp.append(chip);
          }
          if (ids.length > 6) grp.append(h("span", { class: "neighbor-label" }, [`+${ids.length - 6}`]));
          box.append(grp);
        }
        card.append(box);
      }
    }
    container.append(card);
  }
}

/** 「切れ」ではなく「割れ」を出す。切れだと人の手が止まるが、割れなら
 * 次の操作が決まる——しかも割る操作は既存の一括追加がそのまま使える。
 *
 * 理由の説明は畳んでおく。毎回同じ文が画面の1/4を占めていた。 */
function cycleNotice(graph: Graph, cycle: string[], cb: ListCallbacks): HTMLElement {
  const box = h("div", { class: "cycle-notice" });

  const head = h("div", { class: "cycle-head" });
  const title = h("h3");
  title.append(iconSpan("repeat", 14), "この待ち合いの中に、2つに分かれるノードがあるかもしれません");
  head.append(title);

  const ring = h("div", { class: "cycle-ring" });
  cycle.forEach((id, i) => {
    const chip = h("button", { class: "chip", type: "button" }, [graph.nodes[id]?.name ?? id]);
    chip.addEventListener("click", () => cb.onSelect(id));
    ring.append(chip);
    if (i < cycle.length - 1) ring.append(iconSpan("chevronRight", 12));
  });
  ring.append(iconSpan("repeat", 12));

  const act = h("button", { class: "btn", type: "button" });
  act.append(iconSpan("plus", 13), "割る");
  act.addEventListener("click", () => cb.onDecompose(cycle));

  const row = h("div", { class: "cycle-row" });
  row.append(ring, act);

  const why = h("details", { class: "cycle-why" });
  why.append(h("summary", {}, ["なぜ待ち合って一周するのか"]));
  why.append(
    h("p", {}, [
      "待ち合って一周するのは、1つの名前に2つの違うものが混ざっているサインです。どれかを割ると要求の向きが揃ってほどけます。",
    ]),
  );

  box.append(head, row, why);
  return box;
}

/** 付箋の帯。複数の目的に属するノードは、その数だけ色を縦に割る。
 *
 * 合流点は「片付けると2つ進む」場所なので、どちらか一方の色にしてしまうと
 * 一覧の上位に来ている理由（入次数）と見た目が食い違う。 */
function tagStripe(colors: GoalColor[]): HTMLElement {
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `var(--tag-${c}) ${i * step}% ${(i + 1) * step}%`).join(", ");
  return h("div", { class: "hit-tag", style: `background: linear-gradient(to bottom, ${stops})` });
}
