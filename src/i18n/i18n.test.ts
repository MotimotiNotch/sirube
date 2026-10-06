import { afterEach, describe, expect, test } from "bun:test";
import { ensureDom } from "../ui/test-dom.ts";

ensureDom();

const { ja } = await import("./ja/index.ts");
const { en } = await import("./en/index.ts");
const i18n = await import("./index.ts");
const { LANG_KEY, currentLang, readLangPref, resolveLang, setLang, setLangPref } = i18n;

const JAPANESE = /[\u3040-\u30ff\u4e00-\u9fff]/;

/** 関数の文言は、ありそうな引数で呼んで文字列にする。引数の型は実行時に分からないので、
 *  数（1 と 2、単複の両方）・名前（"X"）・名前の配列で順に試し、通ったものをすべて見る。 */
function render(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (typeof v !== "function") return [String(v)];
  const f = v as (...a: unknown[]) => unknown;
  const n = Math.max(f.length, 1);
  const out: string[] = [];
  for (const arg of [1, 2, "X", ["X", "Y"]]) {
    try {
      out.push(String(f(...Array(n).fill(arg))));
    } catch {
      // この引数の型ではない。次を試す
    }
  }
  if (out.length === 0) throw new Error(`呼べる引数が見つからない: ${f.toString().slice(0, 80)}`);
  return out;
}

describe("辞書（2026-10-06）", () => {
  afterEach(() => {
    setLang("ja");
    localStorage.clear();
  });

  test("英語の辞書は日本語と同じキーを持つ", () => {
    for (const ns of Object.keys(ja) as (keyof typeof ja)[]) {
      expect(Object.keys(en[ns]).sort()).toEqual(Object.keys(ja[ns]).sort());
    }
  });

  test("英語の文言に日本語が混ざっていない", () => {
    const leaks: string[] = [];
    for (const [ns, dict] of Object.entries(en)) {
      for (const [k, v] of Object.entries(dict)) {
        for (const s of render(v)) if (JAPANESE.test(s)) leaks.push(`${ns}.${k}: ${s}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  test("陽性対照: 日本語の辞書は上の検出に掛かる", () => {
    const hits = Object.values(ja).flatMap((d) => Object.values(d).flatMap(render)).filter((s) => JAPANESE.test(s));
    expect(hits.length).toBeGreaterThan(0);
  });

  test("既定は日本語で、setLang で差し替わる（live binding）", () => {
    expect(currentLang()).toBe("ja");
    expect(i18n.m).toBe(ja);
    setLang("en");
    expect(i18n.m).toBe(en);
    expect(document.documentElement.lang).toBe("en");
  });

  test("OS が日本語なら日本語、それ以外は英語", () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, "languages");
    const set = (v: string[]) => Object.defineProperty(navigator, "languages", { value: v, configurable: true });
    try {
      set(["ja-JP"]);
      expect(resolveLang("system")).toBe("ja");
      set(["en-US", "ja"]);
      expect(resolveLang("system")).toBe("en");
      expect(resolveLang("ja")).toBe("ja");
    } finally {
      if (orig) Object.defineProperty(navigator, "languages", orig);
      else delete (navigator as { languages?: unknown }).languages;
    }
  });

  test("選び直すと覚え、言語が変わるときだけ読み直す", () => {
    let reloads = 0;
    const reload = () => reloads++;
    setLangPref("ja", reload); // 今が日本語なので読み直さない
    expect(reloads).toBe(0);
    expect(localStorage.getItem(LANG_KEY)).toBe("ja");
    setLangPref("en", reload);
    expect(reloads).toBe(1);
    expect(readLangPref()).toBe("en");
    setLangPref("system", reload);
    expect(localStorage.getItem(LANG_KEY)).toBeNull();
  });
});
