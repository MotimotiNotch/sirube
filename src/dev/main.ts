// 開発時のエントリポイント。
//
// dev サーバ越しに**実物の `vault/nodes/*.md`** を読み書きする。Tauri シェルが
// できたら、ここが `TauriFs` を渡すだけの薄い入口に置き換わる（`SirubeFs` を
// 実装していれば差し替えは1行なので、UI もエンジンも一切変わらない）。

import { startApp } from "../ui/app.ts";
import { HttpFs } from "./http-fs.ts";

await startApp(new HttpFs());
