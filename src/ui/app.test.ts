// UI の smoke テスト。happy-dom 上に実際にアプリをマウントして、
// 描画・トグル・分解・自動解決が例外なく通り、画面に意図した文字が出ることを見る。
//
// 実機の見た目・操作感は別途のっちが確認する（AI の確認だけで「完了」と
// 言い切らない運用）。ここで担保するのは「壊れていないこと」まで。

import { beforeEach, describe, expect, test } from "bun:test";

import { ensureDom } from "./test-dom.ts";

ensureDom();

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
/** ゴールと削除は「その他」に畳んである（2026-09-12）。触る前に開く。 */
const openMore = async (): Promise<void> => {
  const btn = findButton("inspector", "その他");
  if (btn && !btn.classList.contains("open")) {
    btn.click();
    await tick();
  }
};

beforeEach(async () => {
  document.body.innerHTML = HTML;
  // 前回開いていた場所は localStorage に残る。消さないと直前のテストが潜って
  // いた先から始まる（復元を入れた 2026-09-03 に実際3件が落ちた）。
  localStorage.clear();
  await startApp(sampleFs());
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

  test("番号で引ける（#12 でも 12 でも）", async () => {
    const input = $("search-input") as HTMLInputElement;
    input.value = "#1";
    input.dispatchEvent(new Event("input"));
    await tick();
    const first = $("center-body").querySelector(".hit-number")?.textContent;
    expect(first).toBe("#1");

    input.value = "1";
    input.dispatchEvent(new Event("input"));
    await tick();
    // 番号一致は先頭に来る。名前に同じ数字を含む行より先でないと用を成さない。
    expect($("center-body").querySelector(".hit-number")?.textContent).toBe("#1");
  });

  test("番号は行の先頭に出て、インスペクタにも出る", async () => {
    $("nav-actionable").click();
    await tick();
    const numbers = Array.from($("center-body").querySelectorAll(".hit-number")).map((e) => e.textContent);
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers.every((n) => /^#\d+$/.test(n ?? ""))).toBe(true);
    ($("center-body").querySelector(".hit-main") as HTMLButtonElement).click();
    await tick();
    expect($("inspector").querySelector(".insp-number")?.textContent).toMatch(/^#\d+$/);
  });

  test("グラフのノードには番号を出さない", async () => {
    // ノードから文字を追い出した直後なので、そこに番号を戻すと元の木阿弥。
    findButton("root-list", "確定申告")!.click();
    await tick();
    const svg = $("center-body").querySelector(".graph-wrap svg")!.cloneNode(true) as SVGSVGElement;
    svg.querySelectorAll("title").forEach((t) => t.remove());
    expect(svg.textContent).not.toContain("#");
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

  test("一覧へ戻ると詳細パネルは畳む。俯瞰では残す", async () => {
    // 起動直後は何も選んでいないので畳まれている。
    expect(document.body.classList.contains("no-inspector")).toBe(true);
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    expect(document.body.classList.contains("no-inspector")).toBe(false);

    // TOP へ戻ったら選択ごと手放す。一覧は選択中の印を出さないので、パネルだけが
    // 前の選択を指して残ると、画面のどこにも相手がいないまま3割を占める
    // （のっち報告 2026-09-03: 目的を1つ押すと以後ずっと開いたままになった）。
    $("nav-actionable").click();
    await tick();
    expect(document.body.classList.contains("no-inspector")).toBe(true);

    // 俯瞰は別。パネルは絞っている目的そのものを指していて、進捗バーが
    // 「今どこの配下を見ているか」の手がかりになる。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    buttonsIn("breadcrumb").find((b) => b.textContent === "俯瞰")!.click();
    await tick();
    expect(document.body.classList.contains("no-inspector")).toBe(false);
  });

  test("一覧から末端へ飛ぶと、親を中心に据えてその末端を選ぶ", async () => {
    // 末端を中心にすると丸1つだけの画面になる（のっち報告 2026-09-03）。
    // グラフの中では潜らないようにしたが、一覧からの経路に同じ穴が残っていた。
    // 親を中心にすれば、押したものが**どの枝にぶら下がっているか**が同時に見える。
    $("nav-actionable").click();
    await tick();
    (Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("READMEとマニュアルを書く"),
    ) as HTMLButtonElement).click();
    await tick();

    expect($("breadcrumb").querySelector(".current")!.textContent).toBe("Sirube をリリースする");
    expect($("inspector").querySelector(".insp-name")!.textContent).toBe("READMEとマニュアルを書く");
    expect($("center-body").querySelector("g.graph-node.selected")!.textContent).toContain(
      "READMEとマニュアルを書く",
    );
    // 中心が親なので、兄弟も一緒に見える。これが「どこにいるか」の手がかりになる。
    expect(text("center-body")).toContain("MVP実装完了");
  });

  test("下に何かあるノードは、これまでどおりそこを中心にする", async () => {
    // 検索と横断ビュー は前提を1つ持つので、中心にしても空にならない。
    $("nav-actionable").click();
    await tick();
    (Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("検索と横断ビュー"),
    ) as HTMLButtonElement).click();
    await tick();

    expect($("breadcrumb").querySelector(".current")!.textContent).toBe("検索と横断ビュー");
    const crumb = text("breadcrumb");
    expect(crumb).toContain("Sirube をリリースする");
    expect(crumb).toContain("MVP実装完了");
    expect(crumb.indexOf("Sirube をリリースする")).toBeLessThan(crumb.indexOf("MVP実装完了"));
    // 積んだ先は押して戻れる（ただのラベルにしない）
    expect(findButton("breadcrumb", "Sirube をリリースする")).toBeTruthy();
  });

  test("目的そのものを押したときは経路を積まない", async () => {
    // 目的の上には何も無い。空の段が増えると、1段目がいつも無意味になる。
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(text("breadcrumb")).toContain("確定申告");
    expect($("breadcrumb").querySelectorAll(".sep").length).toBe(1);
  });

  test("「属する先」を押すと、グラフもパンくずも一緒に親へ移る", async () => {
    // 右パネルだけ差し替えていたので、画面の3箇所が食い違っていた
    // （のっち報告 2026-09-03）。ここは合流ノードから他の親へ渡る唯一の道でもある。
    $("nav-actionable").click();
    await tick();
    (Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("検索と横断ビュー"),
    ) as HTMLButtonElement).click();
    await tick();
    expect(text("breadcrumb")).toContain("検索と横断ビュー");

    findButton("inspector", "MVP実装完了")!.click();
    await tick();

    expect($("inspector").querySelector(".insp-name")!.textContent).toBe("MVP実装完了");
    // パンくずの現在地が入れ替わる。押す前のノードが末尾に残っていると、
    // どこにいるのか読めない。
    expect($("breadcrumb").querySelector(".current")!.textContent).toBe("MVP実装完了");
    // グラフの中心も一緒に移る
    expect($("center-body").querySelector("g.graph-node.focused")!.textContent).toContain("MVP実装完了");
  });

  test("「これを待っている」から、合流点を経由して別の親へ渡れる", async () => {
    // ここが上向きリンクを残してある理由そのもの。合流ノードの他の親には、
    // グラフ（下向きしか描かない）からもパンくず（辿ってきた道だけ）からも
    // 到達できない。
    $("nav-actionable").click();
    await tick();
    (Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("検索と横断ビュー"),
    ) as HTMLButtonElement).click();
    await tick();

    // 新リポジトリを作る は末端なので、押しても潜らず選ばれるだけ
    (Array.from($("center-body").querySelectorAll("g.graph-node")).find((g) =>
      (g.textContent ?? "").includes("新リポジトリを作る"),
    ) as unknown as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect($("breadcrumb").querySelector(".current")!.textContent).toBe("検索と横断ビュー");

    // ここから、同じ前提を要求している別のノードへ渡る
    findButton("inspector", "整合性の自動解決")!.click();
    await tick();
    expect($("breadcrumb").querySelector(".current")!.textContent).toBe("整合性の自動解決");
    expect($("center-body").querySelector("g.graph-node.focused")!.textContent).toContain("整合性の自動解決");
    expect($("inspector").querySelector(".insp-name")!.textContent).toBe("整合性の自動解決");
  });

  test("インスペクタから達成にすると、前提の連動を先に見せてから書く", async () => {
    // 事前: 領収書整理は「今やれること」に出ている
    expect(text("center-body")).toContain("領収書整理");

    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();

    // まだ書いていない。何が一緒に動くかを名前で出す（2026-09-10）。
    expect($("modal-backdrop").classList.contains("hidden")).toBe(false);
    expect(text("modal")).toContain("前提を埋める");
    expect(text("modal")).toContain("領収書整理");
    expect(text("inspector")).toContain("達成にする");

    findButton("modal", "達成にする")!.click();
    await tick();
    expect(text("inspector")).toContain("達成を取り消す");

    // 確定申告を達成にすると前提の領収書整理も達成になる（requires の意味論）。
    // 「今やれること」に戻すと、もう出てこない。
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).not.toContain("領収書整理");
  });

  test("下見をキャンセルすると1件も書かない", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    findButton("modal", "キャンセル")!.click();
    await tick();

    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    // 押した本人も動かない。**部分適用はしない**——1件だけ拒むと「達成なのに
    // 前提が未達」が残り、次の自動解決が同じ提案を持って戻ってくる。
    expect(text("inspector")).toContain("達成にする");
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).toContain("領収書整理");
  });

  test("下見を出している間にファイルが外で変わったら、その計画では書かない", async () => {
    // Tauri は `watchNodes` で外の書き換えを拾ってグラフを差し替える。見せた
    // ものと違うものを書いたら、確認を取った意味がそこで消える。
    const fs = sampleFs();
    document.body.innerHTML = HTML;
    const app = await startApp(fs);

    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    expect(text("modal")).toContain("前提を埋める");

    // 外（Obsidian / AI）で前提が先に達成になった。
    const entry = Array.from(fs.files.entries()).find(([, f]) => f.content.includes("name: 領収書整理"))!;
    fs.files.set(entry[0], { content: entry[1].content.replace("satisfied: false", "satisfied: true"), mtimeMs: fs.tick() });
    await app.reload();

    findButton("modal", "達成にする")!.click();
    await tick();
    expect(text("toast-stack")).toContain("もう一度押してください");
    expect(text("inspector")).toContain("達成にする"); // 確定申告は動いていない
  });

  test("連動して書いたあとは「戻す」が出て、押すと全部戻る", async () => {
    // もう一度押しても元には戻らない（往路と復路で向きが違う）。押し間違いを
    // 引き受けられるのはこのボタンだけ。
    expect($("undo-btn").classList.contains("hidden")).toBe(true);

    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    findButton("modal", "達成にする")!.click();
    await tick();

    expect($("undo-btn").classList.contains("hidden")).toBe(false);
    expect(text("toast-stack")).toContain("戻す");
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).not.toContain("領収書整理");

    $("undo-btn").click();
    await tick();

    // 押した本人も、連動して埋まった前提も、押す前の状態へ戻る。
    expect($("undo-btn").classList.contains("hidden")).toBe(true);
    expect(text("center-body")).toContain("領収書整理");
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(text("inspector")).toContain("達成にする");
  });

  test("外でファイルが変わっていたら戻さない", async () => {
    const fs = sampleFs();
    document.body.innerHTML = HTML;
    const app = await startApp(fs);

    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    findButton("modal", "達成にする")!.click();
    await tick();
    expect($("undo-btn").classList.contains("hidden")).toBe(false);

    // 連動で達成にした前提を、外（Obsidian / AI）が未達へ戻した。
    const entry = Array.from(fs.files.entries()).find(([, f]) => f.content.includes("name: 領収書整理"))!;
    fs.files.set(entry[0], { content: entry[1].content.replace("satisfied: true", "satisfied: false"), mtimeMs: fs.tick() });
    await app.reload();

    $("undo-btn").click();
    await tick();
    expect(text("toast-stack")).toContain("戻せません");
    // 巻き戻しは他人の書き込みを消す操作になるので、丸ごと諦める。
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(text("inspector")).toContain("達成を取り消す");
  });

  test("1件で済んだトグルでは「戻す」を出さない（押し直せば戻るため）", async () => {
    findButton("center-body", "領収書整理")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    expect($("undo-btn").classList.contains("hidden")).toBe(true);
  });

  test("下見はキャンセル側にフォーカスを置く（勢いの Enter で書かない）", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();
    expect(document.activeElement?.textContent).toBe("キャンセル");
  });

  test("連動先が無いトグルは下見を挟まない", async () => {
    // 末端（前提を持たない）を潰すのは一番よくある操作。ここで毎回ダイアログが
    // 出ると、確認そのものが読み飛ばされる合図になる。
    const before = text("center-body");
    expect(before).toContain("領収書整理");
    findButton("center-body", "領収書整理")!.click();
    await tick();
    findButton("inspector", "達成にする")!.click();
    await tick();

    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    expect(text("inspector")).toContain("達成を取り消す");
  });

  test("輪の上のノードを開くと「割る」案内が出る", async () => {
    const chip = Array.from($("center-body").querySelectorAll("button")).find((b) => b.textContent === "実績を作る");
    (chip as HTMLButtonElement).click();
    await tick();
    expect(text("inspector")).toContain("輪の上にいます");
    expect(text("inspector")).toContain("2つに割る");
  });
});

describe("下にあるものの一覧（フライアウト）", () => {
  /** グラフの `<g class="graph-node">` を表示名（`<title>`）で引く。 */
  const graphNode = (name: string): SVGGElement | undefined =>
    Array.from($("center-body").querySelectorAll("g.graph-node")).find(
      (g) => g.querySelector("title")?.textContent === name,
    ) as SVGGElement | undefined;

  test("下があるノードにホバーすると全階層の一覧が出る", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    // グラフは直下1ホップしか描かないので、MVP実装完了 の下はここに出ていない。
    expect(text("center-body")).not.toContain("Markdownノードストア");

    graphNode("MVP実装完了")!.dispatchEvent(new Event("mouseenter"));
    expect($("flyout").classList.contains("hidden")).toBe(false);
    expect(text("flyout")).toContain("Markdownノードストア");
    expect(text("flyout")).toContain("Tauriシェル");
  });

  test("requires の下でも開く（contains 限定にしない）", async () => {
    // ここが contains 限定だった間、実データ16ノードのうち1つでしか
    // 開かない機能になっていた（2026-09-02 の棚卸しで発覚）。
    // MVP実装完了 は目的の requires 側にぶら下がっている。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    graphNode("Sirube をリリースする")!.dispatchEvent(new Event("mouseenter"));
    expect($("flyout").classList.contains("hidden")).toBe(false);
    expect(text("flyout")).toContain("MVP実装完了");
  });

  test("末端にはホバーしても出ない", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    graphNode("領収書整理")!.dispatchEvent(new Event("mouseenter"));
    expect($("flyout").classList.contains("hidden")).toBe(true);
  });

  test("下が末端しか無いノードでも出ない", async () => {
    // 一覧は飛び先のメニューなので、飛び先が無ければ出す意味がない。
    findButton("root-list", "確定申告")!.click();
    await tick();
    graphNode("確定申告")!.dispatchEvent(new Event("mouseenter"));
    expect($("flyout").classList.contains("hidden")).toBe(true);
  });

  test("並ぶのは飛び先だけ。末端は一覧に出さない", async () => {
    // 末端まで並べると実データで 12行 → 30行 に膨らみ、ホバーには重すぎた。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    graphNode("MVP実装完了")!.dispatchEvent(new Event("mouseenter"));
    const items = Array.from($("flyout").querySelectorAll(".fly-item"));
    expect(items.length).toBeGreaterThan(0);
    // 末端（新リポジトリを作る）は行にならない
    expect(items.some((el) => (el.textContent ?? "").includes("新リポジトリを作る"))).toBe(false);
    // 並んでいる行はどれも潜れる
    expect(items.every((el) => !el.classList.contains("static"))).toBe(true);
    const nested = items.find((el) => (el.textContent ?? "").includes("Markdownノードストア"))!;
    (nested as HTMLElement).click();
    await tick();
    expect(text("breadcrumb")).toContain("Markdownノードストア");
  });

  test("描き直すと開いたままにならない", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    graphNode("MVP実装完了")!.dispatchEvent(new Event("mouseenter"));
    expect($("flyout").classList.contains("hidden")).toBe(false);
    // ホバー元の要素ごと消える描き直しで、宙に浮いたまま残らないこと。
    $("nav-actionable").click();
    await tick();
    expect($("flyout").classList.contains("hidden")).toBe(true);
  });
});

describe("グラフの拡大縮小と移動", () => {
  const wrap = (): HTMLElement => $("center-body").querySelector(".graph-wrap") as HTMLElement;
  const view = (): SVGGElement => $("center-body").querySelector(".graph-wrap svg > g") as SVGGElement;
  const transform = (): string => view().getAttribute("transform") ?? "";
  const scale = (): number => Number(/scale\(([-\d.]+)\)/.exec(transform())?.[1] ?? "1");
  const translate = (): [number, number] => {
    const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(transform());
    return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)];
  };
  const drag = (dx: number, dy: number): void => {
    wrap().dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 + dx, clientY: 100 + dy }));
    window.dispatchEvent(new MouseEvent("mouseup", {}));
  };

  beforeEach(async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
  });

  test("グラフのときは中央ペインのスクロールを外す（二重スクロールにしない）", () => {
    expect($("center-body").classList.contains("graph")).toBe(true);
    $("nav-actionable").click();
    expect($("center-body").classList.contains("graph")).toBe(false);
  });

  test("スクロールで拡大縮小する", () => {
    expect(scale()).toBe(1);
    wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: 50, clientY: 50, bubbles: true }));
    expect(scale()).toBeGreaterThan(1);
    wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: 600, clientX: 50, clientY: 50, bubbles: true }));
    expect(scale()).toBeLessThan(1);
  });

  test("ピンチ（ctrlKey）は同じ移動量でもよく効く", () => {
    // ブラウザはピンチのときだけ wheel に ctrlKey を立てる。送られてくる
    // deltaY はホイール1目盛りより一桁小さいので、同じ係数だと指を大きく
    // 開いてもほとんど動かない。
    //
    // happy-dom の `WheelEvent` は `ctrlKey` を落とす（`undefined` になる）ので、
    // ここだけ手で立てる。落ちた側は falsy になり通常のホイール扱いなので、
    // 既定の倒れ方も安全。
    const step = (pinch: boolean): number => {
      const btn = $("center-body").querySelector(".graph-reset") as HTMLButtonElement;
      btn.click(); // 一度リセットしてから測る
      const ev = new WheelEvent("wheel", { deltaY: -10, clientX: 50, clientY: 50, bubbles: true });
      Object.defineProperty(ev, "ctrlKey", { value: pinch });
      wrap().dispatchEvent(ev);
      return scale();
    };
    expect(step(true)).toBeGreaterThan(step(false));
  });

  test("ピンチでもページごと拡大されない（既定動作を止めている）", () => {
    const ev = new WheelEvent("wheel", { deltaY: -100, clientX: 50, clientY: 50, ctrlKey: true, bubbles: true, cancelable: true });
    wrap().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("拡大率には上限と下限がある", () => {
    for (let i = 0; i < 40; i += 1) {
      wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: -600, clientX: 50, clientY: 50, bubbles: true }));
    }
    expect(scale()).toBeLessThanOrEqual(3);
    for (let i = 0; i < 80; i += 1) {
      wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: 600, clientX: 50, clientY: 50, bubbles: true }));
    }
    expect(scale()).toBeGreaterThanOrEqual(0.3);
  });

  test("ドラッグで動かせる", () => {
    const [x0, y0] = translate();
    drag(40, -25);
    const [x1, y1] = translate();
    expect(x1 - x0).toBe(40);
    expect(y1 - y0).toBe(-25);
  });

  test("手ぶれ程度の動きはドラッグにしない（ノードが選べなくなるため）", () => {
    const before = transform();
    drag(2, 1);
    expect(transform()).toBe(before);
  });

  test("触ると拡大率が出て、押すと元に戻る", async () => {
    const before = transform();
    expect(($("center-body").querySelector(".graph-reset") as HTMLElement).classList.contains("hidden")).toBe(true);
    wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: 50, clientY: 50, bubbles: true }));
    const btn = $("center-body").querySelector(".graph-reset") as HTMLButtonElement;
    expect(btn.classList.contains("hidden")).toBe(false);
    expect(btn.textContent).toMatch(/^\d+%$/);
    btn.click();
    expect(transform()).toBe(before);
    expect(btn.classList.contains("hidden")).toBe(true);
  });

  test("掴んで動かした指をノードの上で離しても、そのノードへ潜らない", async () => {
    const node = Array.from($("center-body").querySelectorAll("g.graph-node")).find(
      (g) => g.querySelector("title")?.textContent === "MVP実装完了",
    )!;
    const before = text("breadcrumb");
    drag(40, 0);
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(text("breadcrumb")).toBe(before);

    // 飲むのは1回だけ。次の普通のクリックは通る。
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(text("breadcrumb")).toContain("MVP実装完了");
  });

  test("窓の外で指を離してクリックが来なくても、合図は次に押した時点で消える", async () => {
    // 残ると「次に押したものが何であれ1回飲まれる」ことになる。
    drag(40, 0);
    const node = Array.from($("center-body").querySelectorAll("g.graph-node")).find(
      (g) => g.querySelector("title")?.textContent === "MVP実装完了",
    )!;
    // クリックを挟まずにもう一度押す（＝掴み直す）と合図は捨てられる。
    drag(1, 0);
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(text("breadcrumb")).toContain("MVP実装完了");
  });

  test("描き直しでは表示が飛ばず、潜ると初期位置に戻る", async () => {
    wrap().dispatchEvent(new WheelEvent("wheel", { deltaY: -300, clientX: 50, clientY: 50, bubbles: true }));
    const zoomed = scale();
    // 達成のトグルでも描き直しは走る。そのたびに戻ると手元が飛ぶ。
    findButton("inspector", "達成にする")!.click();
    await tick();
    // 前提が連動するノードなら下見が挟まる。確定させないと描き直しが走らず、
    // この検査が「何も起きなかったから動かない」で通ってしまう。
    expect($("modal-backdrop").classList.contains("hidden")).toBe(false);
    findButton("modal", "達成にする")!.click();
    await tick();
    expect(scale()).toBe(zoomed);
    // 別のノードへ潜ったら初期位置から。
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(scale()).toBe(1);
  });
});

describe("Chain View の表示量", () => {
  beforeEach(async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => g.querySelector("title")?.textContent === "MVP実装完了")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  });

  test("ノードの中に文字を書かない（名前は印の下、状態は色）", () => {
    // 箱の中に名前と数字を入れていた頃は、6個並ぶとカードの列に見えていた。
    const nodes = Array.from($("center-body").querySelectorAll("g.graph-node"));
    expect(nodes.length).toBeGreaterThan(1);
    expect($("center-body").querySelectorAll("g.graph-node .box").length).toBe(0);
    expect($("center-body").querySelectorAll("g.graph-node .mark").length).toBe(nodes.length);
    for (const g of nodes) {
      expect(g.querySelector(".label")?.textContent).toBeTruthy();
    }
  });

  test("画面に文字で出るのはノード名・合流の数・段のラベルだけ", () => {
    // `下にN` は弧に置き換えた。数はツールチップへ逃がしてある——`<title>` は
    // 画面に出ないので、数えるときは落としてから見る。
    const svg = $("center-body").querySelector(".graph-wrap svg")!.cloneNode(true) as SVGSVGElement;
    svg.querySelectorAll("title").forEach((t) => t.remove());
    const classes = new Set(
      Array.from(svg.querySelectorAll("text")).map((t) => t.getAttribute("class") ?? ""),
    );
    expect([...classes].sort()).toEqual(["edge-label", "label"]);
    expect(svg.textContent).not.toContain("下に");
    expect(svg.textContent).not.toContain("合流");
  });

  test("下に何かあることは弧が言い、数はツールチップに逃がす", () => {
    const mvp = Array.from($("center-body").querySelectorAll("g.graph-node")).find(
      (g) => g.querySelector("title")?.textContent === "MVP実装完了",
    )!;
    // フォーカス自身（配下5件）には軌道が出る
    expect(mvp.querySelector(".ring.track")).toBeTruthy();
    expect(mvp.querySelector(".ring.track title")?.textContent).toMatch(/^下に \d+\/\d+$/);
  });

  test("合流の数だけは文字で残す（数が読めないと優先度として使えない）", async () => {
    // サンプルでは `新リポジトリを作る` が4箇所から要求されている。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => g.querySelector("title")?.textContent === "MVP実装完了")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => g.querySelector("title")?.textContent === "Markdownノードストア")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    const merged = Array.from($("center-body").querySelectorAll("g.graph-node .merge"));
    expect(merged.length).toBeGreaterThan(0);
    expect(merged[0]!.firstChild?.nodeValue).toMatch(/^\d+$/);
    expect(merged[0]!.querySelector("title")?.textContent).toContain("箇所から要求されている");
  });
});

describe("目的の俯瞰（配下の今やれること）", () => {
  const crumb = (): string => text("breadcrumb");
  const toggle = (label: string): HTMLButtonElement =>
    Array.from($("breadcrumb").querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;

  beforeEach(async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
  });

  test("目的の入口はこれまでどおりグラフ（一覧に差し替えない）", () => {
    expect($("center-body").querySelector("svg")).toBeTruthy();
    expect(toggle("俯瞰")).toBeTruthy();
  });

  test("俯瞰でその目的の配下だけに絞られる", async () => {
    // 事前: 全体の「今やれること」には別の目的の下のものも出ている
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).toContain("領収書整理"); // 確定申告 の下

    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("俯瞰").click();
    await tick();
    expect(crumb()).toContain("Sirube をリリースする の配下");
    expect(text("center-body")).toContain("Rustツールチェーンを入れる");
    expect(text("center-body")).not.toContain("領収書整理");
  });

  test("絞ったらパンくずの列は出さない（全行で同じ値になる）", async () => {
    toggle("俯瞰").click();
    await tick();
    const crumbs = Array.from($("center-body").querySelectorAll(".hit-crumb"));
    expect(crumbs.length).toBeGreaterThan(0);
    expect(crumbs.every((c) => (c.textContent ?? "") === "")).toBe(true);
  });

  test("進捗はここに出さない（サイドバーとインスペクタが既に出している）", async () => {
    toggle("俯瞰").click();
    await tick();
    // 一度、同じ `4/11` が サイドバー行・一覧の見出し・インスペクタのバー の
    // 3箇所に同時に出る画面を作ってしまった（2026-09-02 の棚卸しで実測）。
    expect($("center-body").querySelector(".list-count")).toBeNull();
    expect(findButton("root-list", "Sirube をリリースする")!.textContent).toMatch(/\d+\/\d+/);
    expect($("inspector").querySelector(".progress-label")?.textContent).toMatch(/^\d+\/\d+$/);
  });

  test("俯瞰から選ぶと、絞っていた目的が経路に残る", async () => {
    toggle("俯瞰").click();
    await tick();
    const row = Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("Rustツールチェーンを入れる"),
    ) as HTMLButtonElement;
    row.click();
    await tick();
    // 経路ごと捨てると、俯瞰で見つけた枝から目的へ戻れなくなる。
    expect(crumb()).toContain("Sirube をリリースする");
    expect(crumb()).toContain("Rustツールチェーンを入れる");
  });

  test("グラフへ戻れる／サイドバーの「今やれること」は俯瞰では点かない", async () => {
    toggle("俯瞰").click();
    await tick();
    expect($("nav-actionable").classList.contains("active")).toBe(false);
    expect(findButton("root-list", "Sirube をリリースする")!.classList.contains("active")).toBe(true);
    toggle("グラフ").click();
    await tick();
    expect($("center-body").querySelector("svg")).toBeTruthy();
    expect(crumb()).toContain("Sirube をリリースする");
  });

  test("潜った先で俯瞰しても、辿ってきた道は消えない", async () => {
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => g.querySelector("title")?.textContent === "MVP実装完了")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    toggle("俯瞰").click();
    await tick();
    // 絞る対象が変わっても「今どこにいるか」は変わらない。道が消えると
    // 手がかりが「◯◯ の配下」の1語だけになる。
    expect(crumb()).toContain("Sirube をリリースする");
    expect(crumb()).toContain("MVP実装完了 の配下");
    // 道の途中を押せばそこのグラフへ戻る
    findButton("breadcrumb", "Sirube をリリースする")!.click();
    await tick();
    expect($("center-body").querySelector("svg")).toBeTruthy();
    expect(crumb()).not.toContain("の配下");
  });

  test("検索から入って俯瞰を押しても、検索結果のままにならない", async () => {
    // 検索は常に全体にかける決まりなので、語が残ったままだと俯瞰を押しても
    // 検索結果が出続け、押した意味が消える（2026-09-02 に実機で踏んだ）。
    const input = $("search-input") as HTMLInputElement;
    input.value = "MVP";
    input.dispatchEvent(new Event("input"));
    await tick();
    const hit = $("center-body").querySelector(".hit-main") as HTMLButtonElement;
    hit.click();
    await tick();
    toggle("俯瞰").click();
    await tick();
    expect(input.value).toBe("");
    expect(crumb()).toContain("の配下");
    expect($("center-body").querySelector(".list-count")).toBeNull();
  });

  test("検索は俯瞰中でも全体にかける", async () => {
    toggle("俯瞰").click();
    await tick();
    const input = $("search-input") as HTMLInputElement;
    input.value = "領収書";
    input.dispatchEvent(new Event("input"));
    await tick();
    // 絞ったままだと、ヘッダーの検索欄という全体の道具が場所によって効き方を変える。
    expect(text("center-body")).toContain("領収書整理");
  });
});

describe("改名と削除", () => {
  const insp = (sel: string): HTMLElement | null => $("inspector").querySelector(sel);

  beforeEach(async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
  });

  test("その場で名前を変えられる（参照は切れない）", async () => {
    (insp(".insp-name-row .icon-btn") as HTMLButtonElement).click();
    const input = insp(".insp-rename") as HTMLInputElement;
    expect(input.value).toBe("確定申告");
    input.value = "確定申告2027";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    expect(text("inspector")).toContain("確定申告2027");
    // 参照は id のままなので、下がぶら下がったまま残る
    expect(text("center-body")).toContain("領収書整理");
    expect(findButton("root-list", "確定申告2027")).toBeTruthy();
  });

  test("Escape で取り消せる", async () => {
    (insp(".insp-name-row .icon-btn") as HTMLButtonElement).click();
    const input = insp(".insp-rename") as HTMLInputElement;
    input.value = "書き換え途中";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(insp(".insp-name")?.textContent).toBe("確定申告");
  });

  test("既にある名前には変えられない", async () => {
    // 名前で参照を解決する経路があるので、同名が2つあるとどちらにも繋がらない。
    (insp(".insp-name-row .icon-btn") as HTMLButtonElement).click();
    const input = insp(".insp-rename") as HTMLInputElement;
    input.value = "領収書整理";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await tick();
    expect(text("toast-stack")).toContain("同じ名前になります");
    expect(insp(".insp-name")?.textContent).toBe("確定申告");
  });

  test("削除は一度受け止める。やめれば消えない", async () => {
    await openMore();
    findButton("inspector", "このノードを削除")!.click();
    expect(text("inspector")).toContain("取り消せません");
    findButton("inspector", "やめる")!.click();
    await tick();
    expect(findButton("root-list", "確定申告")).toBeTruthy();
    expect(text("inspector")).not.toContain("取り消せません");
  });

  test("削除で目的が生えるなら、押す前に件数と名前を出す", async () => {
    // ルート判定が入次数0なので、中間ノードを消すとその子が目的として現れる。
    // 構造としては正しいが、削除の副作用としては予想できない。
    await openMore();
    findButton("inspector", "このノードを削除")!.click();
    expect(text("inspector")).toContain("1 件");
    expect(text("inspector")).toContain("領収書整理");
    expect(text("inspector")).toContain("目的として一覧に出るようになります");
  });

  test("削除すると参照側からも外れる", async () => {
    await openMore();
    findButton("inspector", "このノードを削除")!.click();
    findButton("inspector", "削除する")!.click();
    await tick();
    expect(findButton("root-list", "確定申告")).toBeUndefined();
    // 参照だけ残ると自動解決が空ノードを作り直してしまう
    expect(findButton("root-list", "領収書整理")).toBeTruthy();
  });
});

describe("まとめて追加（DSL）", () => {
  const tab = (label: string): HTMLButtonElement =>
    Array.from($("modal").querySelectorAll(".modal-tab")).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement;
  const openImport = async (): Promise<HTMLTextAreaElement> => {
    // ヘッダーの専用ボタンは畳んで、`+` のダイアログのタブにした（2026-09-03）。
    $("new-root-btn").click();
    await tick();
    tab("まとめて書く").click();
    await tick();
    return $("modal").querySelector("textarea") as HTMLTextAreaElement;
  };

  test("`+` から開くと「1つ作る」で、タブで切り替えられる", async () => {
    // 新規作成の入口が2箇所に分かれて互いを知らなかった（のっち 2026-09-03）。
    $("new-root-btn").click();
    await tick();
    expect(tab("1つ作る").classList.contains("on")).toBe(true);
    expect($("modal").querySelector("textarea")).toBeNull();

    tab("まとめて書く").click();
    await tick();
    expect(tab("まとめて書く").classList.contains("on")).toBe(true);
    expect($("modal").querySelector("textarea")).toBeTruthy();

    tab("1つ作る").click();
    await tick();
    expect($("modal").querySelector("input")).toBeTruthy();
  });

  test("「1つ作る」は、作ったあとどこで分解するかまで書く", () => {
    // 「作ったあとで足せる」だけだと、どこで足すのかが分からない
    // （のっち 2026-09-03）。この文言は初回しか読まれないので、ここで道を示す。
    $("new-root-btn").click();
    const hint = $("modal").querySelector(".hint")!.textContent ?? "";
    expect(hint).toContain("前提を一括追加");
    // 画面に出ていない語（Chain View）は使わない。UI では「グラフ」と呼んでいる。
    expect(hint).not.toContain("Chain View");
  });

  test("自動解決は、何かあるときだけ出て件数を言う", async () => {
    // 常駐していて無印だったので、押すまで中身が分からなかった
    // （のっち 2026-09-03「自動解決が何を示しているか分からない」）。
    // 数えるのは3つ全部——自動で直せる・判断が要る・読めない。
    const btn = $("reconcile-btn");
    // sample には輪（案件を取る ⟷ 実績を作る）があるので必ず1件以上ある
    expect(btn.classList.contains("hidden")).toBe(false);
    expect(btn.querySelector(".count")!.textContent).toBe("1");

    // 不整合の無い vault では畳む。0 件のときに押す意味が無いので、
    // 出ていること自体を「何かある」の合図にしてある。
    document.body.innerHTML = HTML;
    localStorage.clear();
    await startApp(
      new MemoryFs({
        ["01M0TESTZ0" + "0".repeat(16)]: [
          "---",
          "name: ひとつだけ",
          "satisfied: false",
          "requires: []",
          "contains: []",
          "---",
          "",
        ].join("\n"),
      }),
    );
    expect($("reconcile-btn").classList.contains("hidden")).toBe(true);
  });

  test("開いた直後の背景クリックでは閉じない", async () => {
    // `+` を素早く2回押すと、2打目が背景に落ちて即座に閉じていた
    // （のっち報告 2026-09-03）。開いた瞬間にボタンの上へ背景が覆いかぶさるので、
    // 押した本人からは「開かなかった」ようにしか見えない。
    const back = $("modal-backdrop");
    $("new-root-btn").click();
    await tick();
    expect(back.classList.contains("hidden")).toBe(false);

    back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(back.classList.contains("hidden")).toBe(false);

    // 間が空けば、これまでどおり閉じる。ここを塞ぐと外を押して閉じる操作が消える。
    await new Promise((r) => setTimeout(r, 450));
    back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(back.classList.contains("hidden")).toBe(true);
  });

  test("俯瞰／グラフを素早く2回押しても往復しない", async () => {
    // 押すと同じ位置に逆向きのボタンが出るので、2打目がそちらに当たって元へ
    // 戻っていた（のっち報告 2026-09-03）。`+` の背景クリックと同じ形の事故。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    const toggle = (): HTMLButtonElement =>
      Array.from($("breadcrumb").querySelectorAll("button")).find((b) =>
        ["俯瞰", "グラフ"].includes(b.textContent ?? ""),
      ) as HTMLButtonElement;

    expect(toggle().textContent).toBe("俯瞰");
    toggle().click();
    await tick();
    expect(toggle().textContent).toBe("グラフ"); // 一覧へ移った

    // 2打目。ここで戻ってしまうと、押した本人には「効かなかった」ように見える。
    toggle().click();
    await tick();
    expect(toggle().textContent).toBe("グラフ");

    // 間が空けば、これまでどおり戻れる
    await new Promise((r) => setTimeout(r, 450));
    toggle().click();
    await tick();
    expect(toggle().textContent).toBe("俯瞰");
  });

  test("繋がりだけを外せる（A -> C に B を挟む）", async () => {
    // 追加しかできないと、B を挟んでも A -> C が残って併存する
    // （のっち 2026-09-03。Warframe 版は reparentNode で解決済み）。
    // 外す口は**上向きリンクの右クリック**（2026-09-12 に `×` から移した）。
    const cutFromMenu = async (): Promise<void> => {
      $("inspector")
        .querySelector(".insp-link-row")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      await tick();
      (Array.from(document.querySelectorAll(".ctx-item")).find((b) =>
        (b.textContent ?? "").includes("を外す"),
      ) as HTMLButtonElement).click();
      await tick();
    };

    // 確定申告 -> 領収書整理。領収書整理 を選ぶと「これを待っている」に出る。
    findButton("root-list", "確定申告")!.click();
    await tick();
    (Array.from($("center-body").querySelectorAll("g.graph-node")).find((g) =>
      (g.textContent ?? "").includes("領収書整理"),
    ) as unknown as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(text("inspector")).toContain("確定申告");

    await cutFromMenu();
    await tick();

    // 繋がりだけが消え、**ノードはどちらも残る**
    expect(text("inspector")).not.toContain("これを待っている");
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(text("center-body")).not.toContain("領収書整理");
    $("nav-actionable").click();
    await tick();
    expect(text("center-body")).toContain("領収書整理"); // 独立して今やれることに出る
    expect(findButton("root-list", "領収書整理")).toBeTruthy(); // 入次数0になり目的へ
  });

  test("エッジを押すと、その間にノードを差し込める", async () => {
    // 追加と削除だけだと3手かかる（作る・繋ぐ・外す）。エッジそのものを押して
    // 差し込むのが素直だ、というのっちの指摘（2026-09-03）。
    findButton("root-list", "確定申告")!.click();
    await tick();

    // 確定申告 -> 領収書整理 のエッジ。当たり判定の方を押す。
    ($("center-body").querySelector(".graph-edge-hit") as unknown as SVGPathElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await tick();
    expect(text("modal")).toContain("間に差し込む");
    expect(text("modal")).toContain("確定申告");
    expect(text("modal")).toContain("領収書整理");

    const input = $("modal").querySelector("input") as HTMLInputElement;
    input.value = "レシートを箱から出す";
    findButton("modal", "差し込む")!.click();
    await tick();

    // 確定申告 -> レシートを箱から出す -> 領収書整理 になる。**requires は全展開**
    // なので3つとも描かれる。「何が描かれたか」ではなく繋がりの向きで確かめる。
    expect(text("center-body")).toContain("レシートを箱から出す");

    (Array.from($("center-body").querySelectorAll("g.graph-node")).find((g) =>
      (g.textContent ?? "").includes("領収書整理"),
    ) as unknown as SVGGElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    // 領収書整理 を待っているのは、差し込んだ方だけ。元の親からは外れている。
    expect(text("inspector")).toContain("レシートを箱から出す");
    expect(text("inspector")).not.toContain("確定申告");
  });

  test("差し込みで同じ名前は作らせない", async () => {
    // 名前で参照を解決する経路があるので、同名が2つできると危ない（改名と同じ規則）。
    findButton("root-list", "確定申告")!.click();
    await tick();
    ($("center-body").querySelector(".graph-edge-hit") as unknown as SVGPathElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await tick();
    const input = $("modal").querySelector("input") as HTMLInputElement;
    input.value = "領収書整理";
    findButton("modal", "差し込む")!.click();
    await tick();
    expect(text("toast-stack")).toContain("同じ名前になります");
    expect($("modal-backdrop").classList.contains("hidden")).toBe(false); // 閉じない
  });

  test("ノードはすべての親より下の段に置く", async () => {
    // 最初に届いた深さで置くと、後から別の経路でもっと深い位置に来た親から、
    // 浅い段の子へ線が引かれる。同じ段どうし、あるいは下から上へ向かう線に
    // なって、曲線が潰れて「線の先にノードが無い」ように見える
    // （のっち報告 2026-09-03）。
    const id = (tail: string): string => `01M0DEEP${tail}${"0".repeat(14)}`;
    const md = (name: string, requires: string[]): string =>
      [
        "---",
        `name: ${name}`,
        "satisfied: false",
        requires.length === 0 ? "requires: []" : "requires:",
        ...requires.map((r) => `  - ${r}`),
        "contains: []",
        "---",
        "",
      ].join("\n");

    document.body.innerHTML = HTML;
    localStorage.clear();
    await startApp(
      new MemoryFs({
        // 目的 -> 途中 -> 合流、かつ 目的 -> 合流。合流は2つの親を持つ。
        [id("A0")]: md("目的", [id("B0"), id("C0")]),
        [id("B0")]: md("途中", [id("C0")]),
        [id("C0")]: md("合流", []),
      }),
    );
    findButton("root-list", "目的")!.click();
    await tick();

    const yOf = (label: string): number => {
      const g = Array.from($("center-body").querySelectorAll("g.graph-node")).find((n) =>
        (n.textContent ?? "").includes(label),
      )!;
      return Number(/translate\([\d.-]+,\s*([\d.-]+)\)/.exec(g.getAttribute("transform") ?? "")![1]);
    };

    // 合流は「途中」の子でもあるので、**途中より下**でなければならない。
    expect(yOf("合流")).toBeGreaterThan(yOf("途中"));

    // 上へ向かう線が1本も無いこと。ここが破れると曲線が潰れる。
    const upward = Array.from($("center-body").querySelectorAll<SVGPathElement>(".graph-edge")).filter((path) => {
      const n = (path.getAttribute("d") ?? "").match(/-?[\d.]+/g)!.map(Number);
      return n[1]! > n[n.length - 1]!;
    });
    expect(upward).toEqual([]);
  });

  test("ヘッダーには作る系のボタンを置かない", () => {
    // ヘッダーは「探す（検索）」「整える（自動解決）」の並び。作る系が1つだけ
    // 混ざっているのが分離感の出どころだった。
    expect(document.getElementById("import-btn")).toBeNull();
    expect(document.getElementById("reconcile-btn")).toBeTruthy();
  });
  const type = (ta: HTMLTextAreaElement, v: string): void => {
    ta.value = v;
    ta.dispatchEvent(new Event("input"));
  };
  const previewText = (): string =>
    Array.from($("modal").querySelectorAll(".hint"))
      .map((e) => e.textContent ?? "")
      .join(" ");

  test("入れ子と合流をそのまま書き下せる", async () => {
    // 「前提を一括追加」は requires のフラット1段だけ。contains の入れ子を
    // 作る道はここしかない。
    const ta = await openImport();
    type(ta, "機能を整える -> [一覧を整える] -> [Chain Viewを整える], 一覧を整える -> [進捗の重複を潰す], Chain Viewを整える -> [進捗の重複を潰す]");
    findButton("modal", "追加")!.click();
    await tick();
    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);

    $("search-input").dispatchEvent(new Event("input"));
    const input = $("search-input") as HTMLInputElement;
    input.value = "進捗の重複";
    input.dispatchEvent(new Event("input"));
    await tick();
    // 合流点として1ノードに解決される（2つ作られない）
    expect($("center-body").querySelectorAll(".hit").length).toBe(1);
    expect(text("center-body")).toContain("合流 2");
  });

  test("既存の名前を書けば繋がるだけで、新しくは作られない", async () => {
    const ta = await openImport();
    type(ta, "確定申告 -> [医療費の領収書を集める]");
    expect(previewText()).toContain("1 件を新しく作り、1 件は既存に繋ぎます");
    findButton("modal", "追加")!.click();
    await tick();
    const input = $("search-input") as HTMLInputElement;
    input.value = "確定申告";
    input.dispatchEvent(new Event("input"));
    await tick();
    expect($("center-body").querySelectorAll(".hit").length).toBe(1);
  });

  test("構文エラーは押す前に出す", async () => {
    const ta = await openImport();
    type(ta, "引っ越し ->");
    expect($("modal").querySelector(".hint.error")).toBeTruthy();
    // 押してからトーストで返すと、どこが悪いのか分からないまま同じ文字列を
    // 2回書くことになる。
    expect(previewText()).not.toContain("件を新しく作");
  });

  test("Ctrl+Enter で確定できる", async () => {
    const ta = await openImport();
    type(ta, "新しい目的A -> 新しい前提B");
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    await tick();
    expect($("modal-backdrop").classList.contains("hidden")).toBe(true);
    expect(text("breadcrumb")).toContain("新しい目的A");
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
  // 単語境界（word boundary）は使わない。書こうとしたエスケープが
  // **バックスペース文字そのもの**としてソースに埋まり、この正規表現は何にも
  // 一致しなくなっていた（2026-09-01、のっちの「自動解決の表示が ULID」報告から
  // 発覚。それまでの id 検査は全部空振りしていた）。reconcile.ts に生の NUL が
  // 埋まっていたのと同じ事故で、目で見ても分からない。26文字の連続さえ見れば
  // 境界は要らないので、エスケープを1つも使わない形にしてある。
  const ULID_RE = /[0-9A-HJKMNP-TV-Z]{26}/;

  test("検出器そのものが効いている", () => {
    // 否定の主張は、道具が壊れていても通ってしまう。陽性対照を1つ置いておく。
    expect(ULID_RE.test("01M0DEV0000000000000000000")).toBe(true);
    expect(ULID_RE.test("確定申告")).toBe(false);
  });

  test("起動直後の画面のどこにも id が出ていない", () => {
    // 個別に潰すと必ず取りこぼす。実際、輪の提示・削除トースト・一括追加の
    // 見出しを直した後にも、検索結果行のパンくずが id のままだった。
    // 画面全体を1回で見る。
    expect(ULID_RE.test(document.body.textContent ?? "")).toBe(false);
  });

  test("モーダルにも id が出ない", async () => {
    // 起動直後の画面だけ見ていたので、自動解決モーダルが id をそのまま並べて
    // いるのに気付けなかった（のっち報告、2026-09-01）。開くものは全部見る。
    $("reconcile-btn").click();
    await tick();
    expect(text("modal")).toContain("自動解決");
    expect(ULID_RE.test(text("modal"))).toBe(false);
    findButton("modal", "閉じる")!.click();
    await tick();

    $("new-root-btn").click();
    await tick();
    expect(ULID_RE.test(text("modal"))).toBe(false);
    findButton("modal", "キャンセル")!.click();
    await tick();

    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(ULID_RE.test(text("inspector"))).toBe(false);
    findButton("inspector", "前提を一括追加")!.click();
    await tick();
    expect(ULID_RE.test(text("modal"))).toBe(false);
  });

  test("自動解決は輪の中身を名前で並べる", async () => {
    // サンプルには輪がある＝「判断が必要」に必ず1件出る。中身が名前で出ることを
    // 直接押さえる（ULID_RE だけだと、空になっていても通ってしまう）。
    $("reconcile-btn").click();
    await tick();
    expect(text("modal")).toContain("実績を作る");
    expect(text("modal")).toContain("案件を取る");
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

describe("凡例", () => {
  const legendBtn = (): HTMLButtonElement => $("center-body").querySelector(".legend-btn") as HTMLButtonElement;
  const panel = (): HTMLElement => $("center-body").querySelector(".legend-panel") as HTMLElement;

  beforeEach(async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
  });

  test("既定では畳んである（追い出した文字を別の場所に戻さない）", () => {
    expect(legendBtn()).toBeTruthy();
    expect(panel().classList.contains("hidden")).toBe(true);
  });

  test("ホバーで開き、離れると閉じる", () => {
    legendBtn().dispatchEvent(new MouseEvent("mouseenter"));
    expect(panel().classList.contains("hidden")).toBe(false);
    legendBtn().dispatchEvent(new MouseEvent("mouseleave"));
    expect(panel().classList.contains("hidden")).toBe(true);
  });

  test("クリックで固定でき、もう一度で外れる", () => {
    legendBtn().click();
    legendBtn().dispatchEvent(new MouseEvent("mouseleave"));
    // ホバーだけだと読んでいる途中に手がずれて閉じる
    expect(panel().classList.contains("hidden")).toBe(false);
    legendBtn().click();
    expect(panel().classList.contains("hidden")).toBe(true);
  });

  test("4状態・線種2つ・弧・合流を説明する", () => {
    legendBtn().click();
    const body = panel().textContent ?? "";
    for (const label of ["今やれる", "前提待ち", "達成済み", "輪で詰まっている"]) {
      expect(body).toContain(label);
    }
    expect(body).toContain("これが必要（前提）");
    expect(body).toContain("これで構成（内包）");
    expect(body).toContain("下にあるものの進み具合");
    expect(body).toContain("何箇所から要求されているか");
  });

  test("見本はグラフと同じ印で描く（別の語彙にしない）", () => {
    // 凡例が本物と違う描き方だと、照らし合わせる側がもう一段の翻訳をする。
    legendBtn().click();
    const marks = panel().querySelectorAll(".legend-mark.graph-node .mark");
    expect(marks.length).toBe(4);
    expect(panel().querySelector(".legend-mark .graph-edge.contains")).toBeTruthy();
    expect(panel().querySelector(".legend-mark .ring.arc")).toBeTruthy();
  });
});

describe("前回開いていた場所を覚える", () => {
  /** localStorage は消さずに開き直す＝アプリを閉じて次の日に開いたのと同じ。 */
  const reopen = async (): Promise<void> => {
    document.body.innerHTML = HTML;
    await startApp(sampleFs());
  };

  test("潜った先で開き直すと、そこから始まる", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();

    await reopen();
    expect($("center-body").querySelector("svg")).toBeTruthy();
    expect(text("breadcrumb")).toContain("Sirube をリリースする");
    // グラフに立つときは必ず何かを選んでいる。ここが崩れると詳細パネルだけ
    // 空のグラフ画面になる。
    expect(document.body.classList.contains("no-inspector")).toBe(false);
  });

  test("俯瞰していたら俯瞰から始まる", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    buttonsIn("breadcrumb").find((b) => b.textContent === "俯瞰")!.click();
    await tick();

    await reopen();
    expect(text("breadcrumb")).toContain("Sirube をリリースする の配下");
  });

  test("検索語は覚えない", async () => {
    // ここまで覚えると、開いた瞬間に出るのは前回の続きではなく前回の道具立てになる。
    const input = $("search-input") as HTMLInputElement;
    input.value = "README";
    input.dispatchEvent(new Event("input"));
    await tick();
    expect(text("breadcrumb")).toContain("検索結果");

    await reopen();
    expect(text("breadcrumb")).toContain("今やれること");
    expect(($("search-input") as HTMLInputElement).value).toBe("");
  });

  test("覚えていたノードが消えていたら TOP から始まる", async () => {
    // 外のエディタや git のマージでファイルが減るのは日常の経路。存在しない
    // id を指したまま描くと、名前の出ないグラフができる。
    localStorage.setItem("sirube.place", JSON.stringify({ mode: "graph", focusId: "01NOTHERE", trail: ["01GONE"] }));
    await reopen();
    expect(text("breadcrumb")).toContain("今やれること");
    // 「svg が無い」では見ない——一覧の行にもアイコンの svg が入っている。
    expect($("center-body").classList.contains("graph")).toBe(false);
  });

  test("壊れた値が入っていても起動する", async () => {
    localStorage.setItem("sirube.place", "{ここで切れている");
    await reopen();
    expect(text("breadcrumb")).toContain("今やれること");
    expect(text("center-body")).toContain("READMEとマニュアルを書く");
  });
});

describe("付箋（目的に貼る色）", () => {
  const swatches = (): HTMLButtonElement[] =>
    Array.from($("inspector").querySelectorAll(".swatch")) as HTMLButtonElement[];
  const pick = (color: string): HTMLButtonElement =>
    swatches().find((b) => b.classList.contains(`swatch-${color}`))!;
  const rowCard = (label: string): HTMLElement =>
    Array.from($("center-body").querySelectorAll(".hit")).find((c) =>
      (c.textContent ?? "").includes(label),
    ) as HTMLElement;

  test("目的にだけ貼れる。末端には欄そのものが出ない", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect(swatches().length).toBe(7); // 「貼らない」＋ 6色

    // 末端まで貼れるようにすると、それは model.ts の原則4 が禁じているタグ
    // そのものになる。目的（入次数0）だけを例外にしてある。
    $("nav-actionable").click();
    await tick();
    (Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("領収書整理"),
    ) as HTMLButtonElement).click();
    await tick();
    expect(swatches().length).toBe(0);
  });

  test("貼るとサイドバーと一覧に出る。同じ色をもう一度押すと外れる", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    pick("pink").click();
    await tick();
    expect(findButton("root-list", "確定申告")!.querySelector(".goal-tag-pink")).toBeTruthy();

    // 一覧の行は「どの目的の下か」で色が付く。領収書整理は確定申告の下。
    $("nav-actionable").click();
    await tick();
    expect(rowCard("領収書整理").querySelector(".hit-tag")).toBeTruthy();
    expect(rowCard("READMEとマニュアルを書く").querySelector(".hit-tag")).toBeNull();

    findButton("root-list", "確定申告")!.click();
    await tick();
    pick("pink").click();
    await tick();
    expect(findButton("root-list", "確定申告")!.querySelector(".goal-tag")).toBeNull();
  });

  test("貼った色はファイルに残る（開き直しても消えない）", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    pick("blue").click();
    await tick();
    expect($("inspector").querySelector(".swatch-blue")!.classList.contains("on")).toBe(true);
  });

  test("俯瞰では帯を出さない（全行が同じ目的の下）", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();
    pick("green").click();
    await tick();
    (Array.from($("breadcrumb").querySelectorAll("button")).find(
      (b) => b.textContent === "俯瞰",
    ) as HTMLButtonElement).click();
    await tick();
    // 絞った時点で全行が同じ色になる。パンくずを消しているのと同じ理由。
    expect($("center-body").querySelector(".hit-tag")).toBeNull();
  });
});

describe("グラフのノードを押したとき", () => {
  const graphNode = (label: string): SVGGElement =>
    Array.from($("center-body").querySelectorAll("g.graph-node")).find((g) =>
      (g.textContent ?? "").includes(label),
    ) as unknown as SVGGElement;
  const clickNode = async (label: string): Promise<void> => {
    graphNode(label).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  };

  test("下に何も無いノードは潜らない。選ぶだけ", async () => {
    findButton("root-list", "確定申告")!.click();
    await tick();

    // 確定申告 -> 領収書整理（末端）。潜っても丸1つの画面になるだけで、
    // 戻るのに1クリック要る（のっち報告 2026-09-03）。
    await clickNode("領収書整理");
    expect(text("breadcrumb")).not.toContain("領収書整理");
    // 潜って得られるものは、選んだときに右パネルへ出るものと同じ。
    expect(text("inspector")).toContain("領収書整理");
    // 押した手応えとして、グラフ側にも今どれを出しているかの印が要る。
    expect(graphNode("領収書整理").classList.contains("selected")).toBe(true);
  });

  test("参照だけあって実体の無い子は「下にある」と数えない", async () => {
    // 数えると、潜った先が空のまま「潜れるノード」に見える。sample にこの形が
    // 無いので、この検査のためだけに最小の vault を組む。id は Crockford Base32
    // （I / L / O / U を含まない26文字）でないと isUlid() に弾かれる。
    const id = (tail: string): string => `01M0TEST${tail}${"0".repeat(16)}`;
    const md = (name: string, requires: string[]): string =>
      [
        "---",
        `name: ${name}`,
        "satisfied: false",
        requires.length === 0 ? "requires: []" : "requires:",
        ...requires.map((r) => `  - ${r}`),
        "contains: []",
        "---",
        "",
      ].join("\n");

    document.body.innerHTML = HTML;
    localStorage.clear();
    await startApp(
      new MemoryFs({
        [id("A0")]: md("親", [id("B0"), id("C0")]),
        [id("B0")]: md("幽霊持ち", [id("ZZ")]), // ZZ のファイルは作らない
        [id("C0")]: md("実子持ち", [id("D0")]),
        [id("D0")]: md("孫", []),
      }),
    );
    findButton("root-list", "親")!.click();
    await tick();

    // 陽性対照。実体のある子を持つ方は、これまでどおり潜れる。
    // これが無いと、クリックが丸ごと壊れていても下の否定検査は通る。
    await clickNode("実子持ち");
    expect(text("breadcrumb")).toContain("実子持ち");

    findButton("root-list", "親")!.click();
    await tick();
    await clickNode("幽霊持ち");
    expect(text("breadcrumb")).not.toContain("幽霊持ち");
    expect(text("inspector")).toContain("幽霊持ち");
  });

  test("下に何かあるノードはこれまでどおり潜る", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await clickNode("MVP実装完了");
    expect(text("breadcrumb")).toContain("MVP実装完了");
    expect($("center-body").querySelector("svg")).toBeTruthy();
  });

  test("入ったノードをもう一度押すと1つ戻る（入口と出口を同じにする）", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await clickNode("MVP実装完了");
    expect(text("breadcrumb")).toContain("MVP実装完了");

    // 焦点になっている当人を押す。潜る前の場所が中心に戻る。
    await clickNode("MVP実装完了");
    expect(text("breadcrumb")).not.toContain("MVP実装完了");
    expect(text("breadcrumb")).toContain("Sirube をリリースする");
    // 見ていたものは変えない。上がった拍子に右パネルが差し替わると、
    // 戻ったのか飛んだのか分からなくなる。
    expect(text("inspector")).toContain("MVP実装完了");
  });

  test("2段潜ってから2回押すと、1段ずつ戻る", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await clickNode("MVP実装完了");
    await clickNode("Markdownノードストア");
    expect(text("breadcrumb")).toContain("Markdownノードストア");

    await clickNode("Markdownノードストア");
    expect(text("breadcrumb")).toContain("MVP実装完了");
    expect(text("breadcrumb")).not.toContain("Markdownノードストア");

    await clickNode("MVP実装完了");
    expect(text("breadcrumb")).toContain("Sirube をリリースする");
    expect(text("breadcrumb")).not.toContain("MVP実装完了");
  });

  test("潜っていなければ押しても動かない。選び直すだけ", async () => {
    // パンくずの左隣は「今やれること」だが、そこまで飛ばすと**潜っていないのに
    // 画面が変わる**。TOP へ出るのはパンくずの役で、ここは潜ったぶんしか戻さない。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    const before = text("breadcrumb");
    await clickNode("Sirube をリリースする");
    expect(text("breadcrumb")).toBe(before);
    expect(text("inspector")).toContain("Sirube をリリースする");
  });
});

describe("右パネルの整理", () => {
  /** 目的ならサイドバーから、そうでなければ `Sirube をリリースする` の
   *  グラフから選ぶ（メモがあるノードは目的の下にいる）。 */
  const openNode = async (name: string): Promise<void> => {
    const root = findButton("root-list", name);
    if (root) {
      root.click();
      await tick();
      return;
    }
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes(name))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  };

  test("ゴールと削除は「その他」に畳んである", async () => {
    // どちらも**たまにしか押さないが、押す前に読ませたい説明がある**もの。
    // 日々のゴール切り替えは右クリックにもあるので、開きっぱなしにしない。
    await openNode("Sirube をリリースする");
    expect(findButton("inspector", "地図から外す")).toBeUndefined();
    expect(findButton("inspector", "このノードを削除")).toBeUndefined();

    findButton("inspector", "その他")!.click();
    await tick();
    expect(findButton("inspector", "地図から外す")).toBeTruthy();
    expect(findButton("inspector", "このノードを削除")).toBeTruthy();
  });

  test("「その他」の開閉はノードを選び直しても続く", async () => {
    // ノードごとに畳み直すと、続けて同じ操作をするときに毎回開くことになる。
    await openNode("Sirube をリリースする");
    findButton("inspector", "その他")!.click();
    await tick();
    await openNode("確定申告");
    expect(findButton("inspector", "このノードを削除")).toBeTruthy();
  });

  test("上向きリンクに × を置かない（外すは右クリック）", async () => {
    await openNode("確定申告");
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes("領収書整理"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
    expect(text("inspector")).toContain("これを待っている");
    expect($("inspector").querySelector(".insp-cut")).toBeNull();
  });

  test("メモは閲覧が既定。「編集」で入力欄になり、「閲覧」で書き戻す", async () => {
    await openNode("マネタイズ方針を決める"); // サンプルにメモがある
    expect($("inspector").querySelector(".note-view")).toBeTruthy();
    expect($("inspector").querySelector(".note-area")).toBeNull();
    expect(text("inspector")).toContain("Ko-fi");

    findButton("inspector", "編集")!.click();
    await tick();
    const area = $("inspector").querySelector(".note-area") as HTMLTextAreaElement;
    expect(area).toBeTruthy();
    area.value = "書き換えた";

    findButton("inspector", "閲覧")!.click();
    await tick();
    await tick();
    expect($("inspector").querySelector(".note-area")).toBeNull();
    expect(text("inspector")).toContain("書き換えた");
  });

  test("メモが空なら、閲覧モードでもそう言う", async () => {
    await openNode("READMEとマニュアルを書く");
    expect(text("inspector")).toContain("まだメモはありません");
  });

  test("別のノードを開くと編集モードは閉じる", async () => {
    // 書く顔のまま別のノードに移ると、どれを書いているのか分からなくなる。
    await openNode("マネタイズ方針を決める");
    findButton("inspector", "編集")!.click();
    await tick();
    expect($("inspector").querySelector(".note-area")).toBeTruthy();

    await openNode("確定申告");
    expect($("inspector").querySelector(".note-area")).toBeNull();
  });
});

describe("右クリックのメニュー", () => {
  const menu = (): HTMLElement | null => document.querySelector(".ctx-menu");
  const menuLabels = (): string[] =>
    Array.from(document.querySelectorAll(".ctx-item")).map((b) => b.textContent ?? "");
  const menuItem = (label: string): HTMLButtonElement =>
    Array.from(document.querySelectorAll(".ctx-item")).find((b) =>
      (b.textContent ?? "").includes(label),
    ) as HTMLButtonElement;
  const rightClick = async (target: Element): Promise<MouseEvent> => {
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 });
    target.dispatchEvent(ev);
    await tick();
    return ev;
  };
  const node = (label: string): Element =>
    Array.from($("center-body").querySelectorAll("g.graph-node")).find((g) =>
      (g.textContent ?? "").includes(label),
    )!;

  const openGraph = async (): Promise<void> => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
  };

  test("ノードを右クリックすると、既定のメニューを止めて自前のものを出す", async () => {
    await openGraph();
    const ev = await rightClick(node("MVP実装完了"));
    // 既定を止めていないと、WebView2 の「再読み込み」等が重なって出る
    expect(ev.defaultPrevented).toBe(true);
    expect(menuLabels().join(" ")).toContain("達成にする");
    expect(menuLabels().join(" ")).toContain("前提を一括追加");
    // 右クリックでも選ぶ。閉じたあとに右のパネルが別のものを指していると、
    // どれを触ったのか分からなくなる。
    expect(text("inspector")).toContain("MVP実装完了");
  });

  test("線を右クリックすると、差し込むと外すが同じ場所に出る", async () => {
    // 外す側はインスペクタの上向きリンクにホバーしないと出なかった。
    await openGraph();
    const ev = await rightClick($("center-body").querySelector(".graph-edge-hit")!);
    expect(ev.defaultPrevented).toBe(true);
    expect(menuLabels().join(" ")).toContain("間にノードを差し込む");
    expect(menuLabels().join(" ")).toContain("を外す");
  });

  test("メニューから外すと、その繋がりだけが消える", async () => {
    await openGraph();
    await rightClick($("center-body").querySelector(".graph-edge-hit")!);
    menuItem("を外す").click();
    await tick();
    await tick();
    // 押した時点でメニューは閉じる（描き直しの前に閉じないと宙に浮く）
    expect(menu()).toBeNull();
    expect(text("toast-stack")).toContain("外しました");
  });

  test("地の右クリックは作る系だけ", async () => {
    await openGraph();
    await rightClick($("center-body").querySelector(".graph-wrap")!);
    expect(menuLabels().join(" ")).toContain("目的を1つ作る");
    expect(menuLabels().join(" ")).toContain("まとめて追加");
    expect(menuLabels().join(" ")).not.toContain("達成");
  });

  test("地図では降りる口を足す（左クリックは選ぶだけなので）", async () => {
    await openGraph();
    Array.from($("breadcrumb").querySelectorAll("button"))
      .find((b) => b.textContent === "地図")!
      .click();
    await tick();
    await rightClick(node("確定申告"));
    expect(menuLabels().join(" ")).toContain("グラフで開く");
  });

  test("Escape と外側のクリックで閉じる", async () => {
    await openGraph();
    await rightClick(node("MVP実装完了"));
    expect(menu()).toBeTruthy();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu()).toBeNull();

    await rightClick(node("MVP実装完了"));
    expect(menu()).toBeTruthy();
    document.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).toBeNull();
  });

  test("メモは閲覧のときだけ奪う（編集中は貼り付けが要る）", async () => {
    await openGraph();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes("マネタイズ方針を決める"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const viewEv = await rightClick($("inspector").querySelector(".note-view")!);
    expect(viewEv.defaultPrevented).toBe(true);
    expect(menuLabels().join(" ")).toContain("編集する");
    expect(menuLabels().join(" ")).toContain("メモをコピー");

    // 「編集する」で入力欄になる
    menuItem("編集する").click();
    await tick();
    const area = $("inspector").querySelector(".note-area")!;
    expect(area).toBeTruthy();

    // 入力欄の上では**奪わない**。ここを潰すと貼り付けができなくなる。
    const editEv = await rightClick(area);
    expect(editEv.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
  });

  test("メモの文字を選んでいるときは奪わない（既定のコピーを残す）", async () => {
    await openGraph();
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes("マネタイズ方針を決める"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    const body = $("inspector").querySelector(".note-view")!;
    const range = document.createRange();
    range.selectNodeContents(body);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(sel.toString()).not.toBe(""); // 陽性対照。選べていないと検査にならない

    const ev = await rightClick(body);
    expect(ev.defaultPrevented).toBe(false);
    expect(menu()).toBeNull();
    sel.removeAllRanges();
  });

  test("削除は載せない（取り消しが無いので、確認のあるインスペクタに残す）", async () => {
    await openGraph();
    await rightClick(node("MVP実装完了"));
    // **「無い」だけを見ない。** メニューごと出ていなくても通ってしまう。
    expect(menu()).toBeTruthy();
    expect(menuLabels().join(" ")).not.toContain("削除");
  });
});

describe("ゴールの地図（もっと俯瞰）", () => {
  const crumb = (): string => text("breadcrumb");
  const toggle = (label: string): HTMLButtonElement =>
    Array.from($("breadcrumb").querySelectorAll("button")).find((b) => b.textContent === label) as HTMLButtonElement;
  const mapLabels = (): string[] =>
    Array.from($("center-body").querySelectorAll(".graph-node .label")).map((t) => t.textContent ?? "");
  /** パンくずの切り替えは2打目を 400ms 飲む（同じ位置に逆向きのボタンが出るため）。
   *  往復を試すテストは、その窓を跨いでから押す。 */
  const pastGuard = (): Promise<void> => new Promise((r) => setTimeout(r, 420));
  const clickNode = async (label: string): Promise<void> => {
    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes(label))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();
  };

  /** `Tauriシェル` をゴールに立てる。`Sirube をリリースする` からは
   *  `MVP実装完了` を1つ挟んだ先にいるので、畳んだ件数の検査にも使える。 */
  const declareTauriGoal = async (): Promise<void> => {
    const input = $("search-input") as HTMLInputElement;
    input.value = "Tauriシェル";
    input.dispatchEvent(new Event("input"));
    await tick();
    const row = Array.from($("center-body").querySelectorAll(".hit-main")).find((b) =>
      (b.textContent ?? "").includes("Tauriシェル"),
    ) as HTMLButtonElement;
    row.click();
    await tick();
    await openMore();
    findButton("inspector", "地図に出す")!.click();
    await tick();
  };

  test("入次数0のノードは自動でゴール。それでも地図から外せる", async () => {
    // 以前はここでボタンを出していなかった（外しても次の読み込みで戻るため）。
    // `goal: false` を降格として保存するようにして、外せるようにした（2026-09-11）。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await openMore();
    expect(text("inspector")).toContain("書かなくてもゴールです");
    // 外すと一帯が地図から消えることを、押す前に読める位置に出す
    expect(text("inspector")).toContain("先にそちらを出しておいて");

    findButton("inspector", "地図から外す")!.click();
    await tick();
    expect(findButton("inspector", "地図に出す")).toBeTruthy();
    expect(text("inspector")).toContain("地図から外してあります");
  });

  test("地図へ上がると、今いる場所を包む一番近いゴールが現在地になる", async () => {
    // 全体を出しても、自分がどこに居たのかは要る。深いところで作業していた人に
    // 印の無い全体図を見せると、迷子の逆になる。
    await declareTauriGoal();
    toggle("地図").click();
    await tick();
    // 立てた本人がゴールなので、その場が現在地
    expect(crumb()).toContain("Tauriシェル");
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeTruthy();
    expect(($("center-body").querySelector(".graph-node.focused")?.textContent ?? "")).toContain("Tauriシェル");
  });

  test("地図は根が何本あっても1枚に出す", async () => {
    // 焦点から下だけを描いていた頃は、根が増えた瞬間に丸1つの画面になった
    // （実データで、終わらない根2本を降格した直後に10件中5件がそうなった）。
    // **押しても絵が変わらないので、何が起きたのか分からない。**
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    const labels = mapLabels();
    expect(labels).toContain("Sirube をリリースする");
    expect(labels).toContain("確定申告");
    expect(labels).toContain("ポートフォリオを公開する");
  });

  test("地図でゴールを押すと、絵は変わらず現在地だけ移る", async () => {
    // 地図は全体で1枚なので、潜って中心を移す意味が無い。動くのは現在地と
    // 「グラフ」で降りる先だけ——押すたびに絵が組み替わると、地図として読めない。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    const before = mapLabels();

    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes("確定申告"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(mapLabels()).toEqual(before);
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeTruthy();
    expect(crumb()).toContain("確定申告");
    expect(text("inspector")).toContain("確定申告");

    // 選んだゴールが「グラフ」の降り先になる
    await pastGuard();
    toggle("グラフ").click();
    await tick();
    expect(mapLabels()).toContain("領収書整理");
  });

  test("地図で現在地のゴールを押しても、地図から落ちない", async () => {
    // 「押すと1つ戻る」を足したときの足元の穴。地図に上がると道は空になるので、
    // 戻り先が無い。ここで TOP へ出したり、グラフへ降りたりすると、
    // **押した覚えのない縮尺に落ちる**。
    await declareTauriGoal();
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    const before = crumb();

    Array.from($("center-body").querySelectorAll("g.graph-node"))
      .find((g) => (g.textContent ?? "").includes("Sirube をリリースする"))!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await tick();

    expect(crumb()).toBe(before);
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeTruthy();
  });

  test("「地図」でゴールだけになり、間に畳んだ件数が線に出る", async () => {
    await declareTauriGoal();
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();

    // 現在地は、今いた場所を包む一番近いゴール
    expect(crumb()).toContain("地図");
    expect(crumb()).toContain("Sirube をリリースする");
    const labels = mapLabels();
    expect(labels).toContain("Tauriシェル");
    // 間のノードは畳まれている
    expect(labels).not.toContain("MVP実装完了");
    // 畳んだ数は線に残る（MVP実装完了 の1件）
    // `<title>` を内側に持つので textContent は数字＋説明になる。数字が頭に来る。
    const counts = Array.from($("center-body").querySelectorAll(".edge-between")).map((t) => t.textContent ?? "");
    expect(counts.some((c) => c.startsWith("1"))).toBe(true);
    expect(counts.some((c) => c.includes("間に 1 件"))).toBe(true);
  });

  test("地図の状態は実グラフから引く（畳んだ前提を消さない）", async () => {
    // `Tauriシェル` は `Rustツールチェーンを入れる` 待ちで BLOCKED。商グラフの
    // 上で状態を導くと前提ごと畳まれて ACTIONABLE に見える——**そうなっていない**
    // ことを見る。`core/goals.test.ts` に、同じ食い違いの陽性対照がある。
    await declareTauriGoal();
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    const node = Array.from($("center-body").querySelectorAll(".graph-node")).find((n) =>
      (n.textContent ?? "").includes("Tauriシェル"),
    )!;
    expect(node.classList.contains("st-BLOCKED")).toBe(true);
  });

  test("「グラフ」で元の縮尺へ戻る", async () => {
    await declareTauriGoal();
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    await pastGuard();
    toggle("グラフ").click();
    await tick();
    // 札が消える（ボタンの「地図」は詳細でも出ているので、札で見る）
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeNull();
    expect(mapLabels()).toContain("MVP実装完了");
  });

  test("地図では俯瞰を出さない（同じ場所で往復する切り替えにする）", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    expect(toggle("俯瞰")).toBeUndefined();
    expect(toggle("グラフ")).toBeTruthy();
  });

  test("サイドバーから目的を選び直すと詳細の縮尺に戻る", async () => {
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    toggle("地図").click();
    await tick();
    findButton("root-list", "確定申告")!.click();
    await tick();
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeNull();
    expect(mapLabels()).toContain("領収書整理");
  });

  test("ゴールを選ばずに降りると、上がる前の場所へ戻る", async () => {
    // 眺めて降りただけなら、入ったところから出る。ここが効かないと、上がる前より
    // 浅い場所に降ろされる（実データで66ノード中54、平均2.4段ぶん）。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await clickNode("MVP実装完了");
    await clickNode("Markdownノードストア");
    const before = crumb();

    toggle("地図").click();
    await tick();
    await pastGuard();
    toggle("グラフ").click();
    await tick();

    expect(crumb()).toBe(before);
    expect(mapLabels()).toContain("新リポジトリを作る");
  });

  test("上にゴールが無い場所から上がると、現在地を出さない", async () => {
    // 降格した根の下には、包むゴールが1つも無い。以前はここで id の若い順に
    // 選んでいたので、**無関係なゴールに「今ここ」の印が付いていた**
    // （のっち報告 2026-09-12）。出せないときは出さない。
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    await openMore();
    findButton("inspector", "地図から外す")!.click();
    await tick();
    await clickNode("MVP実装完了");

    toggle("地図").click();
    await tick();
    expect($("breadcrumb").querySelector(".crumb-layer")).toBeTruthy();
    expect(crumb()).toContain("全体");
    expect($("center-body").querySelector(".graph-node.focused")).toBeNull();
    // 地図そのものは出ている（降格していない目的が並ぶ）
    expect(mapLabels()).toContain("確定申告");

    // 何も選んでいないので、降りると上がる前の場所へ戻る
    await pastGuard();
    toggle("グラフ").click();
    await tick();
    expect(crumb()).toContain("MVP実装完了");
  });

  test("凡例は縮尺で差し替わる（地図では点線と線の上の数字）", async () => {
    // 地図の線は縮約で1種類に畳まれた点線なのに、凡例は実線＝前提／破線＝内包を
    // 出したままだった。**画面に無いものを説明し、出ている数字を説明していない**
    // （のっち「エッジの数字ってなに？」2026-09-12）。
    const legend = (): string => $("center-body").querySelector(".legend-panel")?.textContent ?? "";
    findButton("root-list", "Sirube をリリースする")!.click();
    await tick();
    expect(legend()).toContain("これで構成（内包）");
    expect(legend()).toContain("何箇所から要求されているか");
    expect(legend()).not.toContain("畳んだ件数");

    toggle("地図").click();
    await tick();
    expect(legend()).toContain("この先にあるゴール");
    expect(legend()).toContain("間に畳んだ件数");
    expect(legend()).toContain("いくつのゴールがここを通るか");
    expect(legend()).not.toContain("これで構成（内包）");
  });

  test("付箋はゴールに貼れる（目的が1本に畳まれても死なない）", async () => {
    await declareTauriGoal();
    // 宣言したゴールにも付箋の列が出る。以前は入次数0だけが対象だった。
    expect($("inspector").querySelectorAll(".swatch").length).toBeGreaterThan(0);
  });
});
