// 英語。キーと引数の形は ../ja/list.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { list as Ja } from "../ja/list.ts";

export const list: Shape<typeof Ja> = {
  colNumber: "No.",
  colName: "Name",
  colGoal: "Goal",
  colState: "State",
  colUpdated: "Updated",
  colShared: "Shared",
  colDue: "Due",
  sortBy: (label) => `Sort by ${label}`,
  count: (n) => (n === 1 ? "1 node" : `${n} nodes`),
  noMatch: "No matching nodes.",
  noRecent: "No nodes have changed yet.",
  noneReadyCycle: "Nothing is ready. Untangle the wait above and things will start moving.",
  noneReady: "Nothing is ready.",
  under: (crumb) => `Under ${crumb}`,
  sharedTitle: (n) => `Needed from ${n} places (finishing it moves several forward)`,
  sharedBadge: (n) => `Shared ${n}`,
  dueFrom: (from) => `Due in time for “${from}”`,
  due: "Due date",
  updated: (dateTime) => `Updated ${dateTime}`,
  needs: "Needs",
  waitingOnThis: "Waiting on this",
  parts: "Parts",
  partOf: "Part of",
  cycleTitle: "One of the nodes in this wait may really be two",
  split: "Split",
  cycleWhy: "Why do nodes end up waiting on each other?",
  cycleWhyBody:
    "When nodes wait on each other in a loop, it's a sign that one name is holding two different things. Split one of them and the directions line up, untangling the loop.",
};
