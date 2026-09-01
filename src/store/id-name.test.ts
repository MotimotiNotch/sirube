import { describe, expect, test } from "bun:test";
import { isUlid, ulid } from "../core/ulid.ts";
import { MemoryFs } from "./fs.ts";
import { parseNodeFile, serializeNodeFile } from "./frontmatter.ts";
import { MarkdownGraphStore, resolveReferences } from "./store.ts";
import { newGraph, newNode, type Graph } from "../core/model.ts";

const md = (fm: string, body = ""): string => `---\n${fm}\n---\n${body ? `\n${body}\n` : ""}`;

describe("表示名を frontmatter に置く", () => {
  test("name があればそれを、無ければファイル名を表示名にする", () => {
    const withName = parseNodeFile("01ABC", md("name: 確定申告\nsatisfied: false"), 0).node;
    expect(withName.name).toBe("確定申告");
    // 移行前の vault はこれで今までどおり読める。
    const withoutName = parseNodeFile("確定申告", md("satisfied: false"), 0).node;
    expect(withoutName.name).toBe("確定申告");
  });

  test("名前が id と同じなら name を書かない", () => {
    // 移行前の vault のファイルを、意味のない差分で書き換えないため。
    const node = newNode("確定申告");
    expect(serializeNodeFile(node)).not.toContain("name:");
    node.name = "確定申告（2026年分）";
    expect(serializeNodeFile(node)).toContain("name: 確定申告（2026年分）");
  });

  test("id を frontmatter に書かない", () => {
    // 2箇所に持つとずれたときに正が決まらない。id はファイル名だけ。
    const node = { ...newNode(ulid()), name: "確定申告" };
    expect(serializeNodeFile(node)).not.toContain("id:");
  });
});

describe("参照に名前のコメントを添える", () => {
  const target = ulid();

  test("ULID の参照には名前を、人名のままの参照には何も付けない", () => {
    const node = { ...newNode(ulid()), name: "確定申告" };
    node.requires = [target, "領収書整理"];
    const text = serializeNodeFile(node, (id) => (id === target ? "領収書整理" : undefined));
    expect(text).toContain(`- ${target}  # 領収書整理`);
    expect(text).toContain("- 領収書整理\n"); // 名前のままの要素はそのまま
    expect(text).not.toContain("- 領収書整理  #");
  });

  test("コメントは読み戻しても値を汚さない", () => {
    const node = { ...newNode(ulid()), name: "確定申告" };
    node.requires = [target];
    const text = serializeNodeFile(node, () => "領収書整理");
    expect(parseNodeFile(node.id, text, 0).node.requires).toEqual([target]);
  });

  test("改行を含む名前でも YAML を壊さない", () => {
    const node = { ...newNode(ulid()), name: "確定申告" };
    node.requires = [target];
    const text = serializeNodeFile(node, () => "領収書\n整理");
    expect(parseNodeFile(node.id, text, 0).node.requires).toEqual([target]);
  });
});

describe("参照は id でも名前でも書ける", () => {
  function graphWith(nodes: { id: string; name: string; requires?: string[] }[]): Graph {
    const g = newGraph();
    for (const n of nodes) g.nodes[n.id] = { ...newNode(n.id), name: n.name, requires: n.requires ?? [] };
    return g;
  }

  test("手で書いた名前が id に解決される", () => {
    // アプリ側に AI 連携を実装しない方針なので、Markdown を手で編集できる
    // という前提は壊せない。書く側は名前だけ知っていればいい。
    const target = ulid();
    const g = graphWith([
      { id: ulid(), name: "確定申告", requires: ["領収書整理"] },
      { id: target, name: "領収書整理" },
    ]);
    const issues: { id: string; problems: string[] }[] = [];
    resolveReferences(g, issues);
    expect(Object.values(g.nodes).find((n) => n.name === "確定申告")!.requires).toEqual([target]);
    expect(issues).toEqual([]);
  });

  test("表記ゆれも吸収する", () => {
    const target = ulid();
    const g = graphWith([
      { id: ulid(), name: "リリース", requires: ["ＣＩ／ＣＤ"] },
      { id: target, name: "CI/CD" },
    ]);
    resolveReferences(g, []);
    expect(Object.values(g.nodes).find((n) => n.name === "リリース")!.requires).toEqual([target]);
  });

  test("既知の id が名前より優先される", () => {
    // 名前が id と衝突するような病的な場合でも、id を書いたら id が勝つ。
    const target = ulid();
    const g = graphWith([
      { id: ulid(), name: "親", requires: [target] },
      { id: target, name: "子" },
      { id: ulid(), name: target },
    ]);
    resolveReferences(g, []);
    expect(Object.values(g.nodes).find((n) => n.name === "親")!.requires).toEqual([target]);
  });

  test("同名が複数あるときは解決せず、判断を人に返す", () => {
    // どちらかに勝手に繋ぐと、間違った方に繋がったことが誰にも分からない。
    const g = graphWith([
      { id: ulid(), name: "親", requires: ["確定申告"] },
      { id: ulid(), name: "確定申告" },
      { id: ulid(), name: "確定申告" },
    ]);
    const issues: { id: string; problems: string[] }[] = [];
    resolveReferences(g, issues);
    expect(Object.values(g.nodes).find((n) => n.name === "親")!.requires).toEqual(["確定申告"]);
    expect(issues[0]!.problems[0]).toContain("2 件");
  });

  test("ファイルを手でコピーした跡を拾う", () => {
    // アプリが書いたファイルをコピーすると、中身の name は残るのに
    // ファイル名だけ `... のコピー` になる。移行前の vault は name を
    // 持たないのでここには引っかからない。
    const g = graphWith([{ id: "01ABC のコピー", name: "確定申告" }]);
    const issues: { id: string; problems: string[] }[] = [];
    resolveReferences(g, issues);
    expect(issues[0]!.problems[0]).toContain("id の形式ではありません");

    const legacy = graphWith([{ id: "確定申告", name: "確定申告" }]);
    const legacyIssues: { id: string; problems: string[] }[] = [];
    resolveReferences(legacy, legacyIssues);
    expect(legacyIssues).toEqual([]);
  });
});

describe("id の採番", () => {
  /** `createNode` を最初の n 回だけ失敗させる MemoryFs。衝突の再現に使う。 */
  class CollidingFs extends MemoryFs {
    constructor(private failures: number) {
      super();
    }
    override async createNode(id: string, content: string): Promise<void> {
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error("既に存在します");
      }
      await super.createNode(id, content);
    }
  }

  test("採番した id は ULID で、名前は frontmatter に入る", async () => {
    const fs = new MemoryFs();
    const store = new MarkdownGraphStore(fs);
    const graph = newGraph();
    const node = await store.createNode(graph, "確定申告");
    expect(isUlid(node.id)).toBe(true);
    expect(node.name).toBe("確定申告");
    expect(await fs.readNode(node.id)).toContain("name: 確定申告");
  });

  test("排他作成が失敗したら別の id を採り直す", async () => {
    const store = new MarkdownGraphStore(new CollidingFs(3));
    const node = await store.createNode(newGraph(), "確定申告");
    expect(isUlid(node.id)).toBe(true);
  });

  test("連続で失敗したら止まる。黙って回り続けない", async () => {
    // 5回連続の失敗は衝突ではなく、乱数源かファイルシステムが壊れている証拠。
    const store = new MarkdownGraphStore(new CollidingFs(99));
    await expect(store.createNode(newGraph(), "確定申告")).rejects.toThrow("採番できませんでした");
  });

  test("既に同じ名前のノードがあれば採番せず、そこへ繋ぐ", async () => {
    const fs = new MemoryFs({ 引っ越し: md("satisfied: false\nrequires: []\ncontains: []") });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    const res = await store.importDsl(graph, "引っ越し -> 家");
    expect(res.errors).toEqual([]);
    expect(res.created).toHaveLength(1); // 「家」だけ
    expect(graph.nodes["引っ越し"]!.requires).toEqual(res.created);
  });
});
