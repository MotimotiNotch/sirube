// 英語。キーと引数の形は ../ja/store.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { store as Ja } from "../ja/store.ts";

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const store: Shape<typeof Ja> = {
  unreadable: "Couldn't read the file.",
  renumbered: (number, owner) => `Number #${number} was also used by “${owner}”, so it was renumbered.`,
  nameClash: (name) => `That would have the same name as “${name}”.`,
  mintFailed: (attempts, detail) => `Couldn't assign a node id after ${plural(attempts, "try", "tries")}${detail}`,
  undoDelete: (name) => `deleting “${name}”`,
  undoDetach: (parent, child) => `detaching “${child}” from “${parent}”`,
  undoShortcuts: (n) => `removing ${plural(n, "shortcut", "shortcuts")}`,
  linkGone: "That link no longer exists.",
  nameRequired: "Enter a name.",
  ambiguousRef: (ref, n) => `Can't resolve “${ref}”: ${plural(n, "node matches", "nodes match")} it.`,
  notUlidFileName: (name) => `The file name isn't in id format (the name “${name}” is written separately).`,
};
