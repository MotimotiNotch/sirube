// Sirube のネイティブ側。
//
// ここはシェルでしかない。状態導出・カスケード・循環検出・Markdown の読み書きは
// 全部フロント（TypeScript）にあり、Rust が担うのは「ウィンドウを出す」ことと
// 「ファイルとダイアログの口を開ける」ことだけ。
//
// OS の WebView（Windows なら WebView2）を使うのでブラウザエンジンを同梱しない。
// Bun compile 版はランタイム本体だけで 84MB あり、それが配布時の AV スキャン待ちを
// 悪化させていた。

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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
