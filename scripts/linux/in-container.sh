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
# 第三者のライセンス表記を Linux のクレート構成で焼き直す（Windows 版とは依存が違う）。
# /build は複製なので、手元の licenses/ は書き換わらない。
bun run scripts/gen-licenses.ts --target x86_64-unknown-linux-gnu
bunx tauri build --bundles appimage

# 同梱の libwayland-client が入っていないことを確かめる（2026-09-28 → 09-29 改め）。
#
# 22.04 から持ってきた libwayland-client が同梱されると、新しい Mesa の入った
# ディストロ（Fedora 44 で確認。Bazzite もこの系統）で起動直後に
# `Could not create default EGL display: EGL_BAD_PARAMETER. Aborting...` で落ちる。
# Mesa の EGL が、自分より古い同梱の libwayland-client を掴むため。
#
# 09-28 は焼いたあとに libwayland-* を全部外して詰め直していた。09-29 に Tauri CLI
# 2.12.0（tauri-bundler 2.10.0、tauri#16062）へ上げ、本家が client を同梱しなく
# なったので、外す工程はやめた。手を加えない AppImage が fedora:44 + Xvfb で
# WebView まで描けることを画面で確かめてある。
#
# **-cursor / -egl / -server は外さない。** 09-29 に「保険」として外したら、
# libwayland-server の無いホスト（fedora:44 のコンテナ）で
# `libwayland-server.so.0: cannot open shared object file` になり起動すらしなかった。
# 09-28 の「Wayland のデスクトップなら必ずある」は server については言い過ぎで、
# 本家が残しているものは残す。
#
# CLI を下げたり linuxdeploy の除外一覧が変わったりして client が戻ってきたら、
# ここで止める。
cd src-tauri/target/release/bundle/appimage
img=$(ls *.AppImage)
rm -rf squashfs-root
./"$img" --appimage-extract >/dev/null
if ls squashfs-root/usr/lib/libwayland-client.so* >/dev/null 2>&1; then
  echo "libwayland-client が同梱されている（Tauri CLI が 2.12.0 未満？ 新しい Mesa で EGL_BAD_PARAMETER になる）" >&2
  exit 1
fi

# 日本語入力のモジュールを選ぶ起動フックを足す（中身と理由は apprun-ime.sh）。
# linuxdeploy の AppRun は apprun-hooks/ を丸ごと読むのではなく、フックごとに
# source の行を持っている。置くだけでは読まれないので、exec の直前に1行足す。
# AppRun は `set -e` なので、フックの中で失敗するコマンドを書くと起動ごと止まる。
cp /work/apprun-ime.sh squashfs-root/apprun-hooks/sirube-ime.sh
grep -q '^exec ' squashfs-root/AppRun || { echo "AppRun に exec の行が無い（linuxdeploy の AppRun の形が変わった？）" >&2; exit 1; }
sed -i 's|^exec |source "$this_dir"/apprun-hooks/"sirube-ime.sh"\nexec |' squashfs-root/AppRun
grep -q 'sirube-ime.sh' squashfs-root/AppRun || { echo "AppRun にフックを足せなかった" >&2; exit 1; }
for m in im-fcitx5.so im-ibus.so; do
  [ -e "squashfs-root/usr/lib/gtk-3.0/3.0.0/immodules/$m" ] || { echo "$m が同梱されていない（Dockerfile の fcitx5-frontend-gtk3 / ibus-gtk3）" >&2; exit 1; }
done
# 同梱されたシステムのライブラリの表記を足す（中身と理由は append-system-licenses.sh）。
notice=$(find squashfs-root -type f -name THIRD_PARTY_LICENSES.txt | head -1)
[ -n "$notice" ] || { echo "THIRD_PARTY_LICENSES.txt が AppImage に入っていない（tauri.conf.json の bundle.resources）" >&2; exit 1; }
sh /work/append-system-licenses.sh squashfs-root "$notice"
rm -f "$img"
ARCH=x86_64 appimagetool --no-appstream squashfs-root "$img"
rm -rf squashfs-root
cd /build

mkdir -p /out
cp -v src-tauri/target/release/bundle/appimage/*.AppImage /out/
ls -lh /out
