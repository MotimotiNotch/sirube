// 開発用のサンプルデータ。
//
// Tauri シェルがまだ無いので、UI 開発中はメモリ上のファイルシステムを使う。
// 実際の Markdown テキストを流し込んでいるので、parse の経路は本番と同じものを通る。
//
// 中身は Sirube プロジェクト自身のタスクグラフ ＋ 循環の実例（鶏卵問題）。
// 循環を混ぜてあるのは、「今やれること」が輪でどう詰まるかを実機で見るため。

import { MemoryFs } from "../store/fs.ts";

interface Seed {
  satisfied?: boolean;
  requires?: string[];
  contains?: string[];
  due?: string;
  note?: string;
}

const SEEDS: Record<string, Seed> = {
  // --- Sirube 自身 ---------------------------------------------------------
  "Sirube をリリースする": {
    requires: ["MVP実装完了", "READMEとマニュアルを書く", "マネタイズ方針を決める"],
  },
  MVP実装完了: {
    contains: ["Markdownノードストア", "検索と横断ビュー", "前提の一括追加", "整合性の自動解決", "Tauriシェル"],
  },
  Markdownノードストア: {
    satisfied: true,
    requires: ["新リポジトリを作る"],
    note: "1ノード = 1 Markdown ファイル。frontmatter に satisfied / requires / contains / due。",
  },
  検索と横断ビュー: {
    requires: ["新リポジトリを作る"],
    note: "横断 Next Action ビューは検索の特殊形（空クエリ + ACTIONABLE フィルタ）。1機能に畳んである。",
  },
  前提の一括追加: { satisfied: true, requires: ["新リポジトリを作る"] },
  整合性の自動解決: {
    satisfied: true,
    requires: ["新リポジトリを作る"],
    note: "mtime の新しい方を正とする。frontmatter の updated は使わない（アプリ以外の編集で更新されないため）。",
  },
  Tauriシェル: {
    requires: ["Rustツールチェーンを入れる"],
    note: "OS の WebView2 を使うのでブラウザエンジンを同梱しない。Bun compile の 84MB が消える。",
  },
  新リポジトリを作る: { satisfied: true },
  Rustツールチェーンを入れる: {},
  READMEとマニュアルを書く: {},
  マネタイズ方針を決める: { note: "暫定で OSS + Ko-fi。" },

  // --- 鶏卵問題の実例 ------------------------------------------------------
  // ここが輪になっているせいで、下の「ポートフォリオを公開する」まで
  // 永久に動かない。「今やれること」からも消える。
  実績を作る: { requires: ["案件を取る"] },
  案件を取る: { requires: ["実績を作る"] },
  ポートフォリオを公開する: { requires: ["実績を作る"] },

  // --- 無関係な生活タスク（輪と混ざらないことの確認用） --------------------
  確定申告: { requires: ["領収書整理"], due: "2027-03-15" },
  領収書整理: {},
};

function toMarkdown(seed: Seed): string {
  const lines = ["---", `satisfied: ${seed.satisfied ?? false}`];
  const arr = (key: string, values: string[] | undefined): void => {
    if (!values || values.length === 0) {
      lines.push(`${key}: []`);
      return;
    }
    lines.push(`${key}:`);
    for (const v of values) lines.push(`  - ${v}`);
  };
  arr("requires", seed.requires);
  arr("contains", seed.contains);
  if (seed.due) lines.push(`due: ${seed.due}`);
  lines.push("---", "");
  if (seed.note) lines.push(seed.note, "");
  return lines.join("\n");
}

/** ノード id → Markdown テキスト。dev サーバが実ファイルとして書き出すのにも使う。 */
export const SAMPLE_MARKDOWN: Record<string, string> = Object.fromEntries(
  Object.entries(SEEDS).map(([id, seed]) => [id, toMarkdown(seed)]),
);

export function sampleFs(): MemoryFs {
  const fs = new MemoryFs();
  for (const [id, seed] of Object.entries(SEEDS)) {
    fs.files.set(id, { content: toMarkdown(seed), mtimeMs: fs.tick() });
  }
  return fs;
}
