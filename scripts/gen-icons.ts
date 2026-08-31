// Lucide の公式 SVG を `src/ui/icons.ts` に取り込む生成スクリプト。
// 追加したいアイコンは NAMES に足して `bun run scripts/gen-icons.ts` を実行する。
// 取得済み SVG は %TEMP%/lucide-<name>.svg に置いてある想定（curl で取る）。

const NAMES = [
  "compass", "search", "circle-check", "circle", "circle-slash", "repeat",
  "plus", "trash-2", "chevron-right", "x", "corner-down-right", "layers",
  "triangle-alert", "wand-sparkles", "list-checks", "pencil", "arrow-left",
];

const camel = (s: string): string => s.replace(/-(.)/g, (_, c: string) => c.toUpperCase());

const header = [
  "// Lucide アイコン (MIT License, https://lucide.dev)",
  "//",
  "// 公式 SVG をパス改変なしで取り込んでいる。追加するときも lucide-icons/lucide の",
  "// icons/<name>.svg をそのまま貼ること（線幅・キャップの統一が崩れるので自作しない）。",
  "// 生成は scripts/gen-icons.ts。絵文字はアイコンとして使わない方針。",
  "",
  "export const ICONS = {",
].join("\n");

let out = header + "\n";
for (const n of NAMES) {
  const svg = (await Bun.file(`C:/Users/monof/AppData/Local/Temp/lucide-${n}.svg`).text())
    .trim()
    .replace(/\s*\n\s*/g, " ")
    .replace(/>\s+</g, "><");
  out += `  ${JSON.stringify(camel(n))}: ${JSON.stringify(svg)},\n`;
}

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
