#!/bin/sh
# AppImage に同梱されたシステムのライブラリ（.so）のライセンス表記を、
# THIRD_PARTY_LICENSES.txt の末尾に足す。in-container.sh から、焼いた AppImage を
# 展開した直後に呼ばれる。
#
#   sh append-system-licenses.sh <squashfs-root> <THIRD_PARTY_LICENSES.txt>
#
# なぜ要るか: linuxdeploy はビルドに使った ubuntu:22.04 の .so（WebKitGTK・GTK・
# GLib・GStreamer 等、0.5.1 で 168 個 / 114 パッケージ）をそのまま AppImage に入れる。
# どれもパッケージマネージャを経ずに配られるので、依存の一覧（Cargo.lock・bun.lock）
# のどこにも出てこない。多くが LGPL で、本文の同梱とソースの在りかを示すことが要る。
#
# .so → dpkg のパッケージ → /usr/share/doc/<pkg>/copyright の順に引く。
# copyright の先頭の License: 行はパッケージ内のツールやテストのものであることが多いので、
# 要約はせず全文を入れる。ソースは Ubuntu のソースパッケージ（launchpad）を案内する。
set -eu

root=$1
out=$2

libs=$(find "$root/usr/lib" -type f -name '*.so*' | sort)
[ -n "$libs" ] || { echo "$root/usr/lib に .so が無い（AppImage の形が変わった？）" >&2; exit 1; }

pkgs=$(for f in $libs; do
  dpkg -S "*/$(basename "$f")" 2>/dev/null | head -1 | cut -d: -f1
done | sort -u)

# dpkg に持ち主のいない .so（Tauri 自身や linuxdeploy が足したもの）は数だけ出しておく。
unowned=0
for f in $libs; do
  dpkg -S "*/$(basename "$f")" >/dev/null 2>&1 || unowned=$((unowned + 1))
done

n=$(printf '%s\n' "$pkgs" | grep -c .)

{
  printf '\n%s\n' "================================================================================"
  printf '%s\n' "Linux system libraries bundled in the AppImage"
  printf '%s\n\n' "================================================================================"
  printf '%s\n' "The AppImage bundles shared libraries from Ubuntu 22.04 (the build image) so that"
  printf '%s\n' "it runs on other distributions. They come from $n Ubuntu packages, listed below"
  printf '%s\n' "with each package's copyright file. Many are under the LGPL: they are dynamically"
  printf '%s\n' "linked and can be replaced, and their source code is available from Ubuntu at the"
  printf '%s\n\n' "URL given for each package (and on request from the author of Sirube)."
  for p in $pkgs; do
    src=$(dpkg-query -W -f='${source:Package}' "$p")
    ver=$(dpkg-query -W -f='${source:Version}' "$p")
    printf '%s\n' "--------------------------------------------------------------------------------"
    printf '%s\n' "$p ($src $ver)  https://launchpad.net/ubuntu/+source/$src/$ver"
    printf '\n'
    if [ -f "/usr/share/doc/$p/copyright" ]; then
      cat "/usr/share/doc/$p/copyright"
    else
      echo "(no copyright file in /usr/share/doc/$p)"
    fi
    printf '\n'
  done
} >> "$out"

echo "システムのライブラリ: .so $(printf '%s\n' "$libs" | grep -c .) 個 / パッケージ $n 個（持ち主なし $unowned 個）を $out に足しました"
