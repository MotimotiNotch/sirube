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
  deleteNode(id: string): Promise<void>;
  /** 書き込み直後の mtime を取り直すため。 */
  statNode(id: string): Promise<number>;
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
  async deleteNode(id: string): Promise<void> {
    this.files.delete(id);
  }
  async statNode(id: string): Promise<number> {
    return this.files.get(id)?.mtimeMs ?? 0;
  }
}
