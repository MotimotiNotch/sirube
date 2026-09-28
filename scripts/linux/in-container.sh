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

# 同梱された libwayland を外して詰め直す（2026-09-28）。
#
# 22.04 から持ってきた libwayland-client 等が同梱されると、新しい Mesa の入った
# ディストロ（Fedora 44 で確認。Bazzite もこの系統）で起動直後に
# `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...` で落ちる。
# Mesa の EGL は自分と同じ世代の libwayland を前提にしているのに、AppImage の方が
# 先に読まれて古いものが当たるため。外すとホストのものが使われ、起動して描ける
# ことを fedora:44 + Xvfb の画面で確かめてある。
#
# 外しても困らない: Wayland のデスクトップ（KDE・GNOME）なら libwayland は必ず
# 入っている。X11 だけの環境でも、GTK が libwayland-client を読むので大抵ある。
cd src-tauri/target/release/bundle/appimage
img=$(ls *.AppImage)
rm -rf squashfs-root
./"$img" --appimage-extract >/dev/null
removed=$(ls squashfs-root/usr/lib/libwayland-*.so* 2>/dev/null | wc -l)
[ "$removed" -gt 0 ] || { echo "libwayland が同梱されていない（linuxdeploy の挙動が変わった？）" >&2; exit 1; }
rm -f squashfs-root/usr/lib/libwayland-*.so*
echo "libwayland を ${removed} 個外した"
rm -f "$img"
ARCH=x86_64 appimagetool --no-appstream squashfs-root "$img"
rm -rf squashfs-root
cd /build

mkdir -p /out
cp -v src-tauri/target/release/bundle/appimage/*.AppImage /out/
ls -lh /out
