// 焼き込んだ `AGENTS.md` が古くなっていないかの見張り。
//
// 「一次情報が他所にあるなら道標だけ置く」の例外がここで、**エージェント向けの
// 仕様書だけは vault にも実物が要る**（インストーラで入れた人の手元には
// リポジトリが無い）。実物を持つ以上、ずれる経路ができるので、ずれたら落とす。

import { expect, test } from "bun:test";
import { AGENTS_DOC } from "./agents-doc.ts";
import { renderMocs, AGENTS_DOC_PATH } from "./moc.ts";
import { buildReverseIndex, analyzeCycles } from "./engine.ts";
import { newGraph } from "./model.ts";

test("焼き込んだ AGENTS.md がリポジトリのものと一致する", async () => {
  // ずれていたら `bun run agents-doc` を実行する。
  const source = (await Bun.file("AGENTS.md").text()).replace(/\r\n/g, "\n");
  expect(AGENTS_DOC).toBe(source);
});

test("vault に AGENTS.md を書き出す", () => {
  // ノードが1つも無くても出す。**空の vault を開いた直後のエージェントが
  // 一番仕様書を必要としている**（何を書けばいいか分からない状態なので）。
  const graph = newGraph();
  const docs = renderMocs(graph, buildReverseIndex(graph), analyzeCycles(graph));
  const doc = docs.find((d) => d.path === AGENTS_DOC_PATH);
  expect(doc).toBeTruthy();
  expect(doc!.content).toContain("自動生成します");
  expect(doc!.content).toContain("requires` と `contains` の判別");
});
