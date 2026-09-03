#!/bin/sh
# Linux 向け AppImage を Docker で焼く。Windows の Git Bash からそのまま叩ける。
#
#   sh scripts/linux/build-appimage.sh
#
# なぜ Docker を挟むか（手元の WSL で焼かない理由）:
#   AppImage は glibc を同梱しない。ビルドホストの glibc がそのまま最低要求になる。
#   手元の WSL は Ubuntu 24.04 = glibc 2.39 で、そこで焼くと 2.39 未満の環境では
#   `GLIBC_2.3x not found` で起動しない。22.04（2.35）で焼けば最低要求は 2.34 に下がる。
#   Tauri 公式も「サポートしたい最も古いベースで焼け、Docker か GitHub Actions を使え」と明記。
#   22.04 が下限なのは、libwebkit2gtk-4.1-dev（Tauri v2 の必須依存）が 20.04 に無いため。
#
# 出力: src-tauri/target/appimage/*.AppImage（target/ は .gitignore 済み）
set -eu

# Docker Desktop には Windows 形式のパスを渡す必要がある。Git Bash の `pwd` は
# /c/Users/... を返すので `pwd -W` で C:/Users/... に直す（MSYS 以外では素の pwd）。
repo=$(cd "$(dirname "$0")/../.." && { pwd -W 2>/dev/null || pwd; })
out="$repo/src-tauri/target/appimage"
mkdir -p "$out"

# これが無いと MSYS が /src や /out を Windows パスへ書き換えてしまう。
export MSYS_NO_PATHCONV=1

docker build -t sirube-linux-builder "$repo/scripts/linux"

# リポジトリは読み取り専用。コンテナ内へ複製してから触るので、Windows 用の
# node_modules と MSVC の target が Linux ビルドに混ざらず、手元も汚れない。
# cargo registry と target は名前付き volume に逃がす（2回目以降が速い）。
docker run --rm \
  -v "$repo:/src:ro" \
  -v "$repo/scripts/linux:/work:ro" \
  -v "$out:/out" \
  -v sirube-cargo-registry:/usr/local/cargo/registry \
  -v sirube-target:/build/src-tauri/target \
  sirube-linux-builder sh /work/in-container.sh
