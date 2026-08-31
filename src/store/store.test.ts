import { describe, expect, test } from "bun:test";
import { planReconcile, normalizeForDuplicateCheck } from "../core/reconcile.ts";
import { resolveState } from "../core/engine.ts";
import { MemoryFs } from "./fs.ts";
import { parseNodeFile, serializeNodeFile, splitFrontmatter } from "./frontmatter.ts";
import { MarkdownGraphStore } from "./store.ts";

const md = (fm: string, body = "") => `---\n${fm}\n---\n${body ? `\n${body}\n` : ""}`;

describe("frontmatter", () => {
  test("読み書きの往復で内容が保たれる", () => {
    const { node } = parseNodeFile(
      "確定申告",
      md("satisfied: true\nrequires:\n  - 領収書整理\ncontains: []\ndue: 2027-03-15", "去年は freee で出した。"),
      1234,
    );
    expect(node.id).toBe("確定申告");
    expect(node.satisfied).toBe(true);
    expect(node.requires).toEqual(["領収書整理"]);
    expect(node.due).toBe("2027-03-15");
    expect(node.note).toBe("去年は freee で出した。");

    const round = parseNodeFile("確定申告", serializeNodeFile(node), 1234).node;
    expect(round).toEqual(node);
  });

  test("前提を1つ足すと git diff が1行で済む（ブロックスタイル）", () => {
    const { node } = parseNodeFile("A", md("satisfied: false\nrequires:\n  - B\ncontains: []"), 0);
    const before = serializeNodeFile(node);
    node.requires.push("C");
    const after = serializeNodeFile(node);
    const added = after.split("\n").filter((l) => !before.split("\n").includes(l));
    expect(added).toEqual(["  - C"]);
  });

  test("無引用の日付は Date でなく文字列のまま受け取る", () => {
    // js-yaml の既定スキーマは `2027-03-15` を Date に暗黙変換する。
    // frontmatter は人間とエージェントが素直に書く場所なので、
    // 書いたとおりの文字列で往復しないと型が合わなくなる。
    const { node } = parseNodeFile("A", md("satisfied: false\nrequires: []\ncontains: []\ndue: 2027-03-15"), 0);
    expect(node.due).toBe("2027-03-15");
    expect(serializeNodeFile(node)).toContain("due: 2027-03-15");
  });

  test("frontmatter が無いファイルは全部本文として扱う", () => {
    const { node } = parseNodeFile("メモ", "ただのメモ書き", 0);
    expect(node.note).toBe("ただのメモ書き");
    expect(node.satisfied).toBe(false);
  });

  test("YAML が壊れていてもノードは失わない", () => {
    const { node } = parseNodeFile("壊れ", md("satisfied: [unclosed\n  : :"), 0);
    expect(node.id).toBe("壊れ");
    expect(node.satisfied).toBe(false);
  });

  test("型が変な値は既定値へ落として issues に残す", () => {
    const { node, issues } = parseNodeFile("変", md('satisfied: "yes"\nrequires: 文字列'), 0);
    expect(node.satisfied).toBe(false);
    expect(node.requires).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
  });

  test("閉じフェンスが無くてもデータを失わない", () => {
    const { node } = parseNodeFile("未完", "---\nsatisfied: true\n本文だけ", 0);
    expect(node.note).toContain("本文だけ");
  });

  test("空の配列は [] で書かれる", () => {
    expect(splitFrontmatter(serializeNodeFile(parseNodeFile("A", "", 0).node)).frontmatter).toEqual({
      satisfied: false,
      requires: [],
      contains: [],
    });
  });
});

describe("ストア", () => {
  test("トグルでカスケードされたノードのファイルだけが書かれる", async () => {
    const fs = new MemoryFs({
      引っ越し: md("satisfied: false\nrequires:\n  - 家\ncontains: []"),
      家: md("satisfied: false\nrequires:\n  - 不動産\ncontains: []"),
      不動産: md("satisfied: false\nrequires: []\ncontains: []"),
      無関係: md("satisfied: false\nrequires: []\ncontains: []"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    const before = fs.files.get("無関係")!.mtimeMs;

    const changed = await store.toggle(graph, "家");
    expect(changed.sort()).toEqual(["不動産", "家"].sort());
    expect(fs.files.get("無関係")!.mtimeMs).toBe(before); // 無関係なファイルは触らない
    expect(parseNodeFile("不動産", await fs.readNode("不動産"), 0).node.satisfied).toBe(true);
  });

  test("一括追加は既存ノードの satisfied と本文を保持する", async () => {
    const fs = new MemoryFs({
      引っ越し: md("satisfied: true\nrequires: []\ncontains: []", "3月中にやる"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();

    const res = await store.addBulkRequires(graph, "引っ越し", "引っ越し先の家\nお金を貯める");
    expect(res.errors).toEqual([]);
    expect(res.created.sort()).toEqual(["お金を貯める", "引っ越し先の家"].sort());
    expect(graph.nodes["引っ越し"]!.satisfied).toBe(true);
    expect(graph.nodes["引っ越し"]!.note).toBe("3月中にやる");
    expect(graph.nodes["引っ越し"]!.requires.sort()).toEqual(["お金を貯める", "引っ越し先の家"].sort());
  });

  test("ノード削除は参照側からもエッジを外す", async () => {
    const fs = new MemoryFs({
      A: md("satisfied: false\nrequires:\n  - B\ncontains: []"),
      B: md("satisfied: false\nrequires: []\ncontains: []"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    await store.deleteNode(graph, "B");
    expect(graph.nodes["A"]!.requires).toEqual([]);
    expect(fs.files.has("B")).toBe(false);
  });
});

describe("自動解決（mtime の新しい方を正）", () => {
  /** 指定 mtime でグラフを作る小道具。 */
  async function build(files: Record<string, { fm: string; mtime: number }>) {
    const fs = new MemoryFs();
    for (const [id, { fm, mtime }] of Object.entries(files)) {
      await fs.writeNode(id, md(fm));
      fs.touch(id, mtime);
    }
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    return { fs, store, graph };
  }

  test("親の方が新しい → 前提を埋める", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 2000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 1000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "satisfy-prerequisite", node: "A", prerequisite: "B" }]);
  });

  test("前提の方が新しい → 意図的な巻き戻しとみなして親を戻す", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 1000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 2000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "unsatisfy-node", node: "A", prerequisite: "B" }]);
  });

  test("mtime 同着は解決せず残す（git checkout 直後など）", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 5000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 5000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([]);
    expect(plan.unresolved).toEqual([{ kind: "mtime-tie", node: "A", prerequisite: "B" }]);
  });

  test("循環は自動解決せず残す（時刻では切れない）", async () => {
    const { graph } = await build({
      実績を作る: { fm: "satisfied: false\nrequires:\n  - 案件を取る\ncontains: []", mtime: 2000 },
      案件を取る: { fm: "satisfied: false\nrequires:\n  - 実績を作る\ncontains: []", mtime: 1000 },
    });
    const plan = planReconcile(graph);
    const cycle = plan.unresolved.find((u) => u.kind === "cycle");
    expect(cycle).toBeDefined();
  });

  test("リンク切れは空ノードを作って繋ぐ（情報を壊さない方向）", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: false\nrequires:\n  - 存在しない\ncontains: []", mtime: 1000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toContainEqual({ kind: "create-missing-node", id: "存在しない", referencedBy: ["A"] });
  });

  test("contains の子が全部揃った親は自動達成", async () => {
    const { graph } = await build({
      親: { fm: "satisfied: false\nrequires: []\ncontains:\n  - 子1\n  - 子2", mtime: 1000 },
      子1: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 2000 },
      子2: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 3000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toContainEqual({ kind: "satisfy-contains-parent", parent: "親" });
  });

  test("表記ゆれの重複は統合せず報告のみ", async () => {
    const { graph } = await build({
      "CI/CD": { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 1000 },
      "ＣＩ／ＣＤ": { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 1000 },
    });
    const plan = planReconcile(graph);
    const dup = plan.unresolved.find((u) => u.kind === "near-duplicate");
    expect(dup).toBeDefined();
    expect(normalizeForDuplicateCheck("手順書 作成")).toBe(normalizeForDuplicateCheck("手順書作成"));
  });

  test("適用すると矛盾が消え、ファイルにも書き戻される", async () => {
    const { fs, store, graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 2000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 1000 },
    });
    const changed = await store.reconcile(graph, planReconcile(graph));
    expect(changed).toEqual(["B"]);
    expect(resolveState(graph, "A")).toBe("SATISFIED");
    expect(parseNodeFile("B", await fs.readNode("B"), 0).node.satisfied).toBe(true);
    expect(planReconcile(graph).fixes).toEqual([]); // 冪等
  });

  test("エージェントが1ノードだけ書き換えた状況を再現して解決できる", async () => {
    // 「引っ越し先の家が決まった」とだけエージェントが書き、前提は放置。
    const { store, graph } = await build({
      引っ越し: { fm: "satisfied: false\nrequires:\n  - 家\ncontains: []", mtime: 1000 },
      家: { fm: "satisfied: true\nrequires:\n  - 不動産に行く\ncontains: []", mtime: 9000 },
      不動産に行く: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 1000 },
    });
    // 解決前: 行ったはずの不動産が「今やれること」に残っている
    expect(resolveState(graph, "不動産に行く")).toBe("ACTIONABLE");
    await store.reconcile(graph, planReconcile(graph));
    expect(resolveState(graph, "不動産に行く")).toBe("SATISFIED");
    expect(resolveState(graph, "引っ越し")).toBe("ACTIONABLE");
  });
});
