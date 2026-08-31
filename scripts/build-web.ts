// 本番用のフロントを `dist/` に書き出す。Tauri の `frontendDist` がここを見る。
//
// dev サーバは毎リクエストでバンドルしていたが、配布物にサーバは無いので
// 静的ファイルとして焼く。エントリは `src/tauri/main.ts`（Tauri の fs を使う版）。

import { mkdir, rm, writeFile } from "node:fs/promises";

const OUT = "dist";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const built = await Bun.build({
  entrypoints: ["./src/tauri/main.ts"],
  target: "browser",
  minify: true,
});
if (!built.success) {
  console.error(built.logs.map(String).join("\n"));
  process.exit(1);
}

await writeFile(`${OUT}/app.js`, await built.outputs[0]!.text(), "utf8");
await writeFile(`${OUT}/style.css`, await Bun.file("./src/ui/style.css").text(), "utf8");
await writeFile(`${OUT}/index.html`, await Bun.file("./index.html").text(), "utf8");

const size = (await Bun.file(`${OUT}/app.js`).arrayBuffer()).byteLength;
console.log(`dist/ を書き出しました（app.js ${(size / 1024).toFixed(1)} KB）`);
