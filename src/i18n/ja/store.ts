// 日本語（正）。英語は ../en/store.ts。
//
// ストアが投げるエラーと、読み込み時の問題の報告、戻すのラベル。
// 戻すのラベルは「〜を戻す」「〜を戻しました」に入る名詞句（英語は動名詞句）。
// 生成物のパスの検査（fs.ts / tauri-fs.ts）と ULID の採番失敗は、コードの誤りで
// しか起きない内部の見張りなので訳さない。

export const store = {
  unreadable: "ファイルを読めませんでした",
  renumbered: (number: number, owner: string) => `番号 #${number} が「${owner}」と重複していたので振り直しました`,
  nameClash: (name: string) => `「${name}」と同じ名前になります`,
  mintFailed: (attempts: number, detail: string) => `ノード id を ${attempts} 回採番できませんでした${detail}`,
  undoDelete: (name: string) => `「${name}」の削除`,
  undoDetach: (parent: string, child: string) => `「${parent}」から「${child}」を外したの`,
  undoShortcuts: (n: number) => `近道 ${n} 本を外したの`,
  linkGone: "その繋がりはもうありません",
  nameRequired: "名前を入れてください",
  ambiguousRef: (ref: string, n: number) => `「${ref}」に一致するノードが ${n} 件あるため解決できません`,
  notUlidFileName: (name: string) => `ファイル名が id の形式ではありません（名前「${name}」が別に書かれています）`,
};
