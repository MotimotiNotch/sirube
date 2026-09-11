// ゴール層（地図）の導出。
//
// ここで守りたいのは2つ。**畳んでも道が嘘にならないこと**と、
// **畳んだグラフから状態を導かないこと**。後者は陽性対照付きで固定してある
// （商グラフで `resolveState` を回すと前提が消えて「今やれる」になる）。

import { describe, expect, test } from "bun:test";
import { buildReverseIndex, resolveState } from "./engine.ts";
import { betweenKey, enclosingGoal, goalIds, goalLayer, goalRoots, isGoal } from "./goals.ts";
import { parseDsl } from "./dsl.ts";
import { newGraph, type Graph } from "./model.ts";

function g(dsl: string): Graph {
  const parsed = parseDsl(dsl);
  expect(parsed.errors).toEqual([]);
  const graph = newGraph();
  for (const n of parsed.nodes) graph.nodes[n.id] = n;
  return graph;
}

const rev = (graph: Graph) => buildReverseIndex(graph);

describe("ゴールの判定", () => {
  test("入次数0は宣言しなくてもゴール", () => {
    const graph = g("目的 -> 途中 -> 末端");
    expect(goalIds(graph, rev(graph))).toEqual(["目的"]);
  });

  test("`goal: true` を書くと中腹も浮上する。構造は変えない", () => {
    const graph = g("目的 -> 途中 -> 末端");
    graph.nodes["途中"]!.goal = true;
    expect(goalIds(graph, rev(graph)).sort()).toEqual(["目的", "途中"]);
    // 浮上させても前提関係はそのまま。地図に出るかどうかしか変わらない。
    expect(graph.nodes["目的"]!.requires).toEqual(["途中"]);
    expect(resolveState(graph, "途中", new Set())).toBe("BLOCKED");
  });

  test("入次数0のノードは `goal` が未指定でもゴールのまま", () => {
    // 「未指定」は降格ではない。ここが外れると、何も書いていない vault の
    // 入口が丸ごと空になる。降りたいときは `false` を書く（次のテスト）。
    const graph = g("目的 -> 末端");
    delete graph.nodes["目的"]!.goal;
    expect(isGoal(graph, "目的", rev(graph))).toBe(true);
  });

  test("`goal: false` は入次数0にも勝つ（終わらない根を地図から外す）", () => {
    const graph = g("哲学を体現する -> 記事で表明する -> 記事を1本書く");
    graph.nodes["哲学を体現する"]!.goal = false;
    graph.nodes["記事で表明する"]!.goal = true;

    expect(isGoal(graph, "哲学を体現する", rev(graph))).toBe(false);
    expect(goalIds(graph, rev(graph))).toEqual(["記事で表明する"]);
    // 降格は構造を変えない。前提も状態もそのまま。
    expect(graph.nodes["哲学を体現する"]!.requires).toEqual(["記事で表明する"]);
    expect(resolveState(graph, "哲学を体現する", new Set())).toBe("BLOCKED");
  });

  test("根を降格しても下は自動で昇格しない（地図から消える）", () => {
    // 足元の穴。親のノードは残るので下の入次数は0にならない。
    // **消えることをテストで固定しておく**——気付かずに入口を空にしないため。
    const graph = g("根 -> 中腹 -> 末端");
    graph.nodes["根"]!.goal = false;
    expect(goalIds(graph, rev(graph))).toEqual([]);

    graph.nodes["中腹"]!.goal = true;
    expect(goalIds(graph, rev(graph))).toEqual(["中腹"]);
  });

  test("降格した根は地図の段を1つ食わなくなる", () => {
    // 実データの縮図。根を外すと、その下に並んでいた2つがそのまま地図の根になる。
    const graph = g("終わらない根 -> [A], 終わらない根 -> [B]");
    graph.nodes["A"]!.goal = true;
    graph.nodes["B"]!.goal = true;

    expect(goalRoots(goalLayer(graph, rev(graph)))).toEqual(["終わらない根"]);

    graph.nodes["終わらない根"]!.goal = false;
    expect(goalRoots(goalLayer(graph, rev(graph))).sort()).toEqual(["A", "B"]);
  });
});

describe("縮約（ゴールだけの地図）", () => {
  test("間の非ゴールを畳んで、ゴール同士を繋ぐ", () => {
    const graph = g("A -> n1 -> n2 -> B -> n3 -> C");
    graph.nodes["B"]!.goal = true;
    graph.nodes["C"]!.goal = true;
    const layer = goalLayer(graph, rev(graph));

    expect(layer.graph.nodes["A"]!.requires).toEqual(["B"]);
    expect(layer.graph.nodes["B"]!.requires).toEqual(["C"]);
    // 畳んだ数は線に残す。0 件ではなく実数（A と B の間は n1 / n2 の2件）。
    expect(layer.between.get(betweenKey("A", "B"))).toBe(2);
    expect(layer.between.get(betweenKey("B", "C"))).toBe(1);
    // 非ゴールは地図に載らない
    expect(layer.graph.nodes["n1"]).toBeUndefined();
  });

  test("間に別のゴールがあれば、その先へは直接繋がない", () => {
    // これが崩れると、地図が「全ゴール総当たり」になって縮尺の意味が消える。
    const graph = g("A -> B -> C");
    graph.nodes["B"]!.goal = true;
    graph.nodes["C"]!.goal = true;
    const layer = goalLayer(graph, rev(graph));
    expect(layer.graph.nodes["A"]!.requires).toEqual(["B"]);
    expect(layer.between.has(betweenKey("A", "C"))).toBe(false);
  });

  test("合流は畳んだあとも残る（入次数＝いくつのゴールがそこを通るか）", () => {
    const graph = g("A -> n1 -> 合流, B -> n2 -> 合流");
    graph.nodes["合流"]!.goal = true;
    const layer = goalLayer(graph, rev(graph));
    expect(layer.rev.requiredBy.get("合流")?.sort()).toEqual(["A", "B"]);
  });

  test("同じゴールへ2本の道があるときは短い方の件数を出す", () => {
    // 遠い方を出すと、実際より遠く見える。
    const graph = g("A -> 近道 -> Z, A -> 遠回り1 -> 遠回り2 -> Z");
    graph.nodes["Z"]!.goal = true;
    const layer = goalLayer(graph, rev(graph));
    expect(layer.between.get(betweenKey("A", "Z"))).toBe(1);
  });

  test("輪があっても止まる。自分へ戻る線は引かない", () => {
    const graph = g("目的 -> 実績を作る -> 案件を取る -> 実績を作る");
    const layer = goalLayer(graph, rev(graph));
    expect(layer.graph.nodes["目的"]!.requires).toEqual([]);
    expect(goalRoots(layer)).toEqual(["目的"]);
  });

  test("状態は実グラフから引く（商グラフで導くと嘘になる）", () => {
    // 陽性対照。**この2つが同じ値を返すなら、この検査は何も見張っていない。**
    const graph = g("A -> n1 -> B, B -> 未達の前提");
    graph.nodes["B"]!.goal = true;
    const layer = goalLayer(graph, rev(graph));

    expect(resolveState(graph, "B", new Set())).toBe("BLOCKED");
    expect(resolveState(layer.graph, "B", new Set())).toBe("ACTIONABLE");
  });
});

describe("包んでいるゴール", () => {
  test("自分がゴールなら自分", () => {
    const graph = g("目的 -> 末端");
    expect(enclosingGoal(graph, "目的", rev(graph))).toBe("目的");
  });

  test("違えば上へ遡って一番近いゴール", () => {
    const graph = g("目的 -> 中 -> 末端");
    graph.nodes["中"]!.goal = true;
    expect(enclosingGoal(graph, "末端", rev(graph))).toBe("中");
  });

  test("上にゴールが無ければ undefined（輪の中）", () => {
    const graph = g("A -> B -> A");
    expect(enclosingGoal(graph, "A", rev(graph))).toBeUndefined();
  });
});
