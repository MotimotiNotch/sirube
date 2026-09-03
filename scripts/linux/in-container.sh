#!/bin/sh
# コンテナ内で走る。ホスト側のリポジトリは読み取り専用でマウントし、
# 中身を /build へ複製してから触る（Windows 用の node_modules と
# MSVC の target を Linux ビルドに混ぜない。ホストも汚さない）。
set -eu

cd /src
tar cf - --exclude=./node_modules --exclude=./src-tauri/target --exclude=./.git --exclude=./dist . \
  | (cd /build && tar xf -)

cd /build

# rust-toolchain.toml は Windows 用に targets を windows-msvc で固定している。
# そのままだと rustup が Linux 上でクロス用 std を落としに行くだけ無駄なので差し替える。
sed -i 's|^targets = .*|targets = ["x86_64-unknown-linux-gnu"]|' rust-toolchain.toml

bun install --frozen-lockfile
bunx tauri build --bundles appimage

mkdir -p /out
cp -v src-tauri/target/release/bundle/appimage/*.AppImage /out/
ls -lh /out
