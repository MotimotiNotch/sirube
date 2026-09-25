// 初回起動のチュートリアル。happy-dom 上にアプリを載せ、**本物のボタンを押して**
// 目的 → 前提 → 中身 → 達成 → 片付け まで通る。見た目と操作感はのっちが実機で見る。

import { beforeEach, describe, expect, test } from "bun:test";

import { ensureDom } from "./test-dom.ts";

ensureDom();

const { startApp } = await import("./app.ts");
const { sampleFs } = await import("../dev/sample.ts");
const { MemoryFs } = await import("../store/fs.ts");
const { TOUR_DONE_KEY } = await import("./tutorial.ts");

const HTML = (await Bun.file("index.html").text())
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const card = (): HTMLElement | null => document.querySelector(".tour-card");
const cardText = (): string => card()?.textContent ?? "";
const target = (): Element | null => document.querySelector(".tour-target");
const buttonIn = (root: Element | null, label: string): HTMLButtonElement | undefined =>
  Array.from(root?.querySelectorAll("button") ?? []).find((b) => (b.textContent ?? "").includes(label)) as
    | HTMLButtonElement
    | undefined;
const modal = (): HTMLElement => document.getElementById("modal")!;
const tour = (name: string): HTMLElement => document.querySelector(`[data-tour="${name}"]`) as HTMLElement;
/** ノードを選ぶ。チュートリアルが光らせている札（`data-node-id`）を押す。 */
const pickNode = async (): Promise<void> => {
  const t = target();
  expect(t?.getAttribute("data-node-id")).toBeTruthy();
  t!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await tick();
};
/** 「分解する」のモーダルに書いて追加する。 */
const decompose = async (tab: "requires" | "contains", lines: string): Promise<void> => {
  tour("decompose").click();
  await tick();
  if (tab === "contains") {
    tour("tab-contains").click();
    await tick();
  }
  const ta = modal().querySelector("textarea") as HTMLTextAreaElement;
  ta.value = lines;
  buttonIn(modal(), "追加")!.click();
  await tick();
  await tick();
};

beforeEach(() => {
  document.body.innerHTML = HTML;
  localStorage.clear();
  document.querySelectorAll(".tour-card").forEach((c) => c.remove());
});

describe("チュートリアル", () => {
  test("空の vault で始まり、最初は「＋」を光らせる", async () => {
    await startApp(new MemoryFs({}));
    expect(cardText()).toContain("1 / 5");
    expect(target()?.id).toBe("new-root-btn");
  });

  test("既にデータがある vault では出ない", async () => {
    await startApp(sampleFs());
    expect(card()).toBeNull();
  });

  test("一度済ませたら、空の vault でも自動では出ない。「使い方」からは始められる", async () => {
    localStorage.setItem(TOUR_DONE_KEY, "1");
    await startApp(new MemoryFs({}));
    expect(card()).toBeNull();
    (document.getElementById("tour-btn") as HTMLButtonElement).click();
    await tick();
    expect(cardText()).toContain("1 / 5"); // 陽性対照: ボタンからは始まる
  });

  test("目的 → 前提 → 中身 → 達成 → 片付けを本物の操作で通れる", async () => {
    const fs = new MemoryFs({});
    await startApp(fs);

    // ① 目的
    (document.getElementById("new-root-btn") as HTMLButtonElement).click();
    await tick();
    (modal().querySelector("input") as HTMLInputElement).value = "引っ越す";
    buttonIn(modal(), "作成")!.click();
    await tick();
    await tick();
    expect(cardText()).toContain("2 / 5");
    // 作ると目的が選ばれているので、次に押すのは「分解する」
    expect(target()?.getAttribute("data-tour")).toBe("decompose");

    // ② 前提
    await decompose("requires", "荷造りを終える");
    expect(cardText()).toContain("3 / 5");
    // 目的が選ばれたままなので、まず前提のノードを選ばせる
    expect(cardText()).toContain("『荷造りを終える』を選んでください");
    await pickNode();
    expect(target()?.getAttribute("data-tour")).toBe("decompose");

    // ③ 中身
    await decompose("contains", "本を箱に詰める\n服を箱に詰める");
    expect(cardText()).toContain("4 / 5");

    // ④ 達成: 中身を1つずつ選んで達成にする
    for (let i = 0; i < 2; i++) {
      await pickNode();
      expect(target()?.getAttribute("data-tour")).toBe("toggle");
      tour("toggle").click();
      await tick();
      await tick();
    }
    expect(cardText()).toContain("5 / 5");
    expect(cardText()).toContain("「今やれる」になりました");

    // ⑤ 片付け: 1件だけ自分で消す
    await pickNode();
    expect(target()?.getAttribute("data-tour")).toBe("more");
    tour("more").click();
    await tick();
    tour("delete").click();
    await tick();
    await tick();
    expect(target()?.getAttribute("data-tour")).toBe("delete-confirm");
    tour("delete-confirm").click();
    await tick();
    await tick();

    // 残りをまとめて消すか聞かれる
    expect(cardText()).toContain("残り 3 件");
    buttonIn(card(), "まとめて削除")!.click();
    await tick();
    await tick();
    expect(card()).toBeNull();
    expect((await fs.listNodes()).length).toBe(0);
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe("1");
  });

  test("途中でスキップすると、作ったものを消すか聞く。「残す」なら残る", async () => {
    const fs = new MemoryFs({});
    await startApp(fs);
    (document.getElementById("new-root-btn") as HTMLButtonElement).click();
    await tick();
    (modal().querySelector("input") as HTMLInputElement).value = "引っ越す";
    buttonIn(modal(), "作成")!.click();
    await tick();
    await tick();

    buttonIn(card(), "スキップ")!.click();
    await tick();
    expect(cardText()).toContain("チュートリアルで作った 1 件");
    buttonIn(card(), "残す")!.click();
    await tick();
    expect(card()).toBeNull();
    expect((await fs.listNodes()).length).toBe(1);
  });

  test("何も作らずにスキップしたら、聞かずに終わる", async () => {
    await startApp(new MemoryFs({}));
    buttonIn(card(), "スキップ")!.click();
    await tick();
    expect(card()).toBeNull();
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe("1");
  });
});
