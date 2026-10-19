// Web デモを `dist-demo/` に書き出す。Cloudflare Workers の静的配信（`wrangler.demo.jsonc`）がここを配る。
//
// build-web.ts と同じ組み立てで、エントリだけ `src/demo/main.ts`（メモリ上のサンプル）に替える。
// サーバのコードは無い。配るのは静的ファイルだけ。

import { mkdir, rm, writeFile } from "node:fs/promises";

const OUT = "dist-demo";

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const [entry, out, format] of [
  ["./src/demo/main.ts", "app.js", "esm"],
  // 起動直後のテーマ（index.html の <head> で同期に読む）。
  ["./src/ui/theme-boot.ts", "theme-boot.js", "iife"],
] as const) {
  const built = await Bun.build({ entrypoints: [entry], target: "browser", format, minify: true });
  if (!built.success) {
    console.error(built.logs.map(String).join("\n"));
    process.exit(1);
  }
  await writeFile(`${OUT}/${out}`, await built.outputs[0]!.text(), "utf8");
}

await writeFile(`${OUT}/style.css`, await Bun.file("./src/ui/style.css").text(), "utf8");
await writeFile(`${OUT}/index.html`, await Bun.file("./index.html").text(), "utf8");

// 外へ出す唯一の面なので、読み込み元を自分自身に絞る。インラインのスクリプトは無い。
await writeFile(
  `${OUT}/_headers`,
  [
    "/*",
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "  X-Content-Type-Options: nosniff",
    "  Referrer-Policy: no-referrer",
    "",
  ].join("\n"),
  "utf8",
);

const size = (await Bun.file(`${OUT}/app.js`).arrayBuffer()).byteLength;
console.log(`dist-demo/ を書き出しました（app.js ${(size / 1024).toFixed(1)} KB）`);
