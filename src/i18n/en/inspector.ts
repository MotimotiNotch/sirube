// 英語。キーと引数の形は ../ja/inspector.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { inspector as Ja } from "../ja/inspector.ts";

export const inspector: Shape<typeof Ja> = {
  empty: "Select a node to see it here.",
  rename: "Rename",
  numberTitle: "This node's number",
  ownDue: (date) => `. Its own due date is ${date}`,
  dueBadge: (date) => `Due ${date}`,
  dueFrom: (from, own) => `In time for “${from}”${own}`,
  endlessTitle: "This is a never-ending goal (a root taken off the map), so no percentage is shown.",
  endlessProgress: (done, total) => `${done} done / ${total} total`,
  unmarkDone: "Mark as not done",
  markDone: "Mark as done",
  breakDown: "Break down",
  cycleTitle: "These nodes are waiting on each other",
  cycleHint:
    'Splitting this node in two can untangle the wait (e.g. "Get a contract" → "Small contract" and "Large contract"). Add the split parts from "Break down".',
  more: "More",
  due: "Due date",
  clearDue: "Clear due date",
  dueNoteInherited: (from, date) =>
    `A due date (${date}) comes down from “${from}”. Only set one here if an earlier date has been fixed from outside.`,
  dueNoteOwn: "This due date also passes down to what this node needs (prerequisites and parts).",
  dueNoteNone:
    "Only set this when the date is fixed from outside (a filing, a contract renewal, etc.). It also passes down to what this node needs. Sirube won't nag you as it approaches.",
  goal: "Goal",
  hideFromMap: "Remove from map",
  showOnMap: "Show on map",
  goalNoteRing:
    "Nothing outside the cycle needs it, so this one, created first in the cycle, shows as a goal. A cycle means something needs more breaking down; split it and the root sorts itself out.",
  goalNoteAuto:
    "Nothing needs this, so it's a goal without being marked. Removing it takes it off the map. If something below should stay on the map, show that first.",
  goalNoteOn: "On the map. The path up to here is folded, and only the count in between stays on the line.",
  goalNoteOffAuto: "Taken off the map. The structure is unchanged; it just doesn't appear on the map or as an entry point.",
  goalNoteOff: "Press to show this on the map. The structure doesn't change (state and progress stay the same).",
  colorTag: "Color tag",
  noColor: "None",
  linkHead: (title, count) => `${title} (${count})`,
  missing: (id) => `${id} (not created)`,
  waitingOnThis: "Waiting on this",
  partOf: "Part of",
  note: "Note",
  viewMode: "View",
  editMode: "Edit",
  notePlaceholder: "Notes about this node",
  noNote: 'No note yet. Use "Edit" to write one.',
  created: (date) => `Created ${date}`,
  updated: (date) => `Updated ${date}`,
  deleteNode: "Delete this node",
  deleteConfirm: (name) => `Delete “${name}”? Right after, you can bring it back with “Undo” in the header.`,
  nameSep: ", ",
  deleteOrphans: (count, names) =>
    `${count === 1 ? "1 node" : `${count} nodes`} (${names}) will appear in the list as ${count === 1 ? "a goal" : "goals"}.`,
  deleteYes: "Delete",
  deleteNo: "Cancel",
};
