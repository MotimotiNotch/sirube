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

const { bootTheme, onThemeApplied, THEME_BG } = await import("./theme.ts");

describe("起動直後のテーマ（2026-10-07）", () => {
  test("bootTheme は保存された設定を、initTheme を待たずに当てる", () => {
    localStorage.setItem(THEME_KEY, "dark");
    bootTheme();
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.setItem(THEME_KEY, "light");
    bootTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("index.html は theme-boot.js を <head> で同期に、CSS より前に読む", async () => {
    const html = await Bun.file("index.html").text();
    const head = html.slice(0, html.indexOf("</head>"));
    const script = head.indexOf('<script src="/theme-boot.js"></script>');
    expect(script).toBeGreaterThan(-1); // type="module" や defer を付けると、描画の後に回る
    expect(script).toBeLessThan(head.indexOf('<link rel="stylesheet"'));
  });

  test("ビルドが theme-boot.js を dist に焼く（index.html が参照する）", async () => {
    const build = await Bun.file("scripts/build-web.ts").text();
    expect(build).toContain("./src/ui/theme-boot.ts");
    expect(build).toContain("theme-boot.js");
  });

  test("窓の背景に塗る色は style.css の --bg と同じ", async () => {
    const css = await Bun.file("src/ui/style.css").text();
    const light = /:root\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    const dark = /:root\[data-theme="dark"\]\s*\{[^}]*?--bg:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(light).toBeDefined(); // 陽性対照
    expect(THEME_BG.light).toBe(light!);
    expect(THEME_BG.dark).toBe(dark!);
  });

  test("Rust 側（本窓の最初の背景）も同じ色", async () => {
    const rs = await Bun.file("src-tauri/src/lib.rs").text();
    const hex = (c: string) => c.slice(1).match(/../g)!.map((b) => `0x${b}`).join(", ");
    expect(rs).toContain(`Color(${hex(THEME_BG.dark)}, 0xff)`);
    expect(rs).toContain(`Color(${hex(THEME_BG.light)}, 0xff)`);
  });

  test("テーマを当てるたびに、シェルに解決済みの値を知らせる（タイトルバーをそろえる口）", () => {
    const seen: string[] = [];
    onThemeApplied((t) => seen.push(t));
    setThemePref("dark");
    setThemePref("light");
    expect(seen.slice(-2)).toEqual(["dark", "light"]);
  });
});
