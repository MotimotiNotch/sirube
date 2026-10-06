// 英語。キーと引数の形は ../ja/tutorial.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { tutorial as Ja } from "../ja/tutorial.ts";

const nodes = (n: number): string => (n === 1 ? "1 node" : `${n} nodes`);

export const tutorial: Shape<typeof Ja> = {
  ariaLabel: "Tutorial",
  title: "Help",
  cleanupCount: "Clean up",
  finished: "Tutorial finished. You can run it again anytime from Help in the header.",
  goal: "Use the + next to Goals on the left to create something you want to achieve. Example: Move house (your own goal is fine too).",
  selectGoal: (goal) => `First, select “${goal}”.`,
  requires: (goal) =>
    `In Break down on the right, open the Prerequisites tab and write what “${goal}” needs. Example: Finish packing. Once it has a prerequisite, “${goal}” becomes waiting.`,
  selectPrereq: (prereq) => `Next, select “${prereq}”.`,
  contains: (prereq) =>
    `In Break down, open the Parts tab and write what “${prereq}” is made of. Example: Pack the books, Pack the clothes (one per line). A prerequisite still leaves work for you once it's in place; parts are done as soon as they're all done.`,
  selectLeaf: (leaf) => `Select the part “${leaf}”.`,
  achieve: (prereq, goal) =>
    `Press Mark as done on the right. When all its parts are done, “${prereq}” is done automatically, and “${goal}” becomes ready.`,
  deleteSelect: (goal, leaf) =>
    `“${goal}” is now ready. Break down from the goal, then clear things from the ends — that's all there is to it. Finally, let's clean up. Select the part “${leaf}”.`,
  delete: "Delete it with More → Delete this node at the bottom right. Right after, Undo in the header brings it back.",
  cleanup: (finished, names) =>
    `Delete ${finished ? `the remaining ${nodes(names.length)}` : `the ${nodes(names.length)} made in the tutorial`} (${names.join(", ")}) too? Keep them if you wrote your own goal.`,
  deleteAll: "Delete all",
  deleted: (n) => `Deleted ${nodes(n)}. You can run the tutorial again anytime from Help in the header.`,
  keep: "Keep",
  kept: "Kept them. You can run the tutorial again anytime from Help in the header.",
  skip: "Skip",
};
