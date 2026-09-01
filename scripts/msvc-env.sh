#!/usr/bin/env bash
# MSVC の環境変数を Git Bash に取り込むための小道具。
#
# なぜ要るか: Git Bash には GNU coreutils の `link`（ハードリンク作成コマンド）が
# あり、MSVC の `link.exe` より先に PATH で見つかる。その状態で cargo を回すと
#
#   note: link: extra operand '...rcgu.o'  /  Try 'link --help' for more information.
#
# という一見わけの分からないリンクエラーになる。実際に呼ばれているのが
# coreutils の link なので当然で、MSVC の環境（PATH / LIB / INCLUDE）を
# 先に通しておく必要がある。
#
# 使い方:
#   source scripts/msvc-env.sh
#   bunx tauri build

VCVARS="/c/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Auxiliary/Build/vcvars64.bat"

if [ ! -f "$VCVARS" ]; then
  echo "vcvars64.bat が見つかりません: $VCVARS" >&2
  echo "Visual Studio Build Tools（C++ ビルドツール ワークロード）が必要です。" >&2
  return 1 2>/dev/null || exit 1
fi

# vcvars64.bat は cmd 用なので、cmd で実行させた結果の環境変数を取り出して
# こちらへ移し替える。PATH だけは Windows 形式 → POSIX 形式へ変換する。
_msvc_dump=$(cmd //c "\"$(cygpath -w "$VCVARS")\" >nul 2>&1 && set")

while IFS= read -r line; do
  case "$line" in
    PATH=*)
      _win_path="${line#PATH=}"
      # MSVC のパスを既存 PATH の**前**に置く。coreutils の link より先に
      # link.exe を見つけさせるのが目的。
      PATH="$(cygpath -p "$_win_path"):$PATH"
      export PATH
      ;;
    INCLUDE=*|LIB=*|LIBPATH=*|WindowsSdk*|VCToolsInstallDir=*|VCINSTALLDIR=*|UCRTVersion=*|WindowsSDKVersion=*)
      export "${line?}"
      ;;
  esac
done <<< "$_msvc_dump"

# cargo / rustup も通しておく（rustup は既定で ~/.cargo/bin に入る）。
# 個人のユーザー名を焼き付けない（clone した人の手元で必ず外れるため）。
export PATH="$PATH:${CARGO_HOME:-$USERPROFILE/.cargo}/bin"

if command -v link.exe >/dev/null 2>&1 || [ -n "${VCToolsInstallDir:-}" ]; then
  echo "MSVC 環境を読み込みました（VCTools: ${VCToolsInstallDir:-不明}）"
else
  echo "MSVC 環境の読み込みに失敗した可能性があります" >&2
fi
