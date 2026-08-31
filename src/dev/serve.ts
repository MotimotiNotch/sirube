// 開発用サーバ。**製品にはサーバは無い**（Tauri が WebView を直接開く）。
// ここは Tauri のツールチェーンが入るまでの足場で、
//   - TS をバンドルして返す
//   - `<vault>/nodes/*.md` を読み書きする API を出す
// の2つだけをやる。
//
// 起動:
//   bun run dev                    → ./vault を使う（無ければサンプルを書き出す）
//   bun run dev -- <vaultのパス>   → 任意のフォルダを使う
//
// バインドは 127.0.0.1 限定。ローカルのファイルを触る口を LAN に晒さない。

import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SAMPLE_MARKDOWN } from "./sample.ts";

const PORT = 5177;
const EXT = ".md";

const vaultRoot = resolve(process.argv[2] ?? "./vault");
const nodesDir = join(vaultRoot, "nodes");

async function ensureVault(): Promise<void> {
  await mkdir(nodesDir, { recursive: true });
  const existing = await readdir(nodesDir);
  if (existing.some((f) => f.endsWith(EXT))) return;
  // 空なら、壁打ちで使ったサンプル（Sirube 自身のタスク ＋ 鶏卵問題）を書き出す。
  for (const [id, content] of Object.entries(SAMPLE_MARKDOWN)) {
    await writeFile(join(nodesDir, `${id}${EXT}`), content, "utf8");
  }
  console.log(`サンプルを書き出しました: ${nodesDir}`);
}

/** ノード id → 絶対パス。区切り文字を含む id は弾く（ディレクトリ横断を防ぐ）。 */
function nodePath(id: string): string {
  if (id.includes("/") || id.includes("\\") || id.includes("..")) throw new Error("invalid node id");
  return join(nodesDir, `${id}${EXT}`);
}

async function mtimeOf(id: string): Promise<number> {
  try {
    return (await stat(nodePath(id))).mtimeMs;
  } catch {
    return 0;
  }
}

async function bundle(): Promise<string> {
  const built = await Bun.build({
    entrypoints: ["./src/dev/main.ts"],
    target: "browser",
    sourcemap: "inline",
  });
  if (!built.success) {
    const msg = built.logs.map(String).join("\n");
    console.error(msg);
    return `document.body.innerHTML = ${JSON.stringify(`<pre style="padding:24px;color:#b3261e;white-space:pre-wrap">${msg}</pre>`)};`;
  }
  return await built.outputs[0]!.text();
}

const noStore = (type: string): Record<string, string> => ({
  "content-type": type,
  "cache-control": "no-store",
});

await ensureVault();

const server = Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);

    try {
      if (path === "/api/nodes") {
        const files = (await readdir(nodesDir)).filter((f) => f.endsWith(EXT));
        const entries = await Promise.all(
          files.map(async (f) => {
            const id = f.slice(0, -EXT.length);
            return { id, mtimeMs: await mtimeOf(id) };
          }),
        );
        return Response.json(entries, { headers: noStore("application/json") });
      }

      if (path.startsWith("/api/stat/")) {
        return Response.json({ mtimeMs: await mtimeOf(path.slice("/api/stat/".length)) });
      }

      if (path.startsWith("/api/node/")) {
        const id = path.slice("/api/node/".length);
        if (req.method === "GET") {
          return new Response(await readFile(nodePath(id), "utf8"), { headers: noStore("text/plain; charset=utf-8") });
        }
        if (req.method === "PUT") {
          await writeFile(nodePath(id), await req.text(), "utf8");
          return new Response("ok");
        }
        if (req.method === "DELETE") {
          await unlink(nodePath(id));
          return new Response("ok");
        }
      }

      if (path === "/app.js") return new Response(await bundle(), { headers: noStore("text/javascript; charset=utf-8") });
      if (path === "/style.css") return new Response(Bun.file("./src/ui/style.css"), { headers: noStore("text/css; charset=utf-8") });
      return new Response(Bun.file("./index.html"), { headers: noStore("text/html; charset=utf-8") });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("ENOENT") ? 404 : 400;
      return new Response(message, { status });
    }
  },
});

console.log(`Sirube (dev): http://127.0.0.1:${server.port}`);
console.log(`データ: ${nodesDir}`);
