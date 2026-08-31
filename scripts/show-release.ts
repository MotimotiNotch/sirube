// ビルド後に、配布用インストーラの場所とサイズを出すだけの小道具。
// 毎回 target/release/bundle/... を思い出すのが面倒なので。

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const dir = "src-tauri/target/release/bundle/nsis";
try {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".exe"));
  if (files.length === 0) throw new Error("インストーラが見つかりません");
  for (const f of files) {
    const { size, mtime } = await stat(join(dir, f));
    console.log(`\n配布用インストーラ:\n  ${join(process.cwd(), dir, f)}\n  ${(size / 1048576).toFixed(1)} MB  (${mtime.toLocaleString("ja-JP")})\n`);
    console.log("友人に渡すときは、初回起動で");
    console.log("  「WindowsによってPCが保護されました」→ [詳細情報] → [実行]");
    console.log("と出ることを先に伝えておくこと（未署名バイナリのため）。\n");
  }
} catch (err) {
  console.error(`${dir} を読めませんでした: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
