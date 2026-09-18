import { describe, expect, test } from "bun:test";
import { planReconcile, normalizeForDuplicateCheck } from "../core/reconcile.ts";
import { resolveState } from "../core/engine.ts";
import { MemoryFs } from "./fs.ts";
import { parseNodeFile, serializeNodeFile, splitFrontmatter } from "./frontmatter.ts";
import { MarkdownGraphStore } from "./store.ts";
import { isUlid } from "../core/ulid.ts";

const md = (fm: string, body = "") => `---\n${fm}\n---\n${body ? `\n${body}\n` : ""}`;
const ID_A = `01M2F0SE1F${"0".repeat(16)}`; // Crockford に L は無い

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

  test("付箋の色は往復する。知らない色でもノードは壊さない", () => {
    const { node } = parseNodeFile("目的", md("satisfied: false\nrequires: []\ncontains: []\ncolor: pink"), 0);
    expect(node.color).toBe("pink");
    expect(serializeNodeFile(node)).toContain("color: pink");

    // 未知の値は弾かない。描く側が知らない色を無視すれば済む話で、1ノードの
    // 値が変なだけでグラフを落とさない方針に合わせてある。
    const odd = parseNodeFile("目的", md("satisfied: false\nrequires: []\ncontains: []\ncolor: chartreuse"), 0);
    expect(odd.node.color).toBe("chartreuse");
    expect(odd.issues).toEqual([]);
  });

  test("ゴール宣言は三状態で往復する。書いていないものには足さない", () => {
    // 未指定のまま撒かない。`goal: false` を全ファイルに書くと、入次数0で
    // 自動的にゴールになっているノードが「宣言した結果ゴールでない」ように読める。
    const plain = parseNodeFile("A", md("satisfied: false\nrequires: []\ncontains: []"), 0).node;
    expect(plain.goal).toBeUndefined();
    expect(serializeNodeFile(plain)).not.toContain("goal:");

    const { node } = parseNodeFile("B", md("goal: true\nsatisfied: false\nrequires: []\ncontains: []"), 0);
    expect(node.goal).toBe(true);
    const text = serializeNodeFile(node);
    expect(text).toContain("goal: true");
    expect(parseNodeFile("B", text, 0).node).toEqual(node);

    // **`false` も往復する**（2026-09-11）。畳むと降格が次の保存で消えるため。
    const off = parseNodeFile("C", md("goal: false\nsatisfied: false\nrequires: []\ncontains: []"), 0).node;
    expect(off.goal).toBe(false);
    const offText = serializeNodeFile(off);
    expect(offText).toContain("goal: false");
    expect(parseNodeFile("C", offText, 0).node).toEqual(off);
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
    // 作られるのは採番された id で、書いた名前は `name` に入る。
    expect(res.created).toHaveLength(2);
    for (const id of res.created) expect(isUlid(id)).toBe(true);
    expect(res.created.map((id) => graph.nodes[id]!.name).sort()).toEqual(
      ["お金を貯める", "引っ越し先の家"].sort(),
    );
    expect(graph.nodes["引っ越し"]!.satisfied).toBe(true);
    expect(graph.nodes["引っ越し"]!.note).toBe("3月中にやる");
    expect(graph.nodes["引っ越し"]!.requires.sort()).toEqual(res.created.sort());
  });

  test("中身（contains）の一括追加は contains に繋ぎ、既存の名前は既存に繋ぐ", async () => {
    const fs = new MemoryFs({
      括り: md("satisfied: false\nrequires: []\ncontains: []"),
      既存の作業: md("satisfied: true\nrequires: []\ncontains: []"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    const res = await store.addBulk(graph, "括り", "既存の作業\n新しい作業", "contains");
    expect(res.errors).toEqual([]);
    expect(res.created).toHaveLength(1);
    expect(graph.nodes["括り"]!.requires).toEqual([]);
    expect(graph.nodes["括り"]!.contains).toEqual(["既存の作業", res.created[0]!]);
    expect(res.addedRequires).toEqual([]);
  });

  test("一括追加に自分の名前を書いても自己ループにしない", async () => {
    // 起点は id で渡るので、名前→id の解決で自分に戻ってくる
    const fs = new MemoryFs({ [ID_A]: md("name: 引っ越し\nsatisfied: false\nrequires: []\ncontains: []") });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    await store.addBulk(graph, ID_A, "引っ越し\n家", "requires");
    expect(graph.nodes[ID_A]!.requires).not.toContain(ID_A);
    expect(graph.nodes[ID_A]!.requires).toHaveLength(1); // 陽性対照: 「家」は繋がっている
  });

  test("一括追加は今回足した requires だけを返す", async () => {
    const fs = new MemoryFs({
      引っ越し: md("satisfied: false\nrequires:\n  - 家\ncontains: []"),
      家: md("satisfied: false\nrequires: []\ncontains: []"),
      不動産: md("satisfied: false\nrequires: []\ncontains: []"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    // 「家」は既に繋がっているので数えない。「不動産」は既存ノードへの新しい線
    const res = await store.addBulkRequires(graph, "引っ越し", "家\n不動産");
    expect(res.addedRequires).toEqual([{ from: "引っ越し", to: "不動産" }]);
  });

  test("近道を外すときは書く直前に確かめ直し、唯一の繋がりは切らない", async () => {
    const fs = new MemoryFs({
      引っ越し: md("satisfied: false\nrequires:\n  - 家\n  - 不動産\ncontains: []"),
      家: md("satisfied: false\nrequires:\n  - 不動産\ncontains: []"),
      不動産: md("satisfied: false\nrequires: []\ncontains: []"),
    });
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    const shortcut = { from: "引っ越し", to: "不動産", via: "家" };

    // 確認を出している間に外で「家 -> 不動産」が消えた
    graph.nodes["家"]!.requires = [];
    expect((await store.detachShortcuts(graph, [shortcut])).done).toEqual([]);
    expect(graph.nodes["引っ越し"]!.requires).toContain("不動産");

    graph.nodes["家"]!.requires = ["不動産"];
    expect((await store.detachShortcuts(graph, [shortcut])).done).toEqual([shortcut]);
    expect(parseNodeFile("引っ越し", await fs.readNode("引っ越し"), 0).node.requires).toEqual(["家"]);
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

  describe("削除と外すを戻す", () => {
    const setup = async () => {
      const fs = new MemoryFs({
        A: md("number: 1\nsatisfied: false\nrequires:\n  - B\ncontains:\n  - C", "Aのメモ"),
        B: md("number: 2\nsatisfied: true\nrequires: []\ncontains: []", "Bのメモ"),
        C: md("number: 3\nsatisfied: false\nrequires:\n  - B\ncontains: []"),
      });
      const store = new MarkdownGraphStore(fs);
      const { graph } = await store.load();
      return { fs, store, graph };
    };

    test("削除を戻すと、同じ id・番号・中身のファイルと、両方の親からの参照が戻る", async () => {
      const { fs, store, graph } = await setup();
      const original = await fs.readNode("B");
      const { undo } = await store.deleteNode(graph, "B");
      expect(fs.files.has("B")).toBe(false); // 陽性対照
      expect(graph.nodes["C"]!.requires).toEqual([]);

      expect(await store.undoStructure(graph, undo)).toBe(true);
      expect(await fs.readNode("B")).toBe(original);
      expect(graph.nodes["B"]!.number).toBe(2);
      expect(graph.nodes["A"]!.requires).toEqual(["B"]);
      expect(parseNodeFile("C", await fs.readNode("C"), 0).node.requires).toEqual(["B"]);
    });

    test("消したノード自身が参照を持っていても、名前のコメントまで元のファイルと一致する", async () => {
      // 書き出しは参照の横に `# 名前` を付ける。戻す途中のグラフで書くと相手の
      // 名前が引けずにコメントが落ちた（実機で1行だけ違った）。名前と id を
      // 分けたノードで、アプリが書いた形のファイルから始める。
      // コメントは参照先が ULID のときだけ付くので、id を ULID の形にする。
      const P = `01M2F0SE1F${"0".repeat(15)}1`;
      const Q = `01M2F0SE1F${"0".repeat(15)}2`;
      const R = `01M2F0SE1F${"0".repeat(15)}3`;
      const fs = new MemoryFs({
        [P]: md(`name: 親\nnumber: 1\nsatisfied: false\nrequires:\n  - ${Q}\ncontains: []`),
        [Q]: md(`name: 子\nnumber: 2\nsatisfied: false\nrequires:\n  - ${R}\ncontains: []`, "メモ"),
        [R]: md("name: 孫\nnumber: 3\nsatisfied: false\nrequires: []\ncontains: []"),
      });
      const store = new MarkdownGraphStore(fs);
      const { graph } = await store.load();
      await store.persist(graph, Object.keys(graph.nodes));
      const original = { P: await fs.readNode(P), Q: await fs.readNode(Q) };
      expect(original.Q).toContain("# 孫"); // 陽性対照: コメントが付く形になっている

      const { undo } = await store.deleteNode(graph, Q);
      expect(await store.undoStructure(graph, undo)).toBe(true);
      expect(await fs.readNode(Q)).toBe(original.Q);
      expect(await fs.readNode(P)).toBe(original.P);
    });

    test("外すを戻すと親の参照が元に戻る。無い繋がりは切らず控えも返さない", async () => {
      const { fs, store, graph } = await setup();
      const undo = await store.detachEdge(graph, "A", "B");
      expect(undo).toBeDefined();
      expect(graph.nodes["A"]!.requires).toEqual([]);
      expect(await store.undoStructure(graph, undo!)).toBe(true);
      expect(parseNodeFile("A", await fs.readNode("A"), 0).node).toMatchObject({ requires: ["B"], contains: ["C"] });
      expect(await store.detachEdge(graph, "A", "無い")).toBeUndefined();
    });

    test("外で書き換わっていたら何も書かない", async () => {
      const { fs, store, graph } = await setup();
      const { undo } = await store.deleteNode(graph, "B");
      graph.nodes["A"]!.note = "外で書いた"; // 参照を外された側が、その後に書き換わった
      expect(await store.undoStructure(graph, undo)).toBe(false);
      expect(fs.files.has("B")).toBe(false);
      expect(graph.nodes["A"]!.requires).toEqual([]);
    });

    test("消している間に同じ番号が取られていたら、戻したノードの番号を振り直す", async () => {
      const { store, graph } = await setup();
      const { undo } = await store.deleteNode(graph, "B");
      const made = await store.createNode(graph, "新しく作った");
      made.number = 2; // 空いた番号を別のノードが持っている状態を作る
      expect(await store.undoStructure(graph, undo)).toBe(true);
      expect(graph.nodes["B"]!.number).not.toBe(2);
      expect(new Set(Object.values(graph.nodes).map((n) => n.number)).size).toBe(Object.keys(graph.nodes).length);
    });
  });
});

describe("自動解決（mtime の新しい方を正）", () => {
  /** 指定 mtime でグラフを作る小道具。
   *
   * mtime は**10秒以上**離して置く。許容幅（2秒）より近い差は「一括書き込みで
   * たまたま付いた順序」として同着扱いになるため、ここで秒未満の差を書くと
   * 「意図的に時間差がある」ことを表現できない。
   *
   * 番号を最初から入れておく。移行済みの vault を再現するためで、番号が無いと
   * 読み込み時に採番の書き戻しが走り、**わざわざ作った mtime の前後関係が
   * 消えてしまう**（自動解決はそこだけを見て判断している）。移行が1回きりの
   * 出来事であることは別のテストで固定してある。 */
  async function build(files: Record<string, { fm: string; mtime: number }>) {
    const fs = new MemoryFs();
    let n = 1;
    for (const [id, { fm, mtime }] of Object.entries(files)) {
      await fs.writeNode(id, md(`number: ${n}
${fm}`));
      n += 1;
      fs.touch(id, mtime);
    }
    const store = new MarkdownGraphStore(fs);
    const { graph } = await store.load();
    return { fs, store, graph };
  }

  test("親の方が新しい → 前提を埋める", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 20000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "satisfy-prerequisite", node: "A", prerequisite: "B" }]);
  });

  test("前提の方が新しい → 意図的な巻き戻しとみなして親を戻す", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 10000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 20000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "unsatisfy-node", node: "A", prerequisite: "B" }]);
  });

  test("contains の子の方が新しい → 親の達成を戻す", async () => {
    // これが出ていなかった間、「親が達成 / 子が未達」はどの画面にも現れなかった。
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires: []\ncontains:\n  - B", mtime: 10000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 20000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "unsatisfy-contains-parent", parent: "A", child: "B" }]);
    expect(plan.unresolved).toEqual([]);
  });

  test("contains の親の方が新しい → 到達した達成は残す（何も提案しない）", async () => {
    // 2026-08-26 の判断。**埋める向きは作らない**——親が満たされても部品が
    // 揃ったことにはならないので、子を勝手に達成にしてはいけない。
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires: []\ncontains:\n  - B", mtime: 20000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });

  test("contains の子と mtime 同着は解決せず残す", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires: []\ncontains:\n  - B", mtime: 50000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 50000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([]);
    expect(plan.unresolved).toEqual([{ kind: "mtime-tie", node: "A", prerequisite: "B" }]);
  });

  test("戻した親を立て直そうとしない（satisfy と unsatisfy が振動しない）", async () => {
    // 子が2つあり片方だけ未達。親を戻したあと「子が全部揃った」で立て直すと
    // 2026-09-02 と同じ振動になる。
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires: []\ncontains:\n  - B\n  - C", mtime: 10000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 30000 },
      C: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 20000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([{ kind: "unsatisfy-contains-parent", parent: "A", child: "B" }]);
    expect(plan.unresolved).toEqual([]);
  });

  test("mtime 同着は解決せず残す（git checkout 直後など）", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 50000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 50000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([]);
    expect(plan.unresolved).toEqual([{ kind: "mtime-tie", node: "A", prerequisite: "B" }]);
  });

  test("循環は自動解決せず残す（時刻では切れない）", async () => {
    const { graph } = await build({
      実績を作る: { fm: "satisfied: false\nrequires:\n  - 案件を取る\ncontains: []", mtime: 20000 },
      案件を取る: { fm: "satisfied: false\nrequires:\n  - 実績を作る\ncontains: []", mtime: 10000 },
    });
    const plan = planReconcile(graph);
    const cycle = plan.unresolved.find((u) => u.kind === "cycle");
    expect(cycle).toBeDefined();
  });

  test("リンク切れは空ノードを作って繋ぐ（情報を壊さない方向）", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: false\nrequires:\n  - 存在しない\ncontains: []", mtime: 10000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toContainEqual({ kind: "create-missing-node", id: "存在しない", referencedBy: ["A"] });
  });

  test("contains の子が全部揃った親は自動達成", async () => {
    const { graph } = await build({
      親: { fm: "satisfied: false\nrequires: []\ncontains:\n  - 子1\n  - 子2", mtime: 10000 },
      子1: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 20000 },
      子2: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 30000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toContainEqual({ kind: "satisfy-contains-parent", parent: "親" });
  });

  test("表記ゆれの重複は統合せず報告のみ", async () => {
    const { graph } = await build({
      "CI/CD": { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
      "ＣＩ／ＣＤ": { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
    });
    const plan = planReconcile(graph);
    const dup = plan.unresolved.find((u) => u.kind === "near-duplicate");
    expect(dup).toBeDefined();
    expect(normalizeForDuplicateCheck("手順書 作成")).toBe(normalizeForDuplicateCheck("手順書作成"));
  });

  test("適用すると矛盾が消え、ファイルにも書き戻される", async () => {
    const { fs, store, graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 20000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
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
      引っ越し: { fm: "satisfied: false\nrequires:\n  - 家\ncontains: []", mtime: 10000 },
      家: { fm: "satisfied: true\nrequires:\n  - 不動産に行く\ncontains: []", mtime: 90000 },
      不動産に行く: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 10000 },
    });
    // 解決前: 行ったはずの不動産が「今やれること」に残っている
    expect(resolveState(graph, "不動産に行く")).toBe("ACTIONABLE");
    await store.reconcile(graph, planReconcile(graph));
    expect(resolveState(graph, "不動産に行く")).toBe("SATISFIED");
    expect(resolveState(graph, "引っ越し")).toBe("ACTIONABLE");
  });

  test("親の前提が未達なら、子が揃っていても親を立てない", async () => {
    // カスケード（cascadeSatisfyContainsParents）と同じ条件でなければ、
    // 自動解決とアプリの操作が別のことを言い始める。
    const { graph } = await build({
      目的: { fm: "satisfied: false\nrequires:\n  - 手順書\ncontains:\n  - 部品A", mtime: 10000 },
      部品A: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 20000 },
      手順書: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 30000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes.filter((f) => f.kind === "satisfy-contains-parent")).toEqual([]);
  });

  test("規則どうしが逆を向いたら、提案せずに人へ返す", async () => {
    // 実データで、1つのノードについて「親を達成に」と「達成を戻す」が
    // 49組・99件並んだプランが出た（2026-09-02）。収束しないものは提案しない。
    const { graph } = await build({
      目的: { fm: "satisfied: true\nrequires:\n  - 手順書\ncontains:\n  - 部品A", mtime: 10000 },
      部品A: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 20000 },
      手順書: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 30000 },
    });
    const plan = planReconcile(graph);
    // 同じノードについての提案が積み上がらない
    const perNode = new Map<string, number>();
    for (const f of plan.fixes) {
      const id = "node" in f ? f.node : "parent" in f ? f.parent : "";
      perNode.set(id, (perNode.get(id) ?? 0) + 1);
    }
    for (const [, count] of perNode) expect(count).toBeLessThanOrEqual(1);
    expect(plan.fixes.length).toBeLessThan(5);
  });

  test("行ったり来たりするノードは判断が必要として残る", async () => {
    const { graph } = await build({
      目的: { fm: "satisfied: true\nrequires:\n  - 手順書\ncontains:\n  - 部品A", mtime: 10000 },
      部品A: { fm: "satisfied: true\nrequires: []\ncontains: []", mtime: 20000 },
      手順書: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 5000 },
    });
    const plan = planReconcile(graph);
    // 目的の方が新しいので前提を埋める側に倒れ、振動しない
    expect(plan.unresolved.filter((u) => u.kind === "oscillating")).toEqual([]);
    expect(plan.fixes.some((f) => f.kind === "satisfy-prerequisite")).toBe(true);
  });

  test("contains の輪も検出する（requires の輪とは別扱い）", async () => {
    // 検出しないと resolveState の保険ガードに落ちて、理由の出ない BLOCKED に
    // なる。「今やれることが空なのに理由が分からない」が一番まずい失敗の仕方。
    const { graph } = await build({
      A: { fm: "satisfied: false\nrequires: []\ncontains:\n  - B", mtime: 10000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains:\n  - A", mtime: 20000 },
    });
    const plan = planReconcile(graph);
    const found = plan.unresolved.filter((u) => u.kind === "contains-cycle");
    expect(found.length).toBe(1);
    const first = found[0]!;
    expect(first.kind === "contains-cycle" ? first.nodes.slice().sort() : []).toEqual(["A", "B"]);
    // requires の輪としては数えない（診断も直し方も違う）
    expect(plan.unresolved.filter((u) => u.kind === "cycle")).toEqual([]);
  });

  test("requires の輪は今までどおり cycle として出る", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: false\nrequires:\n  - B\ncontains: []", mtime: 10000 },
      B: { fm: "satisfied: false\nrequires:\n  - A\ncontains: []", mtime: 20000 },
    });
    const plan = planReconcile(graph);
    expect(plan.unresolved.filter((u) => u.kind === "cycle").length).toBe(1);
    expect(plan.unresolved.filter((u) => u.kind === "contains-cycle")).toEqual([]);
  });

  test("一括書き込みでできたミリ秒差は「判断できない」に落とす", async () => {
    // ファイルは1件ずつ書かれるので、一括書き込み（番号の移行 / git clone /
    // AI のまとめ書き）でも全ファイルが別々の mtime を持つ。実測で最小差 2ms、
    // 順序は書き込みループ順＝ULID順で、人が触った順とは無関係だった。
    // 完全一致だけを同着とすると、この「もっともらしい嘘の順序」を最新の意図
    // として読み、でたらめな方向に倒れる。
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 100_002 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 100_000 },
    });
    const plan = planReconcile(graph);
    expect(plan.fixes).toEqual([]);
    expect(plan.unresolved.filter((u) => u.kind === "mtime-tie").length).toBe(1);
  });

  test("一括書き込みの幅（実測 411ms）を超えても、まだ判断しない", async () => {
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 100_411 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 100_000 },
    });
    expect(planReconcile(graph).fixes).toEqual([]);
  });

  test("2秒以上離れていれば今までどおり倒れる", async () => {
    // 人が手で2つのファイルを触る間隔はここに収まらないので、機械の一括書き込みと
    // 人の操作がきれいに分かれる。
    const { graph } = await build({
      A: { fm: "satisfied: true\nrequires:\n  - B\ncontains: []", mtime: 103_000 },
      B: { fm: "satisfied: false\nrequires: []\ncontains: []", mtime: 100_000 },
    });
    expect(planReconcile(graph).fixes).toEqual([{ kind: "satisfy-prerequisite", node: "A", prerequisite: "B" }]);
  });
});

describe("番号（#12）", () => {
  const md2 = (fm: string) => `---\n${fm}\n---\n`;
  const ulids = ["01M0AAA0000000000000000001", "01M0AAA0000000000000000002", "01M0AAA0000000000000000003"];

  async function load(files: Record<string, string>) {
    const fs = new MemoryFs(files);
    const store = new MarkdownGraphStore(fs);
    const { graph, issues } = await store.load();
    return { fs, store, graph, issues };
  }

  test("番号の無い vault は読み込みで作成順（ULID 昇順）に振られ、ファイルにも書かれる", async () => {
    const { fs, graph } = await load({
      [ulids[2]!]: md2("name: 三番目\nsatisfied: false\nrequires: []\ncontains: []"),
      [ulids[0]!]: md2("name: 一番目\nsatisfied: false\nrequires: []\ncontains: []"),
      [ulids[1]!]: md2("name: 二番目\nsatisfied: false\nrequires: []\ncontains: []"),
    });
    expect(graph.nodes[ulids[0]!]!.number).toBe(1);
    expect(graph.nodes[ulids[1]!]!.number).toBe(2);
    expect(graph.nodes[ulids[2]!]!.number).toBe(3);
    // 書き戻されるので、次に開いても同じ番号を指す
    expect(fs.files.get(ulids[0]!)!.content).toContain("number: 1");
  });

  test("既にある番号は動かさず、空いている分だけ続きから振る", async () => {
    // 番号の価値は「安定して同じものを指す」ことに尽きる。既に口に出された
    // 番号が別物を指し始めるのが一番まずい。
    const { graph } = await load({
      [ulids[0]!]: md2("name: 既存\nnumber: 7\nsatisfied: false\nrequires: []\ncontains: []"),
      [ulids[1]!]: md2("name: 新入り\nsatisfied: false\nrequires: []\ncontains: []"),
    });
    expect(graph.nodes[ulids[0]!]!.number).toBe(7);
    expect(graph.nodes[ulids[1]!]!.number).toBe(8);
  });

  test("重複したら後から作られた方を振り直し、報告する", async () => {
    // 番号はファイル名ではないので、2台で同時に作ると git は衝突を検出できない
    // （別ファイルの中身が違うだけになる）。静かに壊れないよう自分で拾う。
    const { graph, issues } = await load({
      [ulids[0]!]: md2("name: 先に振られた\nnumber: 3\nsatisfied: false\nrequires: []\ncontains: []"),
      [ulids[1]!]: md2("name: 後から来た\nnumber: 3\nsatisfied: false\nrequires: []\ncontains: []"),
    });
    expect(graph.nodes[ulids[0]!]!.number).toBe(3); // 先勝ち。動かさない
    expect(graph.nodes[ulids[1]!]!.number).toBe(4);
    expect(issues.some((i) => i.problems.some((p) => p.includes("重複")))).toBe(true);
  });

  test("移行は1回きり。2回目の読み込みでは何も書かない", async () => {
    // 採番の書き戻しは全ファイルの mtime を動かすので、自動解決が見ている
    // 前後関係が消える。1回きりであることを固定しておく。
    const { fs, store } = await load({
      [ulids[0]!]: md2("name: A\nsatisfied: false\nrequires: []\ncontains: []"),
    });
    const after = fs.files.get(ulids[0]!)!.mtimeMs;
    await store.load();
    expect(fs.files.get(ulids[0]!)!.mtimeMs).toBe(after);
  });

  test("新しく作ったノードには最初から番号が付く", async () => {
    const { store, graph } = await load({
      [ulids[0]!]: md2("name: A\nnumber: 5\nsatisfied: false\nrequires: []\ncontains: []"),
    });
    const node = await store.createNode(graph, "B");
    expect(node.number).toBe(6);
  });

  test("番号は往復で保たれる", () => {
    const { node } = parseNodeFile("A", md("name: A\nnumber: 12\nsatisfied: false\nrequires: []\ncontains: []"), 0);
    expect(node.number).toBe(12);
    expect(serializeNodeFile(node)).toContain("number: 12");
  });
});
