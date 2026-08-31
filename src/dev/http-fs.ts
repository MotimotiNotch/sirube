// 開発用。dev サーバ越しに**実物の Markdown ファイル**を読み書きする `SirubeFs`。
//
// 製品構成にサーバは無い（Tauri が WebView からネイティブ fs を直接叩く）。
// これは Tauri のツールチェーンが入るまでの足場だが、`MemoryFs` と違って
// 本物の `nodes/*.md` を相手にするので、git diff の形も Obsidian で開いた
// 見え方も、今この場で確かめられる。
//
// `TauriFs` と同じ `SirubeFs` を実装しているので、差し替えは1行で済む。

import type { NodeFileEntry, SirubeFs } from "../store/fs.ts";

export class HttpFs implements SirubeFs {
  constructor(private readonly base = "/api") {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, init);
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async listNodes(): Promise<NodeFileEntry[]> {
    return this.json<NodeFileEntry[]>("/nodes");
  }

  async readNode(id: string): Promise<string> {
    const res = await fetch(`${this.base}/node/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`read failed: ${id}`);
    return res.text();
  }

  async writeNode(id: string, content: string): Promise<void> {
    const res = await fetch(`${this.base}/node/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: content,
    });
    if (!res.ok) throw new Error(`write failed: ${id}`);
  }

  async deleteNode(id: string): Promise<void> {
    const res = await fetch(`${this.base}/node/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`delete failed: ${id}`);
  }

  async statNode(id: string): Promise<number> {
    const { mtimeMs } = await this.json<{ mtimeMs: number }>(`/stat/${encodeURIComponent(id)}`);
    return mtimeMs;
  }
}
