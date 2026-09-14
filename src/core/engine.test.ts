import { describe, expect, test } from "bun:test";
import { parseDsl, parseBulkLinks, parseBulkRequires } from "./dsl.ts";
import {
  analyzeCycles,
  applyTogglePlan,
  applyUndo,
  blockedByCycle,
  buildReverseIndex,
  canUndo,
  captureUndo,
  cyclicNodes,
  descendantOutline,
  descendantProgress,
  findCycles,
  findShortcuts,
  inDegree,
  neighbors,
  planToggle,
  progress,
  resolveState,
  roots,
  shortcutVia,
  toggleSatisfied,
} from "./engine.ts";
import { newGraph, type Graph } from "./model.ts";
import { countActionable, nextActions, pathFromRoot, search, stuckReport } from "./search.ts";

/** DSL からテスト用グラフを組む。mtime は 0。 */
function g(dsl: string): Graph {
  const parsed = parseDsl(dsl);
  expect(parsed.errors).toEqual([]);
  const graph = newGraph();
  for (const n of parsed.nodes) graph.nodes[n.id] = n;
  return graph;
}

describe("resolveState", () => {
  test("前提なしは ACTIONABLE、前提未達は BLOCKED", () => {
    const graph = g("確定申告 -> 領収書整理");
    expect(resolveState(graph, "領収書整理")).toBe("ACTIONABLE");
    expect(resolveState(graph, "確定申告")).toBe("BLOCKED");
  });

  test("satisfied は最優先で SATISFIED", () => {
    const graph = g("確定申告 -> 領収書整理");
    graph.nodes["確定申告"]!.satisfied = true;
    expect(resolveState(graph, "確定申告")).toBe("SATISFIED");
  });

  test("前提が全部満たされれば ACTIONABLE になる", () => {
    const graph = g("リリース -> 手順書, リリース -> CI/CD");
    graph.nodes["手順書"]!.satisfied = true;
    expect(resolveState(graph, "リリース")).toBe("BLOCKED");
    graph.nodes["CI/CD"]!.satisfied = true;
    expect(resolveState(graph, "リリース")).toBe("ACTIONABLE");
  });

  test("リンク切れは落とさず BLOCKED", () => {
    const graph = g("確定申告 -> 領収書整理");
    graph.nodes["確定申告"]!.requires.push("存在しないノード");
    expect(() => resolveState(graph, "確定申告")).not.toThrow();
    expect(resolveState(graph, "確定申告")).toBe("BLOCKED");
  });
});

describe("循環", () => {
  // Warframe 版は循環を BLOCKED に潰していたため「前提待ち」と区別できず、
  // 横断ビューで枝が理由も出さずに消えていた。ここが Sirube での変更点。
  test("循環上のノードは CYCLIC として区別される", () => {
    const graph = g("実績を作る -> 案件を取る -> 実績を作る");
    expect(resolveState(graph, "実績を作る")).toBe("CYCLIC");
    expect(resolveState(graph, "案件を取る")).toBe("CYCLIC");
  });

  test("findCycles が輪の構成ノードを返す", () => {
    const graph = g("実績を作る -> 案件を取る -> 実績を作る, 確定申告 -> 領収書整理");
    const cycles = findCycles(graph);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]!.sort()).toEqual(["実績を作る", "案件を取る"].sort());
    expect(cyclicNodes(graph).has("領収書整理")).toBe(false);
  });

  test("MOC のシミュレーション: 輪があると ACTIONABLE がほぼ消える", () => {
    const graph = g(`実績を作る -> 案件を取る -> 実績を作る,
                     ポートフォリオを公開する -> 実績を作る,
                     確定申告 -> 領収書整理`);
    const rev = buildReverseIndex(graph);
    const actionable = nextActions(graph, rev).hits.map((h) => h.id);
    // キャリアの枝が丸ごと消え、無関係な「領収書整理」しか残らない。
    expect(actionable).toEqual(["領収書整理"]);

    // が、理由は取れる。ここが「半年ぶりに開いて空でも絶望しない」の担保。
    const stuck = stuckReport(graph);
    expect(stuck.cycles).toHaveLength(1);
    expect(stuck.blockedByCycles).toContain("ポートフォリオを公開する");
  });

  test("MOC のシミュレーション: 分解すると輪が消えて行動が1つ生まれる", () => {
    // 「案件を取る」の中に「実績が要る案件」と「実績が要らない案件」が
    // 同居していたのが輪の正体。割ると要求の向きが揃う。
    const graph = g(`大きい案件を取る -> 実績を作る -> 小さい案件を1件やる -> 知人に声をかける,
                     ポートフォリオを公開する -> 実績を作る,
                     確定申告 -> 領収書整理`);
    expect(findCycles(graph)).toHaveLength(0);
    const rev = buildReverseIndex(graph);
    const actionable = nextActions(graph, rev).hits.map((h) => h.id).sort();
    expect(actionable).toEqual(["知人に声をかける", "領収書整理"]);
    // 分解は情報を壊していない: 実績ができるまで大きい案件は取れないまま。
    expect(resolveState(graph, "大きい案件を取る")).toBe("BLOCKED");
  });
});

describe("contains も「何が必要か」として数える", () => {
  test("contains だけ持つ中間ノードは、子が未完了なら BLOCKED", () => {
    // requires しか見ていなかった頃は「前提ゼロ＝今やれる」と誤判定していた。
    const graph = g("MVP実装完了 -> [Markdownノードストア] -> [検索と横断ビュー]");
    expect(graph.nodes["MVP実装完了"]!.requires).toEqual([]);
    expect(graph.nodes["MVP実装完了"]!.contains.length).toBe(2);
    expect(resolveState(graph, "MVP実装完了")).toBe("BLOCKED");
  });

  test("子が全部揃えば ACTIONABLE（カスケードが閉じる直前の状態）", () => {
    const graph = g("MVP実装完了 -> [Markdownノードストア] -> [検索と横断ビュー]");
    graph.nodes["Markdownノードストア"]!.satisfied = true;
    expect(resolveState(graph, "MVP実装完了")).toBe("BLOCKED"); // まだ片方
    graph.nodes["検索と横断ビュー"]!.satisfied = true;
    expect(resolveState(graph, "MVP実装完了")).toBe("ACTIONABLE");
  });

  test("requires と contains の両方を持つノードは両方揃うまで BLOCKED", () => {
    const graph = g("MVP実装完了 -> vault選択の作り直し, MVP実装完了 -> [Tauriシェル]");
    graph.nodes["vault選択の作り直し"]!.satisfied = true;
    expect(resolveState(graph, "MVP実装完了")).toBe("BLOCKED"); // contains が残っている
    graph.nodes["Tauriシェル"]!.satisfied = true;
    expect(resolveState(graph, "MVP実装完了")).toBe("ACTIONABLE");
  });

  test("横断 Next Action ビューに中間ノードが紛れ込まない", () => {
    // 一般版の本体機能。ここに親が出ると「今やれること」が嘘になる。
    const graph = g("MVP実装完了 -> [Markdownノードストア] -> [検索と横断ビュー], 確定申告 -> 領収書整理");
    const rev = buildReverseIndex(graph);
    const ids = nextActions(graph, rev).hits.map((h) => h.id).sort();
    expect(ids).toEqual(["Markdownノードストア", "検索と横断ビュー", "領収書整理"].sort());
    expect(ids).not.toContain("MVP実装完了");
  });

  test("contains 越しの輪も「詰まっている理由」として拾える", () => {
    // 理由が出せないと、半年ぶりに開いて空だったときに絶望する。
    const graph = g("MVP実装完了 -> [案件を取る], 実績を作る -> 案件を取る -> 実績を作る");
    const info = analyzeCycles(graph);
    expect(blockedByCycle(graph, "MVP実装完了", info.cyclic)).toBe(true);
    expect(stuckReport(graph).blockedByCycles).toContain("MVP実装完了");
  });
});

describe("カスケード", () => {
  test("達成すると requires 連鎖を遡って前提も達成になる", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    const rev = buildReverseIndex(graph);
    const changed = toggleSatisfied(graph, "引っ越し先の家", rev);
    expect(graph.nodes["不動産に行く"]!.satisfied).toBe(true);
    expect(graph.nodes["引っ越し"]!.satisfied).toBe(false); // 前提側だけ
    expect(changed.sort()).toEqual(["不動産に行く", "引っ越し先の家"].sort());
  });

  test("取り消すと下流が戻る。前提側は触らない", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    const rev = buildReverseIndex(graph);
    for (const id of Object.keys(graph.nodes)) graph.nodes[id]!.satisfied = true;
    toggleSatisfied(graph, "引っ越し先の家", rev);
    expect(graph.nodes["引っ越し先の家"]!.satisfied).toBe(false);
    expect(graph.nodes["引っ越し"]!.satisfied).toBe(false); // 下流は戻る
    expect(graph.nodes["不動産に行く"]!.satisfied).toBe(true); // 前提は残る
  });

  test("contains は子が全部揃うと親が自動達成、戻しても親は戻らない", () => {
    const graph = g("MVP -> [ストア] -> [検索]");
    const rev = buildReverseIndex(graph);
    toggleSatisfied(graph, "ストア", rev);
    expect(graph.nodes["MVP"]!.satisfied).toBe(false);
    toggleSatisfied(graph, "検索", rev);
    expect(graph.nodes["MVP"]!.satisfied).toBe(true);
    toggleSatisfied(graph, "検索", rev);
    expect(graph.nodes["MVP"]!.satisfied).toBe(true); // 一方向（2026-08-26 の判断）
  });

  test("親に未達の前提があれば、子が揃っても親は立てない", () => {
    // `requires` と `contains` の両方を持つノードで、contains 側だけ揃った状態。
    // 実データでこれが起きて、目的が勝手に達成済みになった（2026-09-02）。
    const graph = g("目的 -> 手順書, 目的 -> [部品A] -> [部品B]");
    const rev = buildReverseIndex(graph);
    toggleSatisfied(graph, "部品A", rev);
    toggleSatisfied(graph, "部品B", rev);
    expect(graph.nodes["部品A"]!.satisfied).toBe(true);
    expect(graph.nodes["部品B"]!.satisfied).toBe(true);
    // 手順書がまだなので、目的は達成にならない
    expect(graph.nodes["目的"]!.satisfied).toBe(false);
    expect(graph.nodes["手順書"]!.satisfied).toBe(false);

    // 前提も満たせば、そこで初めて集約が効く
    toggleSatisfied(graph, "手順書", buildReverseIndex(graph));
    expect(graph.nodes["目的"]!.satisfied).toBe(true);
  });

  test("カスケードの判定は resolveState と食い違わない", () => {
    // 片方だけが両エッジを見ていると、導出とカスケードが別のことを言い始める。
    const graph = g("目的 -> 手順書, 目的 -> [部品A]");
    const rev = buildReverseIndex(graph);
    toggleSatisfied(graph, "部品A", rev);
    expect(resolveState(graph, "目的")).toBe("BLOCKED");
    expect(graph.nodes["目的"]!.satisfied).toBe(false);
  });
});

describe("トグルの下見", () => {
  test("計画を立てただけではグラフを触らない", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    const plan = planToggle(graph, "引っ越し先の家", buildReverseIndex(graph));
    expect(plan.satisfied).toBe(true);
    for (const id of Object.keys(graph.nodes)) expect(graph.nodes[id]!.satisfied).toBe(false);
  });

  test("下見の内容と、実際に書き換わるものが一致する", () => {
    // ここがずれると「見せたもの」と「書いたもの」が別になる。プレビューを
    // 別実装にしない理由そのものなので、テストでも縛っておく。
    const graph = g("目的 -> 手順書 -> 下調べ, 目的 -> [部品A]");
    const rev = buildReverseIndex(graph);
    const plan = planToggle(graph, "手順書", rev);
    const changed = toggleSatisfied(graph, "手順書", rev);
    expect(changed.sort()).toEqual(plan.changes.map((c) => c.id).sort());
  });

  test("連動の理由を持つ（前提か・親の集約か・下流か）", () => {
    const graph = g("目的 -> 手順書, 目的 -> [部品A], 手順書 -> 下調べ");
    const rev = buildReverseIndex(graph);
    graph.nodes["部品A"]!.satisfied = true;
    const plan = planToggle(graph, "手順書", rev);
    expect(plan.changes).toEqual([
      { kind: "target", id: "手順書", satisfied: true },
      { kind: "prerequisite", id: "下調べ", via: "手順書" },
      { kind: "contains-parent", id: "目的" },
    ]);
  });

  test("取り消しの下見は下流だけを挙げる", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    for (const id of Object.keys(graph.nodes)) graph.nodes[id]!.satisfied = true;
    const plan = planToggle(graph, "引っ越し先の家", buildReverseIndex(graph));
    expect(plan.satisfied).toBe(false);
    expect(plan.changes).toEqual([
      { kind: "target", id: "引っ越し先の家", satisfied: false },
      { kind: "dependent", id: "引っ越し", via: "引っ越し先の家" },
    ]);
  });

  test("既に達成済みの前提は連動に数えない", () => {
    // 「N件が書き換わります」に、実際には書かれないものを混ぜない。
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    graph.nodes["不動産に行く"]!.satisfied = true;
    const plan = planToggle(graph, "引っ越し先の家", buildReverseIndex(graph));
    expect(plan.changes).toEqual([{ kind: "target", id: "引っ越し先の家", satisfied: true }]);
  });

  test("同じノードへ2つの理由で届いても1件", () => {
    const graph = g("目的 -> 前A -> 共通, 目的 -> 前B -> 共通");
    const rev = buildReverseIndex(graph);
    const plan = planToggle(graph, "目的", rev);
    expect(plan.changes.filter((c) => c.id === "共通").length).toBe(1);
    expect(plan.changes.length).toBe(4);
  });
});

describe("直前のトグルを戻す", () => {
  /** 全ノードの `satisfied` を並べて比べるための写し。 */
  const snapshot = (graph: Graph): Record<string, boolean> =>
    Object.fromEntries(Object.keys(graph.nodes).sort().map((id) => [id, graph.nodes[id]!.satisfied]));

  test("もう一度押しても元には戻らない（戻す仕組みが要る理由）", () => {
    // 往路は前提を遡って埋め、復路は下流を戻す——向きが違う。同じノードを
    // 2回押すと、埋まった前提は残ったまま、代わりに別のノードが未達に落ちる。
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    const before = snapshot(graph);
    const rev = buildReverseIndex(graph);

    toggleSatisfied(graph, "引っ越し先の家", rev);
    toggleSatisfied(graph, "引っ越し先の家", rev);

    expect(snapshot(graph)).not.toEqual(before);
    expect(graph.nodes["不動産に行く"]!.satisfied).toBe(true); // 埋まった前提が残る
  });

  test("控えを戻すと、押す前と1ビットも変わらない", () => {
    const graph = g("目的 -> 手順書 -> 下調べ, 目的 -> [部品A]");
    graph.nodes["部品A"]!.satisfied = true;
    const before = snapshot(graph);

    const plan = planToggle(graph, "手順書", buildReverseIndex(graph));
    const undo = captureUndo(graph, plan);
    applyTogglePlan(graph, plan);
    expect(snapshot(graph)).not.toEqual(before);

    expect(applyUndo(graph, undo).sort()).toEqual(["下調べ", "手順書", "目的"]);
    expect(snapshot(graph)).toEqual(before);
  });

  test("取り消しの下流も同じように戻る", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    for (const id of Object.keys(graph.nodes)) graph.nodes[id]!.satisfied = true;
    const before = snapshot(graph);

    const plan = planToggle(graph, "引っ越し先の家", buildReverseIndex(graph));
    const undo = captureUndo(graph, plan);
    applyTogglePlan(graph, plan);
    applyUndo(graph, undo);
    expect(snapshot(graph)).toEqual(before);
  });

  test("控えに入るのは実際に書き換わったノードだけ", () => {
    // 既に達成済みの前提は「変わらない」ので、戻す対象でもない。ここを
    // 混ぜると、押す前から達成だったノードを未達へ落としてしまう。
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    graph.nodes["不動産に行く"]!.satisfied = true;
    const plan = planToggle(graph, "引っ越し先の家", buildReverseIndex(graph));
    expect(captureUndo(graph, plan).entries).toEqual([
      { id: "引っ越し先の家", before: false, after: true },
    ]);
  });

  test("外で1件でも書き換わっていたら戻さない", () => {
    // 巻き戻しは「自分が書いた値を消す」操作。他人（Obsidian / AI / git）の
    // 書き込みまで消さないよう、食い違ったら丸ごと諦める。
    const graph = g("目的 -> 手順書 -> 下調べ");
    const plan = planToggle(graph, "手順書", buildReverseIndex(graph));
    const undo = captureUndo(graph, plan);
    applyTogglePlan(graph, plan);
    expect(canUndo(graph, undo)).toBe(true);

    graph.nodes["下調べ"]!.satisfied = false; // 外が触った
    expect(canUndo(graph, undo)).toBe(false);
  });

  test("戻したあとの控えはもう使えない（二度押しで先へ行かない）", () => {
    const graph = g("目的 -> 手順書 -> 下調べ");
    const plan = planToggle(graph, "手順書", buildReverseIndex(graph));
    const undo = captureUndo(graph, plan);
    applyTogglePlan(graph, plan);
    applyUndo(graph, undo);
    expect(canUndo(graph, undo)).toBe(false);
    expect(applyUndo(graph, undo)).toEqual([]);
  });
});

describe("構造", () => {
  test("ルートは入次数0（type ではなく構造から導出）", () => {
    const graph = g("引っ越し -> 家 -> 不動産, 確定申告 -> 領収書整理");
    const rev = buildReverseIndex(graph);
    expect(roots(graph, rev)).toEqual(["引っ越し", "確定申告"].sort());
  });

  test("合流点の入次数が構造上の優先度になる", () => {
    const graph = g("リリース -> CI/CD, 監査対応 -> CI/CD");
    const rev = buildReverseIndex(graph);
    expect(inDegree("CI/CD", rev)).toBe(2);
    expect(inDegree("リリース", rev)).toBe(0);
  });

  test("progress は両エッジを辿った子孫の達成率", () => {
    const graph = g("引っ越し -> 家 -> 不動産");
    graph.nodes["不動産"]!.satisfied = true;
    expect(progress(graph, "引っ越し")).toEqual({ done: 1, total: 3 });
  });
});

describe("DSL", () => {
  test("同じ名前は同じノードに解決される", () => {
    const graph = g("A -> B, C -> B");
    expect(Object.keys(graph.nodes).sort()).toEqual(["A", "B", "C"]);
    expect(graph.nodes["B"]!.requires).toEqual([]);
  });

  test("角括弧は contains、後続の角括弧で兄弟を並べられる", () => {
    const graph = g("親 -> [子1] -> [子2]");
    expect(graph.nodes["親"]!.contains).toEqual(["子1", "子2"]);
    expect(graph.nodes["親"]!.requires).toEqual([]);
  });

  test("名前の途中改行は1つの識別子に潰す", () => {
    const parsed = parseDsl("Mag\n  Prime -> 素材");
    expect(parsed.errors).toEqual([]);
    expect(parsed.nodes.map((n) => n.id)).toContain("Mag Prime");
  });

  test("構文エラーは例外でなく errors で返る", () => {
    expect(parseDsl("A -> [B").errors.length).toBeGreaterThan(0);
    expect(parseDsl("A ->").errors.length).toBeGreaterThan(0);
  });
});

describe("前提の一括追加", () => {
  test("改行リストが1行1ノードの前提になる。空行と前後の空白は無視", () => {
    const parsed = parseBulkRequires("引っ越し", "引っ越し先の家\n\n  お金を貯める  \n不動産に行く");
    expect(parsed.errors).toEqual([]);
    const target = parsed.nodes.find((n) => n.id === "引っ越し")!;
    expect(target.requires).toEqual(["引っ越し先の家", "お金を貯める", "不動産に行く"]);
    expect(target.contains).toEqual([]);
  });

  test("重複行と自己参照は落ちる", () => {
    const target = parseBulkRequires("A", "B\nB\nA").nodes.find((n) => n.id === "A")!;
    expect(target.requires).toEqual(["B"]);
  });

  test("中身（contains）でも同じ入力で繋げる", () => {
    const parsed = parseBulkLinks("分解する機能", "近道を見せる\n中身の一括追加", "contains");
    const target = parsed.nodes.find((n) => n.id === "分解する機能")!;
    expect(target.contains).toEqual(["近道を見せる", "中身の一括追加"]);
    expect(target.requires).toEqual([]);
  });

  test("名前に , や -> や [ ] が入っていても1行は1ノードのまま", () => {
    // 以前は DSL 文字列に組み立て直していたので、記号のところで別のノードに割れた
    const parsed = parseBulkRequires("比べる", "A, B を比べる\n入力 -> 出力の対応表\n[下書き] を読む");
    expect(parsed.errors).toEqual([]);
    expect(parsed.nodes.find((n) => n.id === "比べる")!.requires).toEqual([
      "A, B を比べる",
      "入力 -> 出力の対応表",
      "[下書き] を読む",
    ]);
    expect(parsed.nodes).toHaveLength(4);
  });
});

describe("近道（要らなくなった直接の前提）", () => {
  test("兄弟の下へ兄弟を繋ぐと、親からの直接の線が近道になる", () => {
    // 一括追加で平らに並べたあと、「不動産に行く」が「引っ越し先の家」の前提だと気づいて繋いだ
    const graph = g("引っ越し -> 引っ越し先の家, 引っ越し -> 不動産に行く, 引っ越し先の家 -> 不動産に行く");
    expect(findShortcuts(graph, [{ from: "引っ越し先の家", to: "不動産に行く" }])).toEqual([
      { from: "引っ越し", to: "不動産に行く", via: "引っ越し先の家" },
    ]);
  });

  test("既にある道の上へ近道を足した場合は、足した線そのものを返す", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く, 引っ越し -> 不動産に行く");
    expect(findShortcuts(graph, [{ from: "引っ越し", to: "不動産に行く" }])).toEqual([
      { from: "引っ越し", to: "不動産に行く", via: "引っ越し先の家" },
    ]);
  });

  test("祖先から子孫への線も拾う", () => {
    // 目的 -> 途中 -> 下, 目的 -> 孫。新しく 下 -> 孫 を繋ぐと、2段上からの直接の線も近道
    const graph = g("目的 -> 途中 -> 下 -> 孫, 目的 -> 孫");
    expect(findShortcuts(graph, [{ from: "下", to: "孫" }])).toEqual([{ from: "目的", to: "孫", via: "途中" }]);
  });

  test("今回の追加と関係ない近道は掘り返さない", () => {
    const graph = g("A -> B -> C, A -> C, X -> Y");
    expect(findShortcuts(graph, [{ from: "X", to: "Y" }])).toEqual([]);
  });

  test("別の道が無ければ近道ではない", () => {
    const graph = g("引っ越し -> 引っ越し先の家, 引っ越し -> お金を貯める");
    expect(findShortcuts(graph, [{ from: "引っ越し", to: "お金を貯める" }])).toEqual([]);
  });

  test("contains を通る道は数えない", () => {
    // 完了の伝わる向きが逆なので、外すとカスケードの届き方が変わる
    const graph = g("親 -> [子], 子 -> 前提, 親 -> 前提");
    expect(findShortcuts(graph, [{ from: "子", to: "前提" }])).toEqual([]);
  });

  test("輪の上では出さない（輪の中はどこからでも届く）", () => {
    const graph = g("A -> B -> C -> B, A -> C");
    expect(findShortcuts(graph, [{ from: "B", to: "C" }])).toEqual([]);
  });

  test("近道を外しても、どのノードの状態も変わらない", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く, 引っ越し -> 不動産に行く, 引っ越し -> お金を貯める");
    graph.nodes["不動産に行く"]!.satisfied = true;
    const before = Object.keys(graph.nodes).map((id) => resolveState(graph, id));
    const via = shortcutVia(graph, "引っ越し", "不動産に行く");
    expect(via).toBe("引っ越し先の家");
    graph.nodes["引っ越し"]!.requires = graph.nodes["引っ越し"]!.requires.filter((id) => id !== "不動産に行く");
    expect(Object.keys(graph.nodes).map((id) => resolveState(graph, id))).toEqual(before);
    // 外したあとは近道ではない（唯一の道は切らせない）
    expect(shortcutVia(graph, "引っ越し先の家", "不動産に行く")).toBeUndefined();
  });
});

describe("検索", () => {
  test("隣接4方向が取れる", () => {
    const graph = g("リリース -> CI/CD -> 手順書, プロジェクト -> [CI/CD]");
    const rev = buildReverseIndex(graph);
    const n = neighbors(graph, "CI/CD", rev);
    expect(n.requires).toEqual(["手順書"]);
    expect(n.requiredBy).toEqual(["リリース"]);
    expect(n.containedBy).toEqual(["プロジェクト"]);
  });

  test("単語を思い出せなくても隣接から辿り着ける", () => {
    const graph = g("リリース -> CI/CD -> 手順書");
    const rev = buildReverseIndex(graph);
    const hit = search(graph, rev, { query: "CI" }).hits[0]!;
    expect(hit.id).toBe("CI/CD");
    // 「手順書」という単語を打っていないのに結果に現れる。
    expect(hit.neighbors!.requires).toContain("手順書");
  });

  test("パンくずに属する目的が出る。複数並べば合流点", () => {
    const graph = g("リリース -> CI/CD, 監査対応 -> CI/CD");
    const rev = buildReverseIndex(graph);
    const hit = search(graph, rev, { query: "CI/CD" }).hits[0]!;
    expect(hit.breadcrumb).toEqual(["監査対応", "リリース"].sort());
    expect(hit.inDegree).toBe(2);
  });

  test("本文も検索対象", () => {
    const graph = g("確定申告 -> 領収書整理");
    graph.nodes["確定申告"]!.note = "去年は freee で出した";
    const rev = buildReverseIndex(graph);
    const hits = search(graph, rev, { query: "freee" }).hits;
    expect(hits.map((h) => h.id)).toEqual(["確定申告"]);
    expect(hits[0]!.matchedIn).toEqual(["note"]);
  });

  test("横断 Next Action ビューは検索の特殊形", () => {
    const graph = g("引っ越し -> 家 -> 不動産, 確定申告 -> 領収書整理");
    const rev = buildReverseIndex(graph);
    expect(nextActions(graph, rev).hits.map((h) => h.id).sort()).toEqual(["不動産", "領収書整理"].sort());
  });
});

describe("循環解析の使い回し", () => {
  const dsl = `実績を作る -> 案件を取る -> 実績を作る,
               ポートフォリオを公開する -> 実績を作る,
               確定申告 -> 領収書整理`;

  test("analyzeCycles は findCycles / cyclicNodes と同じものを1回で返す", () => {
    const graph = g(dsl);
    const info = analyzeCycles(graph);
    expect(info.cycles).toEqual(findCycles(graph));
    expect([...info.cyclic].sort()).toEqual([...cyclicNodes(graph)].sort());
  });

  test("外から渡した循環解析でも結果が変わらない", () => {
    const graph = g(dsl);
    const rev = buildReverseIndex(graph);
    const info = analyzeCycles(graph);
    expect(search(graph, rev, { cycles: info })).toEqual(search(graph, rev));
    expect(nextActions(graph, rev, { cycles: info })).toEqual(nextActions(graph, rev));
    expect(stuckReport(graph, info)).toEqual(stuckReport(graph));
  });

  test("バッジの件数は横断ビューの件数と一致する", () => {
    // 数えるだけの経路を分けたので、検索本体と答えがずれないことを固定する。
    const graph = g(dsl);
    const rev = buildReverseIndex(graph);
    expect(countActionable(graph)).toBe(nextActions(graph, rev).total);
    expect(countActionable(graph, analyzeCycles(graph))).toBe(1);
  });
});

describe("descendantProgress / descendantOutline", () => {
  // プロジェクト
  //  ├─(contains) Aの担当分 ── 実装 / ドキュメント
  //  └─(contains) Bの担当分 ── テスト
  const dsl = "プロジェクト -> [Aの担当分] -> [Bの担当分], Aの担当分 -> [実装] -> [ドキュメント], Bの担当分 -> [テスト]";

  test("下の達成率は両エッジを辿り、自分は数に入れない", () => {
    // 分解のほとんどは requires なので、contains だけ見るとほぼ全ノードで
    // 「下に何も無い」ことになる（移植元の取り残し。2026-09-02 に直した）。
    const graph = g(`${dsl}, テスト -> テスト環境`);
    expect(descendantProgress(graph, "プロジェクト")).toEqual({ done: 0, total: 6 });
    graph.nodes["実装"]!.satisfied = true;
    expect(descendantProgress(graph, "プロジェクト")).toEqual({ done: 1, total: 6 });
  });

  test("自分の satisfied は下の達成率に数えない", () => {
    // 「本体は達成だが下は未完」を見せるための指標なので、ここで自分を
    // 入れると誤読を防ぐ役に立たなくなる。
    const graph = g(dsl);
    graph.nodes["プロジェクト"]!.satisfied = true;
    expect(descendantProgress(graph, "プロジェクト")).toEqual({ done: 0, total: 5 });
  });

  test("合流点は二重に数えない", () => {
    const graph = g(`${dsl}, Aの担当分 -> [共通基盤], Bの担当分 -> [共通基盤]`);
    expect(descendantProgress(graph, "プロジェクト")).toEqual({ done: 0, total: 6 });
  });

  test("一覧に並ぶのは飛び先だけ。末端は出さない", () => {
    // チェックリストではなく飛び先のメニュー。末端まで並べると実データで
    // 12行 → 30行 に膨らみ、ホバーで出すには重すぎた（2026-09-02 に戻した）。
    const graph = g(dsl);
    expect(descendantOutline(graph, "プロジェクト").map((x) => [x.id, x.depth])).toEqual([
      ["Aの担当分", 0],
      ["Bの担当分", 0],
    ]);
  });

  test("requires の下も一覧に出る（contains 限定にしない）", () => {
    const graph = g("引っ越し -> 引っ越し先の家 -> 不動産に行く");
    expect(descendantOutline(graph, "引っ越し").map((x) => [x.id, x.depth])).toEqual([
      ["引っ越し先の家", 0],
    ]);
  });

  test("行の done は自分の satisfied ではなく下が揃ったか", () => {
    const graph = g(dsl);
    graph.nodes["Aの担当分"]!.satisfied = true;
    const before = descendantOutline(graph, "プロジェクト").find((x) => x.id === "Aの担当分")!;
    expect(before.done).toBe(false); // 本体は達成でも下は未完
    graph.nodes["実装"]!.satisfied = true;
    graph.nodes["ドキュメント"]!.satisfied = true;
    const after = descendantOutline(graph, "プロジェクト").find((x) => x.id === "Aの担当分")!;
    expect(after.done).toBe(true);
  });

  test("合流点は2度目以降 repeat が立ち、展開を繰り返さない", () => {
    // 部品にも下を持たせる（末端は一覧に出ないので、繰り返しの検査にならない）
    const graph = g("親 -> [A] -> [B], A -> [共通] -> [C], B -> [共通], 共通 -> [部品], 部品 -> [ねじ]");
    const outline = descendantOutline(graph, "親");
    const shared = outline.filter((x) => x.id === "共通");
    expect(shared.map((x) => x.repeat)).toEqual([false, true]);
    // 部品（共通の下）は最初の1回だけ。2度目の下にはぶら下がらない。
    expect(outline.filter((x) => x.id === "部品").length).toBe(1);
  });

  test("輪になっていても止まる", () => {
    const graph = g("A -> [B]");
    graph.nodes["B"]!.contains.push("A");
    // どちらも下を持つので両方とも行になる（A は既出）
    expect(descendantOutline(graph, "A").map((x) => x.id)).toEqual(["B", "A"]);
    expect(descendantProgress(graph, "A")).toEqual({ done: 0, total: 1 });
  });

  test("下が末端しか無ければ一覧は空（＝ホバーしても出ない）", () => {
    const graph = g("確定申告 -> 領収書整理");
    expect(descendantOutline(graph, "確定申告")).toEqual([]);
    expect(descendantOutline(graph, "領収書整理")).toEqual([]);
    expect(descendantProgress(graph, "領収書整理")).toEqual({ done: 0, total: 0 });
  });
});

describe("pathFromRoot（目的からの経路）", () => {
  const path = (graph: Graph, id: string): string[] => pathFromRoot(graph, buildReverseIndex(graph), id);

  test("目的から対象の1つ上までを順に返す。対象自身は含まない", () => {
    const graph = g("引っ越し -> 家 -> 不動産 -> 内見の予約を取る");
    expect(path(graph, "内見の予約を取る")).toEqual(["引っ越し", "家", "不動産"]);
  });

  test("目的そのものは空", () => {
    expect(path(g("引っ越し -> 家"), "引っ越し")).toEqual([]);
  });

  test("内包でも同じように辿る（前提と区別しない）", () => {
    // パンくずが言うのは「どこにいるか」で、そこへ来た関係の種類ではない。
    const graph = g("目的 -> [部品A], 部品A -> 部品Aの中身");
    expect(path(graph, "部品Aの中身")).toEqual(["目的", "部品A"]);
  });

  test("合流点では最短の1本。同じ長さなら親の名前順で決まる", () => {
    // 経路は本来一意でない。飛ぶたびに違う道が出ると、同じノードが毎回
    // 違う場所にあるように見えるので、選び方を決定的にしてある。
    const graph = g("目的 -> 長い道 -> 中継 -> 合流, 目的 -> 短い道 -> 合流");
    expect(path(graph, "合流")).toEqual(["目的", "短い道"]);

    // 同じ長さの2本。名前順で「あ」側が勝つ。
    const tie = g("目的 -> あの道 -> 合流, 目的 -> んの道 -> 合流");
    expect(path(tie, "合流")).toEqual(["目的", "あの道"]);
    expect(path(tie, "合流")).toEqual(path(tie, "合流")); // 呼ぶたびに変わらない
  });

  test("輪の中にいて目的へ届かないときは空", () => {
    // 空を返すのは「経路が無い」で、パンくずは1段だけになる。ここで例外を
    // 投げたり無限に上ったりすると、輪のあるノードを開けなくなる。
    const graph = g("実績を作る -> 案件を取る -> 実績を作る");
    expect(path(graph, "実績を作る")).toEqual([]);
  });

  test("輪の下にぶら下がっていても、目的まで届くなら経路が出る", () => {
    const graph = g("ポートフォリオを公開する -> 実績を作る -> 案件を取る -> 実績を作る");
    expect(path(graph, "案件を取る")).toEqual(["ポートフォリオを公開する", "実績を作る"]);
  });

  test("知らない id は空", () => {
    expect(path(g("引っ越し -> 家"), "存在しない")).toEqual([]);
  });
});
