import { describe, expect, test } from "bun:test";
import { parseDsl, parseBulkRequires, buildBulkRequiresDsl } from "./dsl.ts";
import {
  analyzeCycles,
  blockedByCycle,
  buildReverseIndex,
  cyclicNodes,
  findCycles,
  inDegree,
  neighbors,
  progress,
  resolveState,
  roots,
  toggleSatisfied,
} from "./engine.ts";
import { newGraph, type Graph } from "./model.ts";
import { countActionable, nextActions, search, stuckReport } from "./search.ts";

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
  test("改行リストが DSL 文字列に組み上がる", () => {
    const dsl = buildBulkRequiresDsl("引っ越し", "引っ越し先の家\n\n  お金を貯める  \n不動産に行く");
    expect(dsl).toBe("引っ越し -> 引っ越し先の家, 引っ越し -> お金を貯める, 引っ越し -> 不動産に行く");
  });

  test("重複行と自己参照は落ちる", () => {
    expect(buildBulkRequiresDsl("A", "B\nB\nA")).toBe("A -> B");
  });

  test("既存 DSL パーサをそのまま通る（新規パーサ不要）", () => {
    const parsed = parseBulkRequires("引っ越し", "家\nお金");
    expect(parsed.errors).toEqual([]);
    const target = parsed.nodes.find((n) => n.id === "引っ越し")!;
    expect(target.requires).toEqual(["家", "お金"]);
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
