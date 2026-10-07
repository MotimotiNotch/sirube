// Lucide の公式 SVG を `src/ui/icons.ts` に取り込む生成スクリプト。
// 追加したいアイコンは NAMES に足して `bun run scripts/gen-icons.ts` を実行する。
//
// 上流から直接取る。以前は「%TEMP%/lucide-<name>.svg に curl で落としてある想定」
// だったが、(1) 手順が暗黙で、置き忘れると壊れた icons.ts が出る (2) 取得先の絶対
// パスに個人のユーザー名が入る (3) そもそも curl が通らない環境がある、の3つが
// 重なっていた。fetch なら手順は1つで済む。
//
// **今このスクリプトは通らない**（2026-09-10 確認）。上流が `trash-2` を消して
// `trash` に改名したので、そこで 404 で止まる。中身は同一（バイト単位で一致）
// なので画面は壊れていない——直すなら NAMES と `icons.ts` のキー、その参照元を
// まとめて `trash` へ寄せる。**全アイコンを取り直す操作**なので、他のアイコンの
// 上流変更も一緒に入る。だから `undo-2` と `clock`（2026-09-14、「最近の変更」用）、
// `chevron-up` / `chevron-down`（同日、列の並べ替えの向き）、`app-window`（2026-09-28、別窓で開く）、`calendar`（同日、期限の入力欄）、`sun` / `moon` / `monitor` / `check`（2026-10-06、ライトとダークの切り替え）、`languages`（同日、言語の切り替え）、`settings`（同日、表示と言語をまとめたヘッダーのボタン）はこのスクリプトを通さず、
// 同じ正規化で1件ずつ足してある。なお `history` も上流で 404 だった（2026-09-14 確認）。

const NAMES = [
  "compass", "search", "circle-check", "circle", "circle-slash", "repeat",
  "plus", "trash-2", "chevron-right", "x", "corner-down-right", "layers",
  "triangle-alert", "wand-sparkles", "list-checks", "pencil", "arrow-left",
  "folder-open", "info", "sticky-note", "undo-2", "clock", "chevron-up", "chevron-down", "app-window", "calendar",
];

const SOURCE = "https://raw.githubusercontent.com/lucide-icons/lucide/main/icons";

async function fetchIcon(name: string): Promise<string> {
  const res = await fetch(`${SOURCE}/${name}.svg`);
  // 404 の本文をそのまま SVG として埋め込むと、画面には何も出ないのにビルドは
  // 通る、という一番気付きにくい壊れ方をする。ここで止める。
  if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
  return (await res.text())
    .trim()
    .replace(/\s*\n\s*/g, " ")
    .replace(/>\s+</g, "><");
}

const camel = (s: string): string => s.replace(/-(.)/g, (_, c: string) => c.toUpperCase());

const header = [
  "// Lucide アイコン (ISC License, https://lucide.dev。表記は licenses/lucide-LICENSE.txt)",
  "//",
  "// 公式 SVG をパス改変なしで取り込んでいる。追加するときも lucide-icons/lucide の",
  "// icons/<name>.svg をそのまま貼ること（線幅・キャップの統一が崩れるので自作しない）。",
  "// 生成は scripts/gen-icons.ts。絵文字はアイコンとして使わない方針。",
  "",
  "export const ICONS = {",
].join("\n");

let out = header + "\n";
const svgs = await Promise.all(NAMES.map(fetchIcon));
NAMES.forEach((n, i) => {
  out += `  ${JSON.stringify(camel(n))}: ${JSON.stringify(svgs[i])},\n`;
});

const footer = [
  "} as const;",
  "",
  "export type IconName = keyof typeof ICONS;",
  "",
  "/** アイコン1つ分の SVG 文字列。色は currentColor に従う。 */",
  "export function icon(name: IconName, size = 16): string {",
  "  const attrs = 'width=\"' + size + '\" height=\"' + size + '\" aria-hidden=\"true\" focusable=\"false\"';",
  "  return ICONS[name].replace(\"<svg\", \"<svg \" + attrs);",
  "}",
  "",
].join("\n");

await Bun.write("src/ui/icons.ts", out + footer);
console.log(`icons.ts を書き出し: ${NAMES.length} 個`);
