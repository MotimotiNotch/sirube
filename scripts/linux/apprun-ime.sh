# AppImage の起動フック: 日本語入力のモジュールを選ぶ（2026-09-28）。
#
# in-container.sh が AppImage を詰め直すときに apprun-hooks/ へ置き、AppRun から
# source させる。linuxdeploy-plugin-gtk のフックの後に読まれる。
#
# なぜ要るか: linuxdeploy-plugin-gtk のフックは `GTK_IM_MODULE_FILE` を同梱の
# 一覧へ固定し、`GDK_BACKEND=x11` も強制する。Wayland のデスクトップ（KDE の
# 推奨設定の fcitx5 など）では `GTK_IM_MODULE` も `XMODIFIERS` も空のことが多く
# （Bazzite の友人の環境で実測、2026-09-28）、そのままだと GTK は同梱した
# im-fcitx5 / im-ibus を選ばず、Wayland の入力口（text-input）も x11 強制で
# 使えないので、日本語が入らない。
#
# 2026-09-29 追記: Tauri CLI 2.12.0 から `GDK_BACKEND=x11` の強制が無くなり、
# Wayland のセッションでは Wayland ネイティブで動く。GTK_IM_MODULE が空なら
# GTK は同梱の im-wayland（text-input）を選ぶので、このフック無しでも入る
# かもしれない。ただし確かめていない（コンテナでは IME を動かせない）。友人の
# 実機で確認済みなのは fcitx5 の D-Bus モジュールの経路なので、それに寄せ続ける。
# 外すなら、実機で「フック無し＋Wayland ネイティブ」で入力欄の中に変換が出るかを
# 見てから。
#
# 利用者が自分で指定しているときは何もしない（`GTK_IM_MODULE=xim` +
# `XMODIFIERS=@im=fcitx` を手で付ければ入ることは、友人の実機で確認済み）。
if [ -z "${GTK_IM_MODULE:-}" ]; then
  case "${XMODIFIERS:-}" in
    *fcitx*) export GTK_IM_MODULE=fcitx ;;
    *ibus*) export GTK_IM_MODULE=ibus ;;
    *)
      if pgrep -x fcitx5 >/dev/null 2>&1 || pgrep -x fcitx >/dev/null 2>&1; then
        export GTK_IM_MODULE=fcitx
      elif pgrep -x ibus-daemon >/dev/null 2>&1; then
        export GTK_IM_MODULE=ibus
      fi
      ;;
  esac
fi
