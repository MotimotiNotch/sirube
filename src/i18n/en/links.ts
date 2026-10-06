// 英語。キーと引数の形は ../ja/links.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { links as Ja } from "../ja/links.ts";

export const links: Shape<typeof Ja> = {
  openFailed: (href) => `Couldn't open the link: ${href}`,
};
