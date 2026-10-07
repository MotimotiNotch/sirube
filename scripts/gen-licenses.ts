// 配布物に入る第三者のライセンス表記を `licenses/THIRD_PARTY_LICENSES.txt` に起こす。
//
//   bun run licenses                                   → Windows 版の一覧（リポジトリに置く版）
//   bun run licenses --target x86_64-unknown-linux-gnu → Linux 版（AppImage のコンテナの中で使う）
//
// なぜ依存の一覧ではなく「配布物に入ったもの」から数えるか:
//   package.json の dependencies に載っていてもバンドルに入らないもの（js-yaml の CLI 用
//   の argparse 等）があり、Rust でも proc-macro とその依存（syn 等）はコンパイル時に
//   しか使われない。node_modules 全体に license-checker をかける方式だと、配っていない
//   ビルド道具（typescript・vite 等）まで並ぶ。表記の義務があるのは配ったものだけなので、
//   JS は Bun の metafile、Rust は `cargo tree -e normal,no-proc-macro` から拾う。
//
// 本文を必ず入れる: MIT / Apache-2.0 / BSD は「著作権表示と許諾文を残すこと」が条件で、
// 名前と種類だけの一覧では満たさない。パッケージに LICENSE ファイルが無いもの（2026-10-07
// 時点で Rust 8件・JS 3件）は、SPDX の標準文に著作者を入れて補う。
//
// AppImage に同梱されるシステムのライブラリ（WebKitGTK 等、LGPL が多い）はここでは扱わない。
// どれが入るかは焼いた後にしか分からないので、scripts/linux/append-system-licenses.sh が
// コンテナの中で末尾に足す。
//
// 生成物はリポジトリに置く（tauri.conf.json の bundle.resources が参照するので、無いと
// ビルドが通らない）。`bun run release` がビルドの前に焼き直す。

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const TARGET = opt("--target", "x86_64-pc-windows-msvc");
const OUT_DIR = "licenses";
const OUT = join(OUT_DIR, "THIRD_PARTY_LICENSES.txt");
const RUST_STD_OUT = join(OUT_DIR, "RUST_STD_COPYRIGHT.html");
const ENTRY = "./src/tauri/main.ts"; // scripts/build-web.ts と同じ

interface Item {
  name: string;
  version: string;
  license: string;
  source: string;
  text: string;
}

// --- 本文の選び方 ----------------------------------------------------------

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;

/** `MIT OR Apache-2.0` / `MIT/Apache-2.0` のように選べるときは MIT 側を取る（短く、
 *  NOTICE の扱いも要らない）。選べない（AND や単独）ときは全部入れる。 */
function pickFiles(dir: string, license: string): string[] {
  const files = readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && !f.endsWith(".spdx") && statSync(join(dir, f)).isFile())
    .sort();
  if (files.length <= 1) return files;
  const choosable = /\bOR\b|\//.test(license) && !/\bAND\b/.test(license);
  if (choosable && /\bMIT\b/.test(license)) {
    const mit = files.filter((f) => /mit/i.test(f));
    if (mit.length > 0) return mit;
  }
  return files;
}

const MIT_TEMPLATE = (holder: string) => `MIT License

Copyright (c) ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

const BSD3_TEMPLATE = (holder: string) => `BSD 3-Clause License

Copyright (c) ${holder}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`;

/** ファイルが無いときの補い。標準文が手元にある種類だけ受け付け、それ以外は止める
 *  （黙って空の本文を出すと、表記したつもりで抜けている状態になる）。 */
function fallbackText(who: string, license: string, holder: string): string {
  if (/\bMIT\b/.test(license)) return MIT_TEMPLATE(holder);
  if (/\bBSD-3-Clause\b/.test(license)) return BSD3_TEMPLATE(holder);
  throw new Error(`${who}: ライセンスのファイルが無く、${license} の標準文も用意していません`);
}

function readText(dir: string, license: string, who: string, holder: () => string): string {
  const files = pickFiles(dir, license);
  if (files.length === 0) return fallbackText(who, license, holder());
  return files
    .map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trim() + "\n")
    .join("\n");
}

// --- JS ----------------------------------------------------------------------

async function jsItems(): Promise<Item[]> {
  const built = await Bun.build({ entrypoints: [ENTRY], target: "browser", metafile: true } as Parameters<typeof Bun.build>[0]);
  if (!built.success) throw new Error(built.logs.map(String).join("\n"));
  const meta = (built as unknown as { metafile?: { inputs: Record<string, unknown> } }).metafile;
  if (!meta) throw new Error("Bun.build が metafile を返しませんでした（Bun が古い？）");
  const dirs = new Map<string, string>();
  for (const raw of Object.keys(meta.inputs)) {
    const p = raw.split("\\").join("/");
    const i = p.lastIndexOf("node_modules/");
    if (i < 0) continue;
    const rest = p.slice(i + "node_modules/".length).split("/");
    const name = rest[0]!.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]!;
    dirs.set(name, p.slice(0, i) + "node_modules/" + name);
  }
  const items: Item[] = [];
  for (const [name, dir] of dirs) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const license: string = pkg.license ?? "";
    // Tauri のプラグインは LICENSE.spdx（著作権の行だけ）しか同梱していない。
    const spdx = join(dir, "LICENSE.spdx");
    const holder = () =>
      (existsSync(spdx) && /PackageCopyrightText:\s*(.+)/.exec(readFileSync(spdx, "utf8"))?.[1]?.trim()) ||
      (typeof pkg.author === "string" ? pkg.author : pkg.author?.name) ||
      `the ${name} authors`;
    let repo: string | undefined = typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
    if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) repo = `https://github.com/${repo}`; // "owner/repo" の省略形
    items.push({
      name,
      version: pkg.version,
      license,
      source: (repo ?? `https://www.npmjs.com/package/${name}`).replace(/^git\+/, ""),
      text: readText(dir, license, `${name}@${pkg.version}`, holder),
    });
  }
  return items;
}

// --- Rust --------------------------------------------------------------------

function run(cmd: string, argv: string[], cwd: string): string {
  const r = spawnSync(cmd, argv, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} が失敗しました:\n${r.stderr}`);
  return r.stdout;
}

function rustItems(): Item[] {
  const tree = run("cargo", ["tree", "-e", "normal,no-proc-macro", "--target", TARGET, "-f", "{p}", "--prefix", "none"], "src-tauri");
  const wanted = new Set<string>();
  for (const line of tree.split("\n")) {
    const m = /^(\S+) v(\S+)/.exec(line.trim());
    if (m && m[1] !== "sirube") wanted.add(`${m[1]}@${m[2]}`);
  }
  const meta = JSON.parse(run("cargo", ["metadata", "--format-version", "1", "--filter-platform", TARGET], "src-tauri"));
  const items: Item[] = [];
  for (const p of meta.packages as { name: string; version: string; license?: string; authors?: string[]; repository?: string; manifest_path: string }[]) {
    if (!wanted.delete(`${p.name}@${p.version}`)) continue;
    const license = p.license ?? "";
    const holder = () => {
      const a = (p.authors ?? []).map((s) => s.replace(/\s*<[^>]*>/, "").trim()).filter(Boolean);
      return a.length > 0 ? a.join(", ") : `the ${p.name} authors`;
    };
    items.push({
      name: p.name,
      version: p.version,
      license,
      source: p.repository ?? `https://crates.io/crates/${p.name}/${p.version}`,
      text: readText(dirname(p.manifest_path), license, `${p.name}@${p.version}`, holder),
    });
  }
  if (wanted.size > 0) throw new Error(`cargo metadata に見つからないクレート: ${[...wanted].join(", ")}`);
  return items;
}

/** Rust の標準ライブラリは exe に静的に入る。ツールチェーンが配布者向けに用意している
 *  COPYRIGHT-library.html をそのまま同梱する（1.5MB だがインストーラ内では 40KB 程度）。
 *  `--profile minimal` のツールチェーン（AppImage のコンテナ）には無いので、そのときは
 *  リポジトリに置いてある版を使う。版は rust-toolchain.toml で固定しているので同じもの。 */
async function rustStd(): Promise<string> {
  const version = run("rustc", ["--version"], ".").trim();
  const sysroot = run("rustc", ["--print", "sysroot"], ".").trim();
  const src = join(sysroot, "share", "doc", "rust", "COPYRIGHT-library.html");
  if (existsSync(src)) await copyFile(src, RUST_STD_OUT);
  else if (!existsSync(RUST_STD_OUT)) throw new Error(`${src} が無く、${RUST_STD_OUT} もありません`);
  return version;
}

// --- 書き出し ----------------------------------------------------------------

const RULE = "-".repeat(80);

function section(title: string, items: Item[]): string {
  // 本文が同じものは1つにまとめる（Apache-2.0 の本文などは何十個も同じになる）。
  const byText = new Map<string, Item[]>();
  for (const it of items.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))) {
    const list = byText.get(it.text) ?? [];
    list.push(it);
    byText.set(it.text, list);
  }
  const blocks = [...byText].map(([text, list]) =>
    [
      RULE,
      ...list.map((it) => `${it.name} ${it.version}  (${it.license || "license not declared"})  ${it.source}`),
      "",
      text.trimEnd(),
      "",
    ].join("\n"),
  );
  return `${"=".repeat(80)}\n${title}\n${"=".repeat(80)}\n\n${blocks.join("\n")}\n`;
}

await mkdir(OUT_DIR, { recursive: true });
const js = await jsItems();
const rs = rustItems();
const rustVersion = await rustStd();
const lucide = readFileSync(join(OUT_DIR, "lucide-LICENSE.txt"), "utf8").replace(/\r\n/g, "\n");

const header = `Sirube — third-party notices
Generated by scripts/gen-licenses.ts for target ${TARGET}. Do not edit by hand.

Sirube itself is licensed under the MIT License (see LICENSE.txt).
This file lists the third-party software that is included in this build,
with the license text each one requires to be reproduced.

  JavaScript packages bundled into the UI: ${js.length}
  Rust crates linked into the executable:  ${rs.length}
  Rust standard library (${rustVersion}):   see RUST_STD_COPYRIGHT.html
  Icons: Lucide (ISC; some icons MIT, derived from Feather)
`;

const body = [
  header,
  section("JavaScript packages", js),
  section("Rust crates", rs),
  `${"=".repeat(80)}\nIcons\n${"=".repeat(80)}\n\n${RULE}\nLucide  https://lucide.dev  (icons are embedded in the UI)\n\n${lucide.trimEnd()}\n`,
  `${"=".repeat(80)}\nRust standard library\n${"=".repeat(80)}\n\n${rustVersion}\nThe copyright notices for the Rust standard library are in RUST_STD_COPYRIGHT.html\n(copied from the Rust toolchain's share/doc/rust/COPYRIGHT-library.html).\n`,
].join("\n");

await writeFile(OUT, body.replace(/\r\n/g, "\n"), "utf8");
console.log(`${OUT} を書き出しました（JS ${js.length} / Rust ${rs.length}、${(body.length / 1024).toFixed(0)} KB、target ${TARGET}）`);
