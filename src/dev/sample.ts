// 開発用のサンプルデータ。
//
// Tauri シェルがまだ無いので、UI 開発中はメモリ上のファイルシステムを使う。
// 実際の Markdown テキストを流し込んでいるので、parse の経路は本番と同じものを通る。
//
// 中身は Sirube プロジェクト自身のタスクグラフ ＋ 循環の実例（鶏卵問題）。
// 循環を混ぜてあるのは、「今やれること」が輪でどう詰まるかを実機で見るため。
//
// **id は本物と同じ ULID にする**（2026-09-01）。id/name を分けたあとも
// ここだけ「ファイル名＝ノード名」のままだったため、dev と test の全経路が
// id === name の世界しか通らなくなっていた。結果、画面に素の id が出る不具合が
// 3箇所あっても誰も気付けない。id は固定値にしてある——毎回採番すると
// スナップショット的なテストが書けず、diff も無意味に動くため。
//
// 参照の書き方も本物に合わせて混ぜる: 書き手（アプリ）は id で書き、人が手で
// 足した行は名前のまま残る。読み側は両方受け付ける（resolveReferences）ので、
// その両方をここで通しておく。

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

/** 名前 → 固定 ULID。Crockford Base32・26文字という形式チェックだけは
 *  本物と同じものを通るようにしてある（先頭は時刻部のつもりの固定値）。 */
const IDS: Record<string, string> = Object.fromEntries(
  // Crockford Base32 には I / L / O / U が無い。ここを外すと isUlid() が落ちて
  // 「ファイル名が id の形式ではありません」が全件に出る（"SAMPLE" の L で踏んだ）。
  Object.keys(SEEDS).map((name, i) => [name, `01M0DEV${String(i).padStart(2, "0")}${"0".repeat(17)}`]),
);

/** 参照を id へ寄せる。ただし一部はわざと名前のまま残す——人が手で書いた行を
 *  読み側が解決できることまで含めて dev で確かめたいため。 */
function ref(name: string, keepName: boolean): string {
  return keepName ? name : (IDS[name] ?? name);
}

function toMarkdown(seed: Seed, name: string): string {
  const lines = ["---", `name: ${name}`, `satisfied: ${seed.satisfied ?? false}`];
  const arr = (key: string, values: string[] | undefined): void => {
    if (!values || values.length === 0) {
      lines.push(`${key}: []`);
      return;
    }
    lines.push(`${key}:`);
    values.forEach((v, i) => {
      // 各リストの最後の1件だけ名前のまま（手書き行の再現）。
      const keepName = i === values.length - 1;
      const written = ref(v, keepName);
      lines.push(keepName ? `  - ${written}` : `  - ${written}  # ${v}`);
    });
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
  Object.entries(SEEDS).map(([name, seed]) => [IDS[name]!, toMarkdown(seed, name)]),
);

export function sampleFs(): MemoryFs {
  const fs = new MemoryFs();
  for (const [name, seed] of Object.entries(SEEDS)) {
    fs.files.set(IDS[name]!, { content: toMarkdown(seed, name), mtimeMs: fs.tick() });
  }
  return fs;
}
