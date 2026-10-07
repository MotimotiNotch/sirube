// Sirube のネイティブ側。
//
// ここはシェルでしかない。状態導出・カスケード・循環検出・Markdown の読み書きは
// 全部フロント（TypeScript）にあり、Rust が担うのは「ウィンドウを出す」ことと
// 「ファイルとダイアログの口を開ける」ことだけ。
//
// OS の WebView（Windows なら WebView2）を使うのでブラウザエンジンを同梱しない。
// Bun compile 版はランタイム本体だけで 84MB あり、それが配布時の AV スキャン待ちを
// 悪化させていた。

mod crash;

use tauri::Manager;
use tauri_plugin_fs::FsExt;

/// ユーザーが選んだ vault フォルダを fs プラグインのスコープに入れる。
///
/// capabilities に `fs:allow-read-dir` 等を並べても、それは「コマンドを呼んでよい」
/// までしか意味しない。実際のパスは `resolve_path()` のスコープ検査を通る必要があり、
/// 許可された範囲が空だと全部 `PathForbidden` になる。vault の場所は実行時にしか
/// 分からないので、静的な capabilities では書けない——ここで実行時に足す。
///
/// `**` を capabilities に書いて全許可にする手もあるが、それはユーザーのディスク全体を
/// 開けることになる。選ばれた1フォルダだけを開ける方を採る。
///
/// スコープは再起動で消えるので、保存済みパスから復帰するときもフロントから毎回呼ぶ。
#[tauri::command]
fn allow_vault(app: tauri::AppHandle, path: String) -> Result<(), String> {
  app
    .fs_scope()
    .allow_directory(&path, true)
    .map_err(|e| format!("vault フォルダへのアクセスを許可できませんでした: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // ノードの実体は <vault>/nodes/*.md。読み書きと外部変更の監視に使う。
    .plugin(tauri_plugin_fs::init())
    // 初回起動時に vault フォルダを選んでもらうため。
    .plugin(tauri_plugin_dialog::init())
    // メモやマニュアルのリンクを既定のブラウザで開くため（2026-10-06）。
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      // 異常終了の記録（2026-10-05）。リリース版は何も書いていなかったので、落ちたときに
      // 手がかりがゼロだった。ログのプラグインと違ってリリース版でも常に入れる。
      let version = app.package_info().version.to_string();
      crash::init(app.handle());
      crash::install_panic_hook(version.clone());
      crash::spawn_watchdog(version);
      // 本窓の背景を、HTML が描かれる前から OS の明暗に合わせておく（2026-10-07）。
      // WebView の既定は白なので、OS がダークだと起動の一瞬だけ白く光っていた。
      // アプリの中で選んだテーマは localStorage にあってここからは読めないので、
      // 既定の「OS に合わせる」に合わせる。選んだ値は画面側が読み込み直後に塗り直す
      // （theme.ts の onThemeApplied）。色は style.css の --bg と同じ。
      if let Some(main) = app.get_webview_window("main") {
        let bg = match main.theme() {
          Ok(tauri::Theme::Dark) => tauri::window::Color(0x16, 0x17, 0x1a, 0xff),
          _ => tauri::window::Color(0xfb, 0xfb, 0xfa, 0xff),
        };
        let _ = main.set_background_color(Some(bg));
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    // 本窓を閉じたらアプリごと終える（2026-09-28、別窓を足したとき）。Tauri は
    // 窓が1つでも残っていれば動き続けるので、放っておくとサブ窓だけが残る。
    // サブ窓は設定を何も保存しない（`AppOptions.sub`）ので、本窓の無いまま残すと
    // 次に開いたとき何も覚えていない窓で作業を続けることになる。
    .on_window_event(|window, event| {
      if window.label() == "main" {
        match event {
          tauri::WindowEvent::Destroyed => window.app_handle().exit(0),
          // 固まったかの見張りは、本窓に焦点があるときだけ（`crash::Watch::focused`）。
          tauri::WindowEvent::Focused(focused) => crash::set_focused(*focused),
          _ => {}
        }
      }
    })
    // Linux で、変換中の文字（下線付きのひらがな）を入力欄の中に描かせる
    // （2026-09-28）。wry 0.55 は WebView を作るときに無条件で
    // `set_enable_preedit(false)` を呼ぶ——古い WebKitGTK で fcitx の候補窓が
    // カーソルに付いてこなかったのを避けるための処置で、代わりに変換中の文字が
    // fcitx の窓（入力欄の外）に出る。同梱の WebKitGTK は 2.50.4 で、2.50 以降は
    // 位置ずれが起きないとされる（tauri-apps/wry#1724、切り替えを設定にする PR が
    // open のまま）。作った後に呼び直して戻す。PR がマージされたらそちらへ移す。
    // ページを読むたびに呼ぶので、別窓にも効く。
    .on_page_load(|webview, _payload| {
      #[cfg(target_os = "linux")]
      let _ = webview.with_webview(|wv| {
        use webkit2gtk::{InputMethodContextExt, WebViewExt};
        if let Some(ctx) = wv.inner().input_method_context() {
          ctx.set_enable_preedit(true);
        }
      });
      #[cfg(not(target_os = "linux"))]
      let _ = webview;
    })
    .invoke_handler(tauri::generate_handler![
      allow_vault,
      crash::heartbeat,
      crash::record_crash,
      crash::take_crash_reports
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
