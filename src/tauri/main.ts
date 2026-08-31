// Tauri 版のエントリポイント。
//
// dev 版（`src/dev/main.ts`）との差は `SirubeFs` の実装だけ。UI もエンジンも
// ストアも一切変わらない——「ストアのインターフェースを1箇所に閉じる」と
// 決めておいた分がここで効く。

import { open } from "@tauri-apps/plugin-dialog";
import { startApp } from "../ui/app.ts";
import { TauriFs } from "../store/tauri-fs.ts";

const VAULT_KEY = "sirube.vaultPath";

/** 使う vault フォルダを決める。初回はフォルダ選択ダイアログを出す。
 *
 * データは丸ごとそのフォルダの中で完結する（`nodes/*.md` と `.sirube/`）。
 * Git で共有するのも Obsidian で開くのも、このフォルダ単位。 */
async function resolveVault(): Promise<string | undefined> {
  const saved = localStorage.getItem(VAULT_KEY);
  if (saved) return saved;

  const picked = await open({
    directory: true,
    multiple: false,
    title: "Sirube のデータを置くフォルダを選んでください",
  });
  if (typeof picked !== "string") return undefined;
  localStorage.setItem(VAULT_KEY, picked);
  return picked;
}

function showFatal(message: string): void {
  document.body.replaceChildren();
  const box = document.createElement("div");
  box.style.cssText = "padding:32px;font-family:sans-serif;line-height:1.8";
  box.textContent = message;
  document.body.append(box);
}

const vault = await resolveVault();
if (!vault) {
  showFatal("フォルダが選ばれなかったため起動できませんでした。ウィンドウを閉じてもう一度開いてください。");
} else {
  const fs = new TauriFs(vault);
  await fs.ensureLayout();
  const app = await startApp(fs);

  // 外部からの変更（エディタ・Obsidian・エージェント・git のマージ）を拾って
  // 読み直す。デバウンス付きなので git checkout のような一斉変更でも
  // リロード嵐にならない。
  await fs.watchNodes(() => {
    void app.reload();
  });
}
