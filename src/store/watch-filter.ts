// ファイル監視の出来事のうち、読み直しの合図にするものを選ぶ（2026-09-28）。
//
// Linux の inotify（notify 8.2）は、ファイルを**開いただけ**でも出来事を出す
// （`WatchMask::OPEN` → `access: open`、読んで閉じれば `access: close / read`）。
// 種類を見ずに読み直すと、読み直しで `nodes/*.md` を開く → 出来事 → また読み直す、
// が止まらない。0.4 秒ごとに詳細パネルが作り直され、押している間に作り直しが
// 挟まったクリックが消えていた（Bazzite の友人の報告「分解するボタンの判定が
// 小さい」）。Windows は読んだだけでは報告しないので手元では出ない。
//
// 型は tauri-plugin-fs の `WatchEvent['type']` と同じ形。ここでは import しない
// （テストから Tauri を読まずに済ませるため）。

type Kind = { kind: string; mode?: string };
export type WatchEventType = "any" | "other" | { access: Kind } | { create: Kind } | { modify: Kind } | { remove: Kind };

/** 中身が変わった（かもしれない）出来事か。**分からないものは読み直す側に倒す**——
 *  取りこぼすと、外で書き換わったのに画面が古いまま次の保存で上書きしうる。 */
export function isContentChange(type: WatchEventType): boolean {
  if (typeof type === "string") return true; // any / other
  if ("access" in type) {
    // 書き込んで閉じた（CLOSE_WRITE）は、書き込みが終わった合図なので拾う。
    return type.access.kind === "close" && type.access.mode === "write";
  }
  if ("modify" in type) {
    // mtime は自動解決の材料なので、メタデータの変更は拾う。アクセス時刻だけは捨てる。
    return !(type.modify.kind === "metadata" && type.modify.mode === "access-time");
  }
  return true; // create / remove
}
