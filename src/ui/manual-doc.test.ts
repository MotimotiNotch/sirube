// 焼き込んだマニュアルが古くなっていないかの見張り（`agents-doc.test.ts` と同じ形）。

import { expect, test } from "bun:test";
import { MANUAL_DOC } from "./manual-doc.ts";

test("焼き込んだマニュアルが docs/manual.md と一致する", async () => {
  // ずれていたら `bun run manual-doc` を実行する。
  const source = (await Bun.file("docs/manual.md").text()).replace(/\r\n/g, "\n");
  expect(MANUAL_DOC).toBe(source);
});
