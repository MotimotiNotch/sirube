// Tauri 版のエントリポイント。
//
// dev 版（`src/dev/main.ts`）との差は `SirubeFs` の実装だけ。UI もエンジンも
// ストアも一切変わらない——「ストアのインターフェースを1箇所に閉じる」と
// 決めておいた分がここで効く。

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { startApp } from "../ui/app.ts";
import { toast } from "../ui/dom.ts";
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
  box.style.cssText = "padding:32px;font-family:sans-serif;line-height:1.8;white-space:pre-wrap";
  box.textContent = message;
  document.body.append(box);
}

const vault = await resolveVault();
if (!vault) {
  showFatal("フォルダが選ばれなかったため起動できませんでした。ウィンドウを閉じてもう一度開いてください。");
} else {
  try {
    // fs プラグインのスコープに vault を入れてから触る。これを飛ばすと読み書きが
    // 全部 `forbidden path` で落ちる。capabilities の権限一覧はコマンドの可否しか
    // 決めておらず、パスの可否は別に許可が要る（2026-08-31 の初回起動で踏んだ）。
    // スコープは再起動で消えるので、保存済みパスからの復帰でも毎回通る。
    await invoke("allow_vault", { path: vault });

    const fs = new TauriFs(vault);
    await fs.ensureLayout();
    const app = await startApp(fs);

    // 外部からの変更（エディタ・Obsidian・エージェント・git のマージ）を拾って
    // 読み直す。デバウンス付きなので git checkout のような一斉変更でも
    // リロード嵐にならない。
    //
    // 監視が張れなくてもノードの閲覧・編集はできるので、ここで起動ごと殺さない。
    // ただし黙って落とすのも危険で、裏でファイルが変わったのに画面が古いと次の
    // 保存で他人の変更を上書きしうる。効いていないことは必ず画面に出す。
    try {
      await fs.watchNodes(() => {
        void app.reload();
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast(`外部変更の自動反映が使えません（${detail}）。編集したら手動で開き直してください。`);
    }
  } catch (err) {
    // 黙って空の画面を出さない。「フォルダを間違えた」と「まだ何も無い」が
    // 区別できない状態こそが、この起動で一番時間を溶かしたものだった。
    const detail = err instanceof Error ? err.message : String(err);
    showFatal(`vault を開けませんでした。

${vault}

${detail}`);
  }
}
