// リリースビルド。`bun run release` の実体。
//
// なぜ package.json に直接コマンドを書かないか:
//   "release": "cmd //c \"scripts/with-msvc.bat bunx tauri build\" && ..."
// と書いていた時期があるが、これは *静かに何もせず成功する*。cmd がバナーを
// 出して即終了し、tauri build が走らないまま次の && へ進むため、既にある古い
// インストーラの情報が表示されて成功したように見える（2026-08-31 に踏んだ）。
// 引数を配列で渡せばクォートの解釈が挟まらないので、spawn で組み立てる。
//
// with-msvc.bat を経由する理由は scripts/msvc-env.sh のコメントを参照。

import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";

const run = (argv: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { stdio: "inherit", windowsVerbatimArguments: false });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${argv.join(" ")} が終了コード ${code} で失敗しました`)),
    );
  });

if (process.platform !== "win32") {
  console.error("リリースビルドは Windows 前提です（MSVC ツールチェーンが要る）。");
  process.exit(1);
}

// バックスラッシュは文字列リテラルのエスケープ事故を起こすので、パスは join で組む。
const bat = join(import.meta.dir, "with-msvc.bat");

// 第三者のライセンス表記を焼き直してから包む。依存を足した次のリリースで一覧が
// 古いまま配られるのを防ぐ（中身は scripts/gen-licenses.ts）。
await run([process.execPath, "run", "scripts/gen-licenses.ts"]);

await run(["cmd", "/c", bat, "bunx", "tauri", "build"]);
await run([process.execPath, "run", "scripts/show-release.ts"]);

// 焼き直しで変わっていたら、コミットし忘れを知らせる（配ったものとリポジトリの版がずれる）。
const changed = spawnSync("git", ["status", "--porcelain", "--", "licenses"], { encoding: "utf8" }).stdout.trim();
if (changed) {
  console.warn(`\nlicenses/ が焼き直しで変わりました。リリースのコミットに含めてください:\n${changed}\n`);
}
