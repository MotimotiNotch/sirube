import { describe, expect, test } from "bun:test";
import { analyzeCycles, buildReverseIndex } from "./engine.ts";
import { parseDsl } from "./dsl.ts";
import { AGENTS_DOC_PATH, GOALS_DIR, INDEX_DOC, renderMocs, type GeneratedDoc } from "./moc.ts";
import { newGraph, newNode, type Graph } from "./model.ts";
import { assertDocPath, MemoryFs } from "../store/fs.ts";
import { MarkdownGraphStore } from "../store/store.ts";

function g(dsl: string): Graph {
  const parsed = parseDsl(dsl);
  expect(parsed.errors).toEqual([]);
  const graph = newGraph();
  for (const n of parsed.nodes) graph.nodes[n.id] = n;
  return graph;
}

function render(graph: Graph): GeneratedDoc[] {
  return renderMocs(graph, buildReverseIndex(graph), analyzeCycles(graph));
}

function doc(docs: GeneratedDoc[], path: string): string {
  const found = docs.find((d) => d.path === path);
  expect(found, `${path} が生成されていない`).toBeDefined();
  return found!.content;
}

describe("MOC 3層の生成", () => {
  test("層1・層3・目的ごとの層2が出る", () => {
    const docs = render(g("引っ越し -> 家 -> 不動産, 確定申告 -> 領収書整理"));
    expect(docs.map((d) => d.path).sort()).toEqual(
      [
        INDEX_DOC,
        "90_達成済み.md",
        AGENTS_DOC_PATH, // エージェント向けの仕様書も vault に置く
        `${GOALS_DIR}/引っ越し.md`,
        `${GOALS_DIR}/確定申告.md`,
      ].sort(),
    );
  });

  test("目的名に何が来ても、ファイル名に空白と特殊文字を出さない", () => {
    // DSL は `[` を contains の記法として食うので、ノードを直接組む。
    const graph = newGraph();
    const node = newNode("01TEST");
    node.name = "Sirube [WIP]: v1.0 リリース";
    graph.nodes[node.id] = node;

    const goal = render(graph).find((d) => d.path.startsWith(`${GOALS_DIR}/`))!;

    // 「含まれない」だけを見る検査は、検出器が壊れていても通る（2026-09-02 に
    // 正規表現がバックスペース文字に化けていた実例あり）。出る形そのものを固定する。
    expect(goal.path).toBe(`${GOALS_DIR}/Sirube_WIP_v1.0_リリース.md`);
    expect(goal.path).not.toMatch(/[\s[\]#^]/);
  });

  test("潰した結果が衝突したら連番で避ける", () => {
    const graph = newGraph();
    for (const [id, name] of [["01A", "A/B"], ["01B", "A:B"]] as const) {
      const node = newNode(id);
      node.name = name;
      graph.nodes[id] = node;
    }

    const paths = render(graph)
      .map((d) => d.path)
      .filter((p) => p.startsWith(`${GOALS_DIR}/`))
      .sort();
    expect(paths).toEqual([`${GOALS_DIR}/A_B.md`, `${GOALS_DIR}/A_B_2.md`]);
  });

  test("生成物は nodes/ の外にしか置かない", () => {
    // ここが破れると生成物がノードとして読み込まれ、真実が2つになる。
    for (const d of render(g("引っ越し -> 家"))) {
      expect(d.path.startsWith("nodes/")).toBe(false);
      expect(() => assertDocPath(d.path)).not.toThrow();
    }
  });

  test("達成した目的は層1から消えて層3に出る。ノードは動かさない", () => {
    const graph = g("引っ越し -> 家, 確定申告 -> 領収書整理");
    graph.nodes["確定申告"]!.satisfied = true;
    const docs = render(graph);
    expect(doc(docs, INDEX_DOC)).not.toContain("[[確定申告]]");
    expect(doc(docs, "90_達成済み.md")).toContain("[[確定申告]]");
    // 層2は進行中のぶんだけ作る（達成した目的の「道」は残さない）
    expect(docs.some((d) => d.path === `${GOALS_DIR}/確定申告.md`)).toBe(false);
    // 戻し方が書いてある＝復元は satisfied を戻すだけで、移動も復元操作も無い
    expect(doc(docs, "90_達成済み.md")).toContain("`satisfied` を `false`");
  });

  test("目的は配下の最終更新が新しい順。古くても消えない", () => {
    // 二値で切ると半年ぶりに開いた瞬間に入口が空になる。順番だけ変える。
    const graph = g("古い目的 -> 古い枝, 新しい目的 -> 新しい枝");
    graph.nodes["古い目的"]!.mtimeMs = 1000;
    graph.nodes["古い枝"]!.mtimeMs = 1000;
    graph.nodes["新しい目的"]!.mtimeMs = 2000;
    graph.nodes["新しい枝"]!.mtimeMs = 9000;
    const index = doc(render(graph), INDEX_DOC);
    expect(index.indexOf("[[新しい目的]]")).toBeLessThan(index.indexOf("[[古い目的]]"));
    expect(index).toContain("[[古い目的]]"); // 消えていない
  });

  test("今やれることが無いとき、理由が必ず出る（輪）", () => {
    const graph = g("ポートフォリオを公開する -> 実績を作る -> 案件を取る -> 実績を作る");
    const docs = render(graph);
    expect(doc(docs, INDEX_DOC)).toContain("輪で詰まっています");
    expect(doc(docs, `${GOALS_DIR}/ポートフォリオを公開する.md`)).toContain("輪で詰まっています");
  });

  test("今やれることが無いとき、理由が必ず出る（全部揃っている）", () => {
    const graph = g("引っ越し -> 家 -> 不動産");
    graph.nodes["家"]!.satisfied = true;
    graph.nodes["不動産"]!.satisfied = true;
    expect(doc(render(graph), INDEX_DOC)).toContain("必要なものは全部揃っています");
  });

  test("層2に出るのは直下の子だけ。孫は出さない", () => {
    // 子孫を全列挙すると結局また網羅になる。降りる先はノードのファイル。
    const graph = g("引っ越し -> 家 -> 不動産 -> 内見の予約を取る");
    const goal = doc(render(graph), `${GOALS_DIR}/引っ越し.md`);
    const needs = goal.slice(goal.indexOf("## これには何が必要か"), goal.indexOf("## 今やれること"));
    expect(needs).toContain("[[家]]");
    expect(needs).not.toContain("[[不動産]]");
    // ただし「今やれること」は末端なので、そちらには出る
    expect(goal).toContain("[[内見の予約を取る]]");
  });

  test("今やれることは合流点（入次数）の大きい順", () => {
    const graph = g("目的 -> 枝A -> 合流, 目的 -> 枝B -> 合流, 目的 -> ただの葉");
    const goal = doc(render(graph), `${GOALS_DIR}/目的.md`);
    // 「これには何が必要か」節にも同じリンクが出るので、比べるのは該当節の中だけ。
    const actionable = goal.slice(goal.indexOf("## 今やれること"));
    expect(actionable.indexOf("[[合流]]")).toBeLessThan(actionable.indexOf("[[ただの葉]]"));
    expect(actionable).toContain("（2 箇所から要求されている）");
  });

  test("id と表示名が違うときだけエイリアス記法にする", () => {
    // 今は id ＝ 名前なので素のリンク。ULID へ分離したら自動でエイリアスに変わる。
    const graph = newGraph();
    graph.nodes["01J8X2"] = { ...newNode("01J8X2"), name: "確定申告" };
    graph.nodes["領収書整理"] = newNode("領収書整理");
    graph.nodes["01J8X2"]!.requires = ["領収書整理"];
    const index = doc(render(graph), INDEX_DOC);
    expect(index).toContain("[[01J8X2|確定申告]]");
    expect(index).toContain("[[領収書整理]]");
    expect(index).not.toContain("[[領収書整理|領収書整理]]");
  });

  test("ファイル名に使えない文字を潰し、大小違いの衝突を連番で避ける", () => {
    // `リリース: v1.0` の `:` は保存時に黙って消える実績がある（Windows 実機で確認）。
    const graph = newGraph();
    for (const id of ["リリース: v1.0", "リリース- v1.0", "Ruv", "ruv"]) graph.nodes[id] = newNode(id);
    const paths = render(graph).map((d) => d.path);
    for (const p of paths) expect(p).not.toMatch(/[:*?"<>|]/);
    // 潰した結果ぶつかった側と、大小しか違わない側の、どちらも別ファイルになる
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(paths.length);
  });
});

describe("生成物の後始末", () => {
  test("消えた目的の層2ファイルは片付けられる", async () => {
    const fs = new MemoryFs();
    const store = new MarkdownGraphStore(fs);
    const graph = g("引っ越し -> 家, 確定申告 -> 領収書整理");

    await store.regenerateMocs(graph);
    expect(await fs.listDocs(GOALS_DIR)).toContain("確定申告.md");

    // 目的が消えたら、その「道」も残さない。存在しない目的の道が並ぶと
    // 入口としての信頼が落ちる。
    delete graph.nodes["確定申告"];
    delete graph.nodes["領収書整理"];
    await store.regenerateMocs(graph);
    expect(await fs.listDocs(GOALS_DIR)).toEqual(["引っ越し.md"]);
  });

  test("生成物はノードの一覧に混ざらない", async () => {
    const fs = new MemoryFs();
    const store = new MarkdownGraphStore(fs);
    await store.regenerateMocs(g("引っ越し -> 家"));
    expect(await fs.listNodes()).toEqual([]);
  });
});
