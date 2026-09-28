// Tauri 上でのファイルアクセス。`SirubeFs` の実装。
//
// 製品構成にはサーバが無い。UI もエンジンもストアも WebView の中で動き、
// ファイル操作だけがここを通ってネイティブ側へ抜ける。`SirubeFs` という
// 1インターフェースに閉じてあるおかげで、エンジンや DSL は一切 Tauri を知らない。
//
// 対象は `<vault>/nodes/*.md` だけ。

import { mkdir, readDir, readTextFile, remove, stat, watch, writeTextFile, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { assertDocPath, type NodeFileEntry, type SirubeFs } from "./fs.ts";

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
    // 以前は `<vault>/.sirube/`（設定を置く想定）も作っていたが、何も入れないまま
    // だった。しかも Linux では fs スコープの照合が「`.` 始まりの名前は明示しないと
    // 一致しない」のが既定で、ここが forbidden になって**どのフォルダも開けなかった**
    // （2026-09-28、Bazzite の友人の報告。Windows は既定が逆なので手元では出ない）。
    // `.` 始まりのものを vault に作るときは、このことを先に思い出すこと。
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

  async createNode(id: string, content: string): Promise<void> {
    // `createNew` は「既に在れば失敗する」排他作成。確認と作成が1操作なので、
    // その間に他所から同じ名前が作られる隙間が無い。
    await writeTextFile(nodePath(this.vaultPath, id), content, { createNew: true });
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

  // --- 生成物（MOC）------------------------------------------------------

  async writeDoc(relPath: string, content: string): Promise<void> {
    assertDocPath(relPath);
    const slash = relPath.lastIndexOf("/");
    if (slash > 0) await mkdir(`${this.vaultPath}/${relPath.slice(0, slash)}`, { recursive: true });
    await writeTextFile(`${this.vaultPath}/${relPath}`, content);
  }

  async listDocs(dirRelPath: string): Promise<string[]> {
    assertDocPath(dirRelPath);
    try {
      const entries = await readDir(`${this.vaultPath}/${dirRelPath}`);
      return entries.filter((e) => !e.isDirectory && e.name.endsWith(EXT)).map((e) => e.name);
    } catch {
      return []; // まだ作られていない。生成物なので無ければ無いでよい。
    }
  }

  async deleteDoc(relPath: string): Promise<void> {
    assertDocPath(relPath);
    try {
      await remove(`${this.vaultPath}/${relPath}`);
    } catch {
      // 既に無い。生成物の後始末なので失敗しても困らない。
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
