// 日本語（正）。英語は ../en/crash.ts。
//
// 異常終了の知らせ（tauri/crash-notice.ts）と、起動まわりの画面（tauri/main.ts）。
// 記録ファイルの中身（ui/crash.ts の formatReport）は開発者向けなので訳さない。

export const crash = {
  noticeAria: "異常終了の記録",
  noticeTitle: (n: number) => (n === 1 ? "前回、異常が記録されました" : `前回までに、異常が ${n} 件記録されました`),
  noticeLead: "画面が止まった・消えたときの記録です。外へは送っていません。直すときに全文をコピーして渡してください。",
  copyAll: "全文をコピー",
  copied: "記録をコピーしました",
  copyFailed: "コピーできませんでした。下の全文を選んでコピーしてください",
  show: "中身を見る",
  hide: "中身を隠す",
  close: "閉じる",
  pickVaultFirst: "Sirube のデータを置くフォルダを選んでください",
  pickVaultSwitch: "開くフォルダを選んでください",
  windowFailed: (detail: string) => `別窓を開けませんでした（${detail}）`,
  noVault: "フォルダが選ばれなかったため起動できませんでした。ウィンドウを閉じてもう一度開いてください。",
  watchFailed: (detail: string) => `外部変更の自動反映が使えません（${detail}）。編集したら手動で開き直してください。`,
  openFailed: (vault: string, detail: string) => `vault を開けませんでした。

${vault}

${detail}`,
};
