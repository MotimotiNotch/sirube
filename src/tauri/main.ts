// Tauri 版のエントリポイント。
//
// dev 版（`src/dev/main.ts`）との差は `SirubeFs` の実装だけ。UI もエンジンも
// ストアも一切変わらない——「ストアのインターフェースを1箇所に閉じる」と
// 決めておいた分がここで効く。

import { invoke } from "@tauri-apps/api/core";
import { getAllWebviewWindows, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open } from "@tauri-apps/plugin-dialog";
import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";
import { startApp, type AppOptions, type WindowTarget } from "../ui/app.ts";
import { toast } from "../ui/dom.ts";
import { TauriFs } from "../store/tauri-fs.ts";
import { buildWindowQuery, parseWindowQuery } from "../ui/window-query.ts";

const VAULT_KEY = "sirube.vaultPath";
/** 今どの vault を開いているかを、**アプリの外から読める場所**に置くファイル。
 *
 * 書き込みの入口は「人間はアプリから、AI はファイルを直接」と決めた（2026-09-02）
 * が、**AI 側は vault の場所を知る手段が無かった**。`VAULT_KEY` は WebView の
 * localStorage にあり、実体は WebView2 の LevelDB なので外からは読めない。
 *
 * 中身はパス1行だけ。アプリはこれを**読まない**（読むと第二の真実になる。正は
 * localStorage）——外向きの掲示板として書くだけ。 */
const VAULT_POINTER = "vault-path.txt";

/** 使う vault フォルダを決める。初回はフォルダ選択ダイアログを出す。
 *
 * データは丸ごとそのフォルダの中で完結する（`nodes/*.md` と `.sirube/`）。
 * Git で共有するのも Obsidian で開くのも、このフォルダ単位。 */
async function pickVault(title: string): Promise<string | undefined> {
  const picked = await open({ directory: true, multiple: false, title });
  if (typeof picked !== "string") return undefined;
  localStorage.setItem(VAULT_KEY, picked);
  return picked;
}

/** 外向きの掲示板を書く。**失敗しても起動は止めない**——これが無くて困るのは
 *  AI が場所を探すときだけで、人間の操作には一切関係しないため。 */
async function publishVaultPointer(path: string): Promise<void> {
  try {
    // フォルダ自体は WebView が先に作っている（このコードは WebView の中で
    // 動いているので、プロファイルの置き場は必ず存在する）。mkdir は要らない。
    await writeTextFile(VAULT_POINTER, `${path}
`, { baseDir: BaseDirectory.AppLocalData });
  } catch {
    // 握りつぶす。ここで転ぶと「vault は開けるのにアプリが起動しない」になる。
  }
}

async function resolveVault(): Promise<string | undefined> {
  const saved = localStorage.getItem(VAULT_KEY);
  if (saved) return saved;
  return pickVault("Sirube のデータを置くフォルダを選んでください");
}

/** 開くフォルダを入れ替える（Obsidian の vault 切り替えと同じ形）。
 *
 * 差し替えではなく読み込み直し。ストア・エンジン・インデックスは全部起動時に
 * 組み上がるので、途中で fs だけ挿し替えると古い状態がどこかに残る。
 * キャンセルされたときは何もしない——保存済みのパスも書き換えない。 */
async function switchVault(): Promise<void> {
  const picked = await pickVault("開くフォルダを選んでください");
  if (!picked) return;
  // サブ窓は開いたときの vault を指し続けるので、残すと別のフォルダの窓が並ぶ。
  await closeSubWindows();
  location.reload();
}

/** 本窓（Tauri の既定の窓）の名札。これ以外はサブ窓。 */
const MAIN_LABEL = "main";

async function closeSubWindows(): Promise<void> {
  for (const w of await getAllWebviewWindows()) {
    if (w.label !== MAIN_LABEL) await w.destroy().catch(() => {});
  }
}

/** 窓の名札の通し番号。同じミリ秒に2回押されても名札がぶつからないように。 */
let windowSeq = 0;

/** 別窓を開く（2026-09-28）。中身は同じアプリで、起動引数だけが違う
 *  （`window-query.ts`）。名札は capabilities の `sub-*` に合わせる——
 *  合わない名札の窓は、ファイルの読み書きの権限を持たずに開く。 */
function openWindow(target: WindowTarget, vault: string): void {
  const label = `sub-${Date.now().toString(36)}-${windowSeq++}`;
  const w = new WebviewWindow(label, {
    url: `index.html${buildWindowQuery(target, vault)}`,
    title: "Sirube",
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 560,
  });
  void w.once("tauri://error", (e) => {
    toast(`別窓を開けませんでした（${String(e.payload)}）`);
  });
}

function showFatal(message: string): void {
  document.body.replaceChildren();
  const box = document.createElement("div");
  box.style.cssText = "padding:32px;font-family:sans-serif;line-height:1.8;white-space:pre-wrap";
  box.textContent = message;
  document.body.append(box);
}

const query = parseWindowQuery(location.search);
// サブ窓は本窓から vault を受け取る。localStorage からは読まない——本窓が後で
// 切り替えても、この窓は開いたときのフォルダのまま（切り替えたら本窓が閉じる）。
// 掲示板も本窓だけが書く。
const vault = query.sub ? query.vault : await resolveVault();
if (vault && !query.sub) void publishVaultPointer(vault);
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
    const options: AppOptions = query.sub
      ? { vault: { path: vault }, sub: query.initial ? { initial: query.initial } : {} }
      : { vault: { path: vault, switchVault } };
    options.openWindow = (target) => openWindow(target, vault);
    const app = await startApp(fs, options);

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
