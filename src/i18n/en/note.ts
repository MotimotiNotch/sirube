// 英語。キーと引数の形は ../ja/note.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { note as Ja } from "../ja/note.ts";

export const note: Shape<typeof Ja> = {
};
