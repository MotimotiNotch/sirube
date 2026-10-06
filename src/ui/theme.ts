// ライトとダークの切り替え（2026-10-06、のっち依頼）。
//
// 以前は OS の設定（`prefers-color-scheme`）に従うだけで、アプリの中で選ぶ
// 手段が無かった。選べるのは「OS に合わせる / ライト / ダーク」の3つで、
// 既定は今までどおり OS に合わせる。
//
// **色の値は style.css の `:root[data-theme="dark"]` 1か所にだけ置く。**
// `@media (prefers-color-scheme: dark)` を残したまま上書き用のブロックを足すと、
// 同じ値の束が2つになり、片方だけ直したときにずれる。代わりに「OS に合わせる」も
// ここで matchMedia を引いて `data-theme` に解決する——CSS から見えるのは常に
// light か dark のどちらかだけ。
//
// 選んだ値は vault ではなくアプリ側（localStorage）に置く。見た目は人と機械の
// 好みで、vault を共有する相手に持ち込むものではない。

export type ThemePref = "system" | "light" | "dark";

export const THEME_KEY = "sirube.theme";

const isPref = (v: unknown): v is ThemePref => v === "system" || v === "light" || v === "dark";

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system"; // 読めなければ今までどおり OS に合わせる
  }
}

function writeThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // 書けなければ次の起動で OS に戻るだけ。今の窓の見た目は変わっている。
  }
}

function systemDark(): MediaQueryList | undefined {
  // テストの DOM や古い WebView には無いことがある。無ければライト扱い。
  return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : undefined;
}

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return systemDark()?.matches ? "dark" : "light";
}

let current: ThemePref = "system";

function apply(): void {
  document.documentElement.dataset.theme = resolve(current);
}

export function currentThemePref(): ThemePref {
  return current;
}

/**
 * 保存されている設定を読んで当てる。**描画より前、vault の読み込みより前に呼ぶ**
 * ——読み込みには時間がかかることがあり、その間ずっとライトで光ると、ダークを
 * 選んだ意味が無くなる。
 *
 * OS の切り替えと、別の窓での切り替えにも追随する。サブ窓は設定を書かない
 * （`AppOptions.sub`）が、本窓が書いたものは `storage` イベントで届く。
 */
export function initTheme(): void {
  current = readThemePref();
  apply();
  systemDark()?.addEventListener("change", () => {
    if (current === "system") apply();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== THEME_KEY && e.key !== null) return;
    current = readThemePref();
    apply();
  });
}

/** 選び直す。今の窓に当てて、覚えておく。 */
export function setThemePref(pref: ThemePref): void {
  current = pref;
  writeThemePref(pref);
  apply();
}
