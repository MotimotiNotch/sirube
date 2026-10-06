// 英語。キーと引数の形は ../ja/common.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { common as Ja } from "../ja/common.ts";

export const common: Shape<typeof Ja> = {
  cancel: "Cancel",
  close: "Close",
  add: "Add",
  keep: "Leave as is",
  detach: "Detach",
};
