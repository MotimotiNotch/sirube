// 英語。キーと引数の形は ../ja/reconcile.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { reconcile as Ja } from "../ja/reconcile.ts";

const issues = (n: number): string => (n === 1 ? "1 issue" : `${n} issues`);

export const reconcile: Shape<typeof Ja> = {
  summary: (fixed, unresolved) => {
    if (fixed === 0 && unresolved === 0) return "No inconsistencies found.";
    const parts: string[] = [];
    if (fixed > 0) parts.push(`Auto-fixed ${issues(fixed)}.`);
    if (unresolved > 0) parts.push(`Left ${issues(unresolved)} that need${unresolved === 1 ? "s" : ""} your call.`);
    return parts.join(" ");
  },
};
