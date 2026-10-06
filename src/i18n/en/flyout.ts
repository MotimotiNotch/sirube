// 英語。キーと引数の形は ../ja/flyout.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { flyout as Ja } from "../ja/flyout.ts";

export const flyout: Shape<typeof Ja> = {
  depth: (n) => (n === 1 ? "1 level down" : `${n} levels down`),
  repeat: "Seen above",
  head: "What's below (click to jump straight there)",
  countEndless: (done, total) => `${done} done / ${total} total`,
};
