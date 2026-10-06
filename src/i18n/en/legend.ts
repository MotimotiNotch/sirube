// 英語。キーと引数の形は ../ja/legend.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { legend as Ja } from "../ja/legend.ts";

export const legend: Shape<typeof Ja> = {
  goalsAhead: "Goals further ahead",
  betweenCount: "The number on a line is how many nodes are folded in between",
  requires: "Needs this (prerequisite)",
  contains: "Made of this (part)",
  ring: "Progress of what's below",
  mergeMap: "How many goals pass through here",
  mergeDetail: "How many places need this",
  button: "Legend",
};
