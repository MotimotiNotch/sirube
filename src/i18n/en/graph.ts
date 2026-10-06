// 英語。キーと引数の形は ../ja/graph.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { graph as Ja } from "../ja/graph.ts";

export const graph: Shape<typeof Ja> = {
  notFound: "Node not found",
  betweenTip: (n) => `${n === 1 ? "1 node" : `${n} nodes`} between these two (folded on the map)`,
  insertBetween: (from, to) => `Insert between ${from} and ${to}`,
  labelGoalsAhead: "Goals further ahead",
  labelRequires: "Needs this (prerequisite)",
  labelContains: "Made of this (part)",
  ringEndless: (done, total) => `${done} done below / ${total} total`,
  ring: (done, total) => `${done}/${total} below`,
  mergeMap: (n) => (n === 1 ? "1 goal passes through here" : `${n} goals pass through here`),
  mergeDetail: (n) => `Needed from ${n} places (finishing it moves ${n} forward)`,
  noGoals: "No goals on the map yet.",
  oneGoal: 'Only one goal is on the map. Switch to "Graph" to break it down.',
  noChildren: 'This node has nothing below it yet. Add what it needs from "Break down" in the right panel.',
  resetView: "Reset view",
};
