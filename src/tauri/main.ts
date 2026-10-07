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
import { getVersion } from "@tauri-apps/api/app";
import { formatCrumbs, installCrashCapture } from "../ui/crash.ts";
import { showCrashNotice } from "./crash-notice.ts";
import { currentResolvedTheme, initTheme, onThemeApplied, THEME_BG } from "../ui/theme.ts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initLang } from "../i18n/index.ts";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { resolveResource } from "@tauri-apps/api/path";
import { routeExternalLinks } from "../ui/external-links.ts";
import { m } from "../i18n/index.ts";

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
 * データは丸ごとそのフォルダの中で完結する（`nodes/*.md` と、アプリが作り直す入口ファイル）。
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
  return pickVault(m.crash.pickVaultFirst);
}

/** 開くフォルダを入れ替える（Obsidian の vault 切り替えと同じ形）。
 *
 * 差し替えではなく読み込み直し。ストア・エンジン・インデックスは全部起動時に
 * 組み上がるので、途中で fs だけ挿し替えると古い状態がどこかに残る。
 * キャンセルされたときは何もしない——保存済みのパスも書き換えない。 */
async function switchVault(): Promise<void> {
  const picked = await pickVault(m.crash.pickVaultSwitch);
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
  // 窓を作った瞬間から今のテーマの色にしておく（既定の白で光らないように）。
  const theme = currentResolvedTheme();
  const w = new WebviewWindow(label, {
    url: `index.html${buildWindowQuery(target, vault)}`,
    title: "Sirube",
    theme,
    backgroundColor: THEME_BG[theme],
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 560,
  });
  void w.once("tauri://error", (e) => {
    toast(m.crash.windowFailed(String(e.payload)));
  });
}

function showFatal(message: string): void {
  document.body.replaceChildren();
  const box = document.createElement("div");
  box.style.cssText = "padding:32px;font-family:sans-serif;line-height:1.8;white-space:pre-wrap";
  box.textContent = message;
  document.body.append(box);
}

// 窓のタイトルバーと背景も、アプリの中で選んだテーマにそろえる（2026-10-07）。
// 何もしないと OS の設定に従うので、OS がライトでアプリだけダークにすると、白い
// タイトルバーの下に暗い画面が来る。initTheme() の最初の適用でも呼ばれるよう先に登録する。
onThemeApplied((theme) => {
  const win = getCurrentWindow();
  void win.setTheme(theme).catch(() => {});
  void win.setBackgroundColor(THEME_BG[theme]).catch(() => {});
});
initTheme(); // vault を読む前に（読み込み中ずっとライトで光らないように）
initLang(); // 描画より前に辞書を決める（フォルダ選択の文言もこれに従う）
routeExternalLinks(openUrl); // メモやマニュアルのリンクは既定のブラウザで

const query = parseWindowQuery(location.search);

// 異常終了の記録（2026-10-05）。**何より先に張る**——vault を開く途中で落ちても拾うため。
// 書き出しは本体（`crash.rs`）。外へは送らない。
const version = await getVersion().catch(() => undefined);
const crumbs = installCrashCapture({
  window: query.sub ? "別窓" : "本窓",
  version,
  sink: (_report, text) => {
    void invoke("record_crash", { body: text }).catch(() => {});
  },
});
// 固まったかの見張りへの生存通知。本窓だけ（本体も本窓しか見ていない）。
// 直前の操作は変わったときだけ載せる——2秒おきに20件を毎回送る理由が無い。
if (!query.sub) {
  let sent = -1;
  setInterval(() => {
    const changed = crumbs.revision !== sent;
    sent = crumbs.revision;
    void invoke("heartbeat", { crumbs: changed ? formatCrumbs(crumbs.list()) : null }).catch(() => {});
  }, 2000);
}
// サブ窓は本窓から vault を受け取る。localStorage からは読まない——本窓が後で
// 切り替えても、この窓は開いたときのフォルダのまま（切り替えたら本窓が閉じる）。
// 掲示板も本窓だけが書く。
const vault = query.sub ? query.vault : await resolveVault();
if (vault && !query.sub) void publishVaultPointer(vault);
if (!vault) {
  showFatal(m.crash.noVault);
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
    // 同梱のライセンス表記（bundle.resources）を既定のアプリで開く。開ける場所は
    // capabilities の opener:allow-open-path でこの1ファイルに絞ってある。
    options.openLicenses = async () => openPath(await resolveResource("THIRD_PARTY_LICENSES.txt"));
    const app = await startApp(fs, options);

    // 前回までの記録を出す。本窓だけ（別窓で出すと、同じものを取り合う）。
    if (!query.sub) {
      const reports = await invoke<{ name: string; body: string }[]>("take_crash_reports").catch(() => []);
      if (reports.length > 0) showCrashNotice(reports);
    }

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
      toast(m.crash.watchFailed(detail));
    }
  } catch (err) {
    // 黙って空の画面を出さない。「フォルダを間違えた」と「まだ何も無い」が
    // 区別できない状態こそが、この起動で一番時間を溶かしたものだった。
    const detail = err instanceof Error ? err.message : String(err);
    showFatal(m.crash.openFailed(vault, detail));
  }
}
