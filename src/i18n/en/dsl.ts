// 英語。キーと引数の形は ../ja/dsl.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { dsl as Ja } from "../ja/dsl.ts";

export const dsl: Shape<typeof Ja> = {
  nameAfterBracket: "A node name is needed after '['.",
  nameAtStart: "A line must start with a node name.",
  nameOrBracketAfterArrow: "A node name or '[' is needed after '->'.",
  unclosedBracket: "']' is missing.",
  empty: "The input is empty.",
  nameAfterComma: "A node name is needed after ','.",
  unexpectedToken: (token) => `Unexpected '${token}'.`,
};
