// テストで happy-dom を使うための入口。**登録はプロセスに1回だけ。**
//
// `GlobalRegistrator.register()` を各テストファイルの先頭で呼ぶと、2つ目の
// ファイルで「Failed to register. Happy DOM has already been globally
// registered.」が投げられる（bun はテストファイルを同じプロセスに載せる）。
// **手元では読み込み順の都合で通り、CI で落ちた**——順番に依存して結果が変わる
// ものなので、順番に依存しない形にしておく（2026-09-12）。

import { GlobalRegistrator } from "@happy-dom/global-registrator";

let registered = false;

/** DOM が無ければ用意する。何度呼んでもよい。 */
export function ensureDom(): void {
  if (registered) return;
  registered = true;
  // 既に誰かが用意していることもある（このモジュールを通らない経路が将来
  // 生えたとき用）。二重登録の例外はここで飲まず、そもそも呼ばない。
  if (typeof globalThis.document === "undefined") GlobalRegistrator.register();
}
