// Sirube のネイティブ側。
//
// ここはシェルでしかない。状態導出・カスケード・循環検出・Markdown の読み書きは
// 全部フロント（TypeScript）にあり、Rust が担うのは「ウィンドウを出す」ことと
// 「ファイルとダイアログの口を開ける」ことだけ。
//
// OS の WebView（Windows なら WebView2）を使うのでブラウザエンジンを同梱しない。
// Bun compile 版はランタイム本体だけで 84MB あり、それが配布時の AV スキャン待ちを
// 悪化させていた。

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
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![allow_vault])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
