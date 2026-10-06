// 英語。キーと引数の形は ../ja/dom.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { dom as Ja } from "../ja/dom.ts";

export const dom: Shape<typeof Ja> = {
  stateSatisfied: "Done",
  stateActionable: "Ready",
  stateBlocked: "Waiting",
  stateCyclic: "Cycle",
  colorYellow: "Yellow",
  colorOrange: "Orange",
  colorPink: "Pink",
  colorPurple: "Purple",
  colorBlue: "Blue",
  colorGreen: "Green",
};
