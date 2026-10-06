// 開発時のエントリポイント。
//
// dev サーバ越しに**実物の `vault/nodes/*.md`** を読み書きする。Tauri シェルが
// できたら、ここが `TauriFs` を渡すだけの薄い入口に置き換わる（`SirubeFs` を
// 実装していれば差し替えは1行なので、UI もエンジンも一切変わらない）。
//
// 別窓はブラウザの別窓で開く（起動引数の形は Tauri 版と同じ `window-query.ts`）。
// dev サーバにはファイル監視が無いので、窓どうしは再読み込みするまで追いつかない。

import { startApp } from "../ui/app.ts";
import { buildWindowQuery, parseWindowQuery } from "../ui/window-query.ts";
import { HttpFs } from "./http-fs.ts";
import { initTheme } from "../ui/theme.ts";

initTheme(); // vault を読む前に（読み込み中ずっとライトで光らないように）
const query = parseWindowQuery(location.search);
await startApp(new HttpFs(), {
  openWindow: (target) => {
    window.open(`${location.pathname}${buildWindowQuery(target)}`, "_blank", "width=1100,height=760");
  },
  ...(query.sub ? { sub: query.initial ? { initial: query.initial } : {} } : {}),
});
