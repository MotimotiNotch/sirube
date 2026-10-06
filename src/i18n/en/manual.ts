// 英語。キーと引数の形は ../ja/manual.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { manual as Ja } from "../ja/manual.ts";

export const manual: Shape<typeof Ja> = {
  tourAgain: "Take the tutorial again",
  openWindow: "Open in new window",
  toc: "Contents",
};
