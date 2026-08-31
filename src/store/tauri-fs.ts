// Tauri 上でのファイルアクセス。`SirubeFs` の実装。
//
// 製品構成にはサーバが無い。UI もエンジンもストアも WebView の中で動き、
// ファイル操作だけがここを通ってネイティブ側へ抜ける。`SirubeFs` という
// 1インターフェースに閉じてあるおかげで、エンジンや DSL は一切 Tauri を知らない。
//
// 対象は `<vault>/nodes/*.md` だけ。設定は `<vault>/.sirube/` に置く想定。

import { mkdir, readDir, readTextFile, remove, stat, watch, writeTextFile, type UnwatchFn } from "@tauri-apps/plugin-fs";
import type { NodeFileEntry, SirubeFs } from "./fs.ts";

const NODES_DIR = "nodes";
const EXT = ".md";

/** ノード id → ファイルパス。id はファイル名そのものなので加工しない。
 *
 * 区切り文字だけは弾く。日本語や記号を含む任意の名前を id にできることが
 * この設計の要点なので、スラグ化はしない（区別がつかなくなる）。 */
function nodePath(vault: string, id: string): string {
  if (id.includes("/") || id.includes("\\") || id.includes("..")) {
    throw new Error(`ノード名にパス区切りは使えません: ${id}`);
  }
  return `${vault}/${NODES_DIR}/${id}${EXT}`;
}

export class TauriFs implements SirubeFs {
  constructor(private readonly vaultPath: string) {}

  /** `<vault>/nodes/` が無ければ作る。初回起動時用。 */
  async ensureLayout(): Promise<void> {
    await mkdir(`${this.vaultPath}/${NODES_DIR}`, { recursive: true });
    await mkdir(`${this.vaultPath}/.sirube`, { recursive: true });
  }

  async listNodes(): Promise<NodeFileEntry[]> {
    const dir = `${this.vaultPath}/${NODES_DIR}`;
    const entries = await readDir(dir);
    const out: NodeFileEntry[] = [];
    for (const e of entries) {
      if (e.isDirectory || !e.name.endsWith(EXT)) continue;
      const id = e.name.slice(0, -EXT.length);
      out.push({ id, mtimeMs: await this.statNode(id) });
    }
    return out;
  }

  async readNode(id: string): Promise<string> {
    return readTextFile(nodePath(this.vaultPath, id));
  }

  async writeNode(id: string, content: string): Promise<void> {
    await writeTextFile(nodePath(this.vaultPath, id), content);
  }

  async deleteNode(id: string): Promise<void> {
    await remove(nodePath(this.vaultPath, id));
  }

  async statNode(id: string): Promise<number> {
    try {
      const info = await stat(nodePath(this.vaultPath, id));
      // mtime が取れない環境（一部のネットワークドライブ等）では 0 を返す。
      // 自動解決はそのとき「同着」として判断を人に返すので、壊れはしない。
      return info.mtime ? info.mtime.getTime() : 0;
    } catch {
      return 0;
    }
  }

  /**
   * `nodes/` を監視して、外部からの変更を通知する。
   *
   * これは Markdown + Git を選んだ時点で必須になった機能。入口が増える
   * （エディタ・Obsidian・エージェント・git のマージ）ので、画面が古いまま
   * 上書きすると他人の作業を消す。
   *
   * `watch`（デバウンス付き）を使う。git checkout のように大量のファイルが
   * 一気に変わる場面で、1変更ごとに再読込するとリロード嵐になるため。
   */
  async watchNodes(onChange: () => void, debounceMs = 400): Promise<UnwatchFn> {
    return watch(`${this.vaultPath}/${NODES_DIR}`, () => onChange(), {
      recursive: false,
      delayMs: debounceMs,
    });
  }
}
