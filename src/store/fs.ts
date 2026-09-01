// ファイルアクセスの抽象。
//
// Sirube は Tauri アプリなので、実行時のファイル操作は `@tauri-apps/plugin-fs`
// 経由になる。一方でコアのロジックは Bun のテストから叩けないと開発が回らない。
// 「ノードファイル1枚」という粒度でインターフェースを切っておけば、
// Tauri 側アダプタは薄い委譲で済み、テストはメモリ実装で足りる。
//
// MOC の「ストアのインターフェースを1箇所に閉じる」がこれ。ここさえ守れば
// 将来スタックを差し替えても engine / dsl は一切触らずに済む。

export interface NodeFileEntry {
  /** 拡張子を除いたファイル名。そのままノード id になる。 */
  id: string;
  /** 最終更新時刻（epoch ms）。整合性の自動解決が「新しい方を正」とするのに使う。 */
  mtimeMs: number;
}

export interface SirubeFs {
  /** `nodes/` 直下の `*.md` を列挙する。 */
  listNodes(): Promise<NodeFileEntry[]>;
  readNode(id: string): Promise<string>;
  writeNode(id: string, content: string): Promise<void>;
  /** 新規作成専用。**既に在れば必ず失敗する。**
   *
   * 「在るか確認してから書く」の2段だと、確認と書き込みの間に隙間ができる。
   * id の重複を受け止める場所をここ1箇所にしておくと、乱数の衝突も、時計の
   * 巻き戻りも、ファイルを手でコピーした結果も、同じ経路で弾ける。 */
  createNode(id: string, content: string): Promise<void>;
  deleteNode(id: string): Promise<void>;
  /** 書き込み直後の mtime を取り直すため。 */
  statNode(id: string): Promise<number>;

  // --- 生成物（MOC）------------------------------------------------------
  // `nodes/` の外にしか書かない。**読み出す口はわざと用意していない**——
  // 生成物を読み返した瞬間に第二の真実になるため。消えていても壊れない。

  /** vault ルートからの相対パスへ書く。途中のフォルダは作る。 */
  writeDoc(relPath: string, content: string): Promise<void>;
  /** 生成物フォルダ直下の `*.md` を列挙する（消えた目的の後始末用）。 */
  listDocs(dirRelPath: string): Promise<string[]>;
  deleteDoc(relPath: string): Promise<void>;
}

/** 生成物の相対パスとして安全か。ディレクトリ横断と `nodes/` への書き込みを防ぐ。 */
export function assertDocPath(relPath: string): void {
  if (relPath.includes("\\") || relPath.includes("..") || relPath.startsWith("/")) {
    throw new Error(`生成物のパスとして使えません: ${relPath}`);
  }
  if (relPath === "nodes" || relPath.startsWith("nodes/")) {
    throw new Error(`生成物を nodes/ の中には書けません: ${relPath}`);
  }
}

/** テストと、まだ Tauri シェルが無い段階の開発用。 */
export class MemoryFs implements SirubeFs {
  readonly files = new Map<string, { content: string; mtimeMs: number }>();
  /** 呼ぶたびに進む論理時計。mtime の前後関係をテストで作るために使う。 */
  private clock = 1_000;

  constructor(initial?: Record<string, string>) {
    if (initial) for (const [id, content] of Object.entries(initial)) this.files.set(id, { content, mtimeMs: this.tick() });
  }

  tick(): number {
    this.clock += 1000;
    return this.clock;
  }

  /** テスト用: 特定ノードの mtime を明示的に進める。 */
  touch(id: string, mtimeMs?: number): void {
    const f = this.files.get(id);
    if (f) f.mtimeMs = mtimeMs ?? this.tick();
  }

  async listNodes(): Promise<NodeFileEntry[]> {
    return [...this.files.entries()].map(([id, f]) => ({ id, mtimeMs: f.mtimeMs }));
  }
  async readNode(id: string): Promise<string> {
    const f = this.files.get(id);
    if (!f) throw new Error(`no such node file: ${id}`);
    return f.content;
  }
  async writeNode(id: string, content: string): Promise<void> {
    this.files.set(id, { content, mtimeMs: this.tick() });
  }
  async createNode(id: string, content: string): Promise<void> {
    if (this.files.has(id)) throw new Error(`既に存在します: ${id}`);
    this.files.set(id, { content, mtimeMs: this.tick() });
  }
  async deleteNode(id: string): Promise<void> {
    this.files.delete(id);
  }
  async statNode(id: string): Promise<number> {
    return this.files.get(id)?.mtimeMs ?? 0;
  }

  /** 生成物。ノードとは別の入れ物に持つ（`listNodes` に混ざらないように）。 */
  readonly docs = new Map<string, string>();

  async writeDoc(relPath: string, content: string): Promise<void> {
    assertDocPath(relPath);
    this.docs.set(relPath, content);
  }
  async listDocs(dirRelPath: string): Promise<string[]> {
    const prefix = `${dirRelPath}/`;
    return [...this.docs.keys()]
      .filter((k) => k.startsWith(prefix) && k.endsWith(".md") && !k.slice(prefix.length).includes("/"))
      .map((k) => k.slice(prefix.length));
  }
  async deleteDoc(relPath: string): Promise<void> {
    assertDocPath(relPath);
    this.docs.delete(relPath);
  }
}
