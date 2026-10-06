// 画面の文言の言語（2026-10-06、のっち依頼）。日本語と英語の2つ。
//
// 使い方は `import { m } from "../i18n/index.ts"` して `m.app.undo` のように引く。
// `m` は ES モジュールの live binding で、言語を決めると差し替わる。文言を
// モジュールの読み込み時に定数へ写すと差し替えが届かないので、**使う場所で毎回
// `m.…` を引く**こと。
//
// 範囲は画面の文言だけ。アプリ内マニュアル・AGENTS.md・vault に書き出す生成物
// （MOC・達成済み一覧）は日本語のまま——vault の中身は言語を跨いで共有されるので、
// 誰の言語で開いたかで書き出す内容が変わってはいけない。
//
// 選んだ値は theme.ts と同じくアプリ側（localStorage）に置く。既定は OS（WebView の
// navigator.language）に合わせる。途中で変えたら窓ごと読み直す——描き終えた画面の
// 文言を1つずつ差し替える経路は作らない（漏れたところだけ古い言語で残るので）。
//
// 用語の対応（英語を足すときはここに揃える）:
//   ノード node / 目的 goal / 前提 prerequisite / 中身 part / 今やれる ready /
//   前提待ち waiting / 達成済み done / 待ち合って一周している cycle /
//   合流 shared / 分解する break down / まとめて書く bulk add / 自動解決 auto-fix /
//   戻す undo / 外す detach / 付箋 color tag / 期限 due date / メモ note /
//   地図 map / 俯瞰 overview / 一覧 list / 最近の変更 recent changes /
//   詳細パネル details panel / 使い方 help / 表示 appearance / 別窓 new window /
//   フォルダ（vault） folder / 達成にする mark as done / 隠す hide
// 文体: ボタンは動詞の原形で頭だけ大文字（"Mark as done"）、メッセージは文で終止符あり。

import { ja } from "./ja/index.ts";
import { en } from "./en/index.ts";
import type { Messages } from "./shape.ts";

export type Lang = "ja" | "en";
export type LangPref = "system" | Lang;

export const LANG_KEY = "sirube.lang";

const DICTS: Record<Lang, Messages> = { ja, en };

/** 今の言語の辞書。既定は日本語（テストはこのまま日本語で走る）。 */
export let m: Messages = ja;

let pref: LangPref = "system";

const isPref = (v: unknown): v is LangPref => v === "system" || v === "ja" || v === "en";

export function readLangPref(): LangPref {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

/** OS の言語。日本語なら日本語、それ以外は英語。 */
export function systemLang(): Lang {
  const langs = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
  return langs[0]?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function resolveLang(p: LangPref): Lang {
  return p === "system" ? systemLang() : p;
}

/** 辞書を差し替える。画面は描き直さない（呼ぶのは描画の前か、テストから）。 */
export function setLang(lang: Lang): void {
  m = DICTS[lang];
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}

export function currentLang(): Lang {
  return m === en ? "en" : "ja";
}

export function currentLangPref(): LangPref {
  return pref;
}

/**
 * 保存されている設定を読んで辞書を決める。**描画より前に呼ぶ**。別の窓で
 * 言語が変わったら、この窓も読み直す。
 */
export function initLang(): void {
  pref = readLangPref();
  setLang(resolveLang(pref));
  window.addEventListener("storage", (e) => {
    if (e.key !== LANG_KEY && e.key !== null) return;
    if (resolveLang(readLangPref()) !== currentLang()) location.reload();
  });
}

/** 選び直して覚える。言語が変わるなら窓ごと読み直す（`reload` はテスト用に差し替えられる）。 */
export function setLangPref(next: LangPref, reload: () => void = () => location.reload()): void {
  const before = currentLang();
  pref = next;
  try {
    if (next === "system") localStorage.removeItem(LANG_KEY);
    else localStorage.setItem(LANG_KEY, next);
  } catch {
    // 書けなければ次の起動で OS に戻るだけ。
  }
  if (resolveLang(next) !== before) reload();
}
