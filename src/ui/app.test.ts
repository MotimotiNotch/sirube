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
const { MemoryFs } = await import("../store/fs.ts");
// UI テストはメモリ FS を使う（dev サーバに依存させない）。

// 画面の骨組みは index.html をそのまま読む。ここに写しを置くと必ずずれる——
// 実際、サイドバーに「新しい目的」ボタンを足したときに写しの方だけ古くなり、
// 15件が `element not found` で落ちた（2026-09-01）。読み込む側が1つなら
// ずれようがない。<script> だけは外す（テストは startApp を直接呼ぶ）。
const HTML = (await Bun.file("index.html").text())
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

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
    // 見出しはパンくずだけが持つ。中央には結果そのものを出す（2026-08-31、
    // サイドバー・パンくず・リスト見出しで3回同じ文字が並んでいたのをやめた）。
    expect(text("breadcrumb")).toContain("今やれること");
    expect(text("center-body")).not.toContain("今やれること");
    expect(text("center-body")).toContain("READMEとマニュアルを書く");
  });

  test("全行で同じになる状態バッジは出さない", () => {
    // 「今やれること」は定義上すべて ACTIONABLE。6行に同じ語を並べても
    // 情報量はゼロで、右端を潰すだけだった。
    expect($("center-body").querySelectorAll(".hit").length).toBeGreaterThan(1);
    expect($("center-body").querySelectorAll(".hit .state-badge").length).toBe(0);
  });

  test("「今やれること」では隣接を出さない（パンくずと重複するため）", () => {
    // 上方向の隣接（これを待っている／属する先）はパンくずと同じものを指す。
    // 並べるとカードが二段になり、それが文字量の主因だった。
    expect($("center-body").querySelectorAll(".neighbors").length).toBe(0);
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
    // 隣接は検索のときだけ出る。方向のラベルはアイコン＋ツールチップに逃がした
    // ので、文字ではなくチップの存在で確かめる。
    expect($("center-body").querySelectorAll(".neighbors .chip").length).toBeGreaterThan(0);
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
    // 追加された前提は Chain View に出る。インスペクタは下向きの一覧を持たない
    // （2026-08-31、グラフと完全に重複していたため削除）。
    expect(text("center-body")).toContain("マイナンバーカードを用意する");
    expect(text("center-body")).toContain("医療費の領収書を集める");
    expect(text("inspector")).not.toContain("これが必要");
  });

  test("Ctrl+Enter で確定できる", async () => {
    // 改行で項目を区切る入力なので、確定でマウスへ往復させると分解が止まる。
    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "前提を一括追加")!.click();
    await tick();
    const ta = $("modal").querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "e-Taxの利用者識別番号を取る";
    ta.dispatchEvent(new Event("input"));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await tick();

    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    expect(text("center-body")).toContain("e-Taxの利用者識別番号を取る");
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

describe("新しい目的", () => {
  test("目的が0件でも、そこから1個目を作れる", async () => {
    // 空の vault では選択できるノードが無く、インスペクタの「前提を一括追加」に
    // 辿り着けない。最初の1個を作る道がそこしか無いと、新しいフォルダを選んだ
    // 人が詰む（2026-08-31 に懸念として記録、2026-09-01 にコードで確認）。
    document.body.innerHTML = HTML;
    await startApp(new MemoryFs());

    expect(text("root-list")).toContain("まだ目的がありません");
    findButton("root-list", "目的を作る")!.click();
    await tick();

    const input = $("modal").querySelector("input") as HTMLInputElement;
    input.value = "引っ越す";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();

    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    expect(text("root-list")).toContain("引っ越す");
    expect(text("breadcrumb")).toContain("引っ越す");
  });

  test("同じ名前があるときは作らずそこへ飛ぶ", async () => {
    // 一括追加は「既にある名前を書けばそのノードに繋がる」。こちらだけ黙って
    // 重複を作ると、入口によって結果が変わる。
    $("new-root-btn").click();
    await tick();
    const input = $("modal").querySelector("input") as HTMLInputElement;
    input.value = "確定 申告"; // 表記ゆれ（空白）も同じものとして扱う
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();

    expect(text("breadcrumb")).toContain("確定申告");
    const labels = buttonsIn("root-list").map((b) => b.textContent ?? "");
    expect(labels.filter((l) => l.includes("確定申告")).length).toBe(1);
  });

  test("名前が空なら作らない", async () => {
    $("new-root-btn").click();
    await tick();
    findButton("modal", "作成")!.click();
    await tick();
    expect($("modal-backdrop").classList.contains("hidden")).toBe(false);
  });
});

describe("画面に id を出さない", () => {
  // id は ULID なので、画面に出ると人には読めない。2026-09-01 の id/name 分離の
  // あと、実際に3箇所（削除トースト・一括追加の見出し・輪の提示）が素の id を
  // 出していた。名前が出ていることを固定しておく。
  const ULID_RE = /[0-9A-HJKMNP-TV-Z]{26}/;

  test("起動直後の画面のどこにも id が出ていない", () => {
    // 個別に潰すと必ず取りこぼす。実際、輪の提示・削除トースト・一括追加の
    // 見出しを直した後にも、検索結果行のパンくずが id のままだった。
    // 画面全体を1回で見る。
    expect(ULID_RE.test(document.body.textContent ?? "")).toBe(false);
  });

  test("検索結果でも id が出ない", async () => {
    const input = $("search-input") as HTMLInputElement;
    input.value = "Tauri";
    input.dispatchEvent(new Event("input"));
    await tick();
    expect(text("center-body")).toContain("Tauriシェル");
    expect(ULID_RE.test(text("center-body"))).toBe(false);
  });

  test("輪の提示はノード名で並ぶ", () => {
    const ring = $("center-body").querySelector(".cycle-ring") as HTMLElement;
    expect(ring).toBeTruthy();
    expect(ring.textContent ?? "").toContain("実績を作る");
    expect(ULID_RE.test(ring.textContent ?? "")).toBe(false);
  });

  test("一括追加の見出しはノード名で出る", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "前提を一括追加")!.click();
    await tick();
    expect(text("modal")).toContain("「確定申告」には何が必要？");
    expect(ULID_RE.test(text("modal"))).toBe(false);
  });
});

describe("vault の表示と切り替え", () => {
  test("vault を渡さないシェル（dev サーバ）ではボタンを出さない", () => {
    expect($("vault-btn").classList.contains("hidden")).toBe(true);
  });

  test("渡されたときはフォルダ名を出し、切り替えを呼べる", async () => {
    document.body.innerHTML = HTML;
    let switched = 0;
    await startApp(sampleFs(), {
      vault: { path: "C:\Users\me\my-vault", switchVault: async () => { switched += 1; } },
    });

    const btn = $("vault-btn");
    expect(btn.classList.contains("hidden")).toBe(false);
    expect(btn.textContent).toContain("my-vault");
    expect(btn.title).toContain("C:\Users\me\my-vault");

    btn.click();
    await tick();
    // フルパスは開いたときに見せる。どのフォルダを開いているかが分からないまま
    // 空の画面を見るのが、初回起動で一番時間を溶かした状態だった。
    expect(text("modal")).toContain("C:\Users\me\my-vault");
    findButton("modal", "別のフォルダを開く")!.click();
    await tick();
    expect(switched).toBe(1);
  });
});
