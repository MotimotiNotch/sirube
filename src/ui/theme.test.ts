import { beforeEach, describe, expect, test } from "bun:test";
import { ensureDom } from "./test-dom.ts";

ensureDom();

const { initTheme, readThemePref, setThemePref, THEME_KEY } = await import("./theme.ts");

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  test("何も保存されていなければ OS に合わせる", () => {
    expect(readThemePref()).toBe("system");
  });

  test("壊れた値は OS に合わせる扱い", () => {
    localStorage.setItem(THEME_KEY, "purple");
    expect(readThemePref()).toBe("system");
  });

  test("起動時に保存された設定を当てる", () => {
    localStorage.setItem(THEME_KEY, "dark");
    initTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  test("OS に合わせるときも、data-theme は light か dark に解決される", () => {
    setThemePref("system");
    expect(["light", "dark"]).toContain(document.documentElement.dataset.theme!);
  });

  test("別の窓で切り替わったら追随する（storage イベント）", () => {
    initTheme();
    setThemePref("light");
    expect(document.documentElement.dataset.theme).toBe("light"); // 陽性対照
    localStorage.setItem(THEME_KEY, "dark"); // 本窓が書いた
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
