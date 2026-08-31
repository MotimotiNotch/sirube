// UI の smoke テスト。happy-dom 上に実際にアプリをマウントして、
// 描画・トグル・分解・自動解決が例外なく通り、画面に意図した文字が出ることを見る。
//
// 実機の見た目・操作感は別途のっちが確認する（AI の確認だけで「完了」と
// 言い切らない運用）。ここで担保するのは「壊れていないこと」まで。

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

GlobalRegistrator.register();

const { startApp } = await import("./app.ts");
const { sampleFs } = await import("../dev/sample.ts");
// UI テストはメモリ FS を使う（dev サーバに依存させない）。

const HTML = `
<header class="app-header"><div class="brand" id="brand"></div>
  <div class="search-wrap"><span class="search-icon" id="search-icon"></span>
  <input id="search-input" type="search" /></div>
  <button class="btn" id="reconcile-btn" type="button"></button></header>
<main class="app-body">
  <aside class="sidebar"><button class="nav-item" id="nav-actionable" type="button"></button>
    <div id="root-list" class="root-list"></div></aside>
  <section class="center"><nav class="breadcrumb" id="breadcrumb"></nav>
    <div class="center-body" id="center-body"></div></section>
  <aside class="inspector" id="inspector"></aside>
</main>
<div class="modal-backdrop hidden" id="modal-backdrop"><div class="modal" id="modal"></div></div>
<div class="toast-stack" id="toast-stack"></div>`;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const text = (id: string): string => $(id).textContent ?? "";
const buttonsIn = (id: string): HTMLButtonElement[] => Array.from($(id).querySelectorAll("button")) as HTMLButtonElement[];
const findButton = (id: string, label: string): HTMLButtonElement | undefined =>
  buttonsIn(id).find((b) => (b.textContent ?? "").includes(label));
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  document.body.innerHTML = HTML;
  await startApp(sampleFs());
});

afterAll(() => {
  void GlobalRegistrator.unregister();
});

describe("起動直後", () => {
  test("「今やれること」が中央に出る", () => {
    expect(text("breadcrumb")).toContain("今やれること");
    expect(text("center-body")).toContain("今やれること");
  });

  test("サイドバーに目的（入次数0）が並ぶ", () => {
    const labels = buttonsIn("root-list").map((b) => b.textContent ?? "");
    expect(labels.some((l) => l.includes("Sirube をリリースする"))).toBe(true);
    expect(labels.some((l) => l.includes("確定申告"))).toBe(true);
    // 輪の中のノードは誰かから参照されているのでルートではない
    expect(labels.some((l) => l.includes("実績を作る"))).toBe(false);
  });

  test("詰まっている輪が理由として提示される", () => {
    const body = text("center-body");
    expect(body).toContain("2つに分かれるノードがあるかもしれません");
    expect(body).toContain("実績を作る");
    // 「切れ」ではなく「割れ」を出す
    expect(body).toContain("割る");
    expect(body).not.toContain("切断してください");
  });

  test("今やれることに輪のノードは出ず、無関係な生活タスクは出る", () => {
    const body = text("center-body");
    expect(body).toContain("領収書整理");
    expect(body).toContain("Rustツールチェーンを入れる");
  });
});

describe("検索", () => {
  test("本文にしか無い語でも引ける", async () => {
    const input = $("search-input") as HTMLInputElement;
    input.value = "WebView2";
    input.dispatchEvent(new Event("input"));
    await tick();
    expect(text("center-body")).toContain("Tauriシェル");
  });

  test("一致ノードの隣接が一緒に出る（単語を思い出せなくても辿れる）", async () => {
    const input = $("search-input") as HTMLInputElement;
    input.value = "Tauri";
    input.dispatchEvent(new Event("input"));
    await tick();
    const body = text("center-body");
    expect(body).toContain("Tauriシェル");
    // 打っていない語が文脈として現れる
    expect(body).toContain("Rustツールチェーンを入れる");
    expect(body).toContain("これが必要");
  });
});

describe("ドリルダウンとインスペクタ", () => {
  test("目的を選ぶとグラフに入り、パンくずが積まれる", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    expect(text("breadcrumb")).toContain("Sirube をリリースする");
    expect($("center-body").querySelector("svg")).toBeTruthy();
    expect(text("inspector")).toContain("Sirube をリリースする");
  });

  test("インスペクタから達成にすると前提まで連動する", async () => {
    // 事前: 領収書整理は「今やれること」に出ている
    expect(text("center-body")).toContain("領収書整理");

    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    expect(text("inspector")).toContain("達成を取り消す");

    // 確定申告を達成にすると前提の領収書整理も達成になる（requires の意味論）。
    // 「今やれること」に戻すと、もう出てこない。
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).not.toContain("領収書整理");
  });

  test("輪の上のノードを開くと「割る」案内が出る", async () => {
    const chip = Array.from($("center-body").querySelectorAll("button")).find((b) => b.textContent === "実績を作る");
    (chip as HTMLButtonElement).click();
    await tick();
    expect(text("inspector")).toContain("輪の上にいます");
    expect(text("inspector")).toContain("2つに割る");
  });
});

describe("前提の一括追加", () => {
  test("改行リストから複数の前提が作られ、グラフに反映される", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "前提を一括追加")!.click();
    await tick();
    expect($("modal-backdrop").classList.contains("hidden")).toBe(false);

    const ta = $("modal").querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "マイナンバーカードを用意する\n医療費の領収書を集める";
    ta.dispatchEvent(new Event("input"));
    findButton("modal", "追加")!.click();
    await tick();

    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    expect(text("inspector")).toContain("マイナンバーカードを用意する");
    expect(text("center-body")).toContain("医療費の領収書を集める");
  });
});

describe("自動解決", () => {
  test("不整合が無い状態では実行ボタンを出さない", async () => {
    $("reconcile-btn").click();
    await tick();
    const modal = text("modal");
    expect(modal).toContain("自動解決");
    // サンプルは整合しているので、残るのは判断が必要な輪だけ
    expect(modal).toContain("判断が必要");
    expect(findButton("modal", "実行")).toBeUndefined();
  });

  test("循環は自動解決せず「分解が要る」と報告される", async () => {
    $("reconcile-btn").click();
    await tick();
    expect(text("modal")).toContain("分解が要る");
  });
});
