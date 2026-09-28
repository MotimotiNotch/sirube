// 初回起動のチュートリアル。happy-dom 上にアプリを載せ、**本物のボタンを押して**
// 目的 → 前提 → 中身 → 達成 → 片付け まで通る。見た目と操作感はのっちが実機で見る。

import { beforeEach, describe, expect, test } from "bun:test";

import { ensureDom } from "./test-dom.ts";

ensureDom();

const { startApp } = await import("./app.ts");
const { sampleFs } = await import("../dev/sample.ts");
const { MemoryFs } = await import("../store/fs.ts");
const { TOUR_DONE_KEY, placeCard, shadePath, visibleIn } = await import("./tutorial.ts");

const HTML = (await Bun.file("index.html").text())
  .replace(/[\s\S]*<body>/, "")
  .replace(/<\/body>[\s\S]*/, "")
  .replace(/<script[\s\S]*?<\/script>/g, "");

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const card = (): HTMLElement | null => document.querySelector(".tour-card");
const cardText = (): string => card()?.textContent ?? "";
const target = (): Element | null => document.querySelector(".tour-target");
const shade = (): HTMLElement | null => document.querySelector(".tour-shade");
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
  document.querySelectorAll(".tour-card, .tour-shade").forEach((c) => c.remove());
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
    // 「使い方」はマニュアルを開き（2026-09-28）、チュートリアルはその先頭から
    (document.getElementById("tour-btn") as HTMLButtonElement).click();
    await tick();
    expect(card()).toBeNull();
    buttonIn(document.getElementById("center-body"), "チュートリアルをもう一度")!.click();
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
    // 片付けは押す場所が無いので、カードのボタン以外を全部暗くする
    expect(shade()).not.toBeNull();
    buttonIn(card(), "残す")!.click();
    await tick();
    expect(card()).toBeNull();
    expect(shade()).toBeNull();
    expect((await fs.listNodes()).length).toBe(1);
  });

  test("何も作らずにスキップしたら、聞かずに終わる", async () => {
    await startApp(new MemoryFs({}));
    buttonIn(card(), "スキップ")!.click();
    await tick();
    expect(card()).toBeNull();
    expect(localStorage.getItem(TOUR_DONE_KEY)).toBe("1");
  });

  test("押す場所が見えていれば幕を出して穴を開け、カードをその下に置く。モーダルが開いたら幕は外す", async () => {
    const btn = document.getElementById("new-root-btn")!;
    btn.getBoundingClientRect = () => ({ left: 20, top: 100, right: 44, bottom: 124, width: 24, height: 24, x: 20, y: 100 }) as DOMRect;
    await startApp(new MemoryFs({}));
    expect(target()?.id).toBe("new-root-btn");
    expect(shade()).not.toBeNull();
    expect(shade()!.style.clipPath).toContain("evenodd");
    expect(card()!.classList.contains("placed")).toBe(true);
    expect(card()!.style.top).toBe("136px"); // 押す場所の下端 124 + 間 12

    btn.click();
    await tick();
    expect(document.getElementById("modal-backdrop")!.classList.contains("hidden")).toBe(false);
    expect(shade()).toBeNull(); // モーダル自身が暗くしている。重ねると入力欄まで塞ぐ
  });

  test("押す場所が画面に見えていなければ幕を出さない（パンで外れたノードを戻せなくなるため）", async () => {
    await startApp(new MemoryFs({})); // happy-dom では大きさ0 = 見えていない扱い
    expect(target()?.id).toBe("new-root-btn");
    expect(shade()).toBeNull();
    expect(card()!.classList.contains("placed")).toBe(false); // 陰性: 左下のまま
  });
});

describe("幕とカードの置き場所（計算だけ）", () => {
  const r = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });
  const size = { w: 300, h: 120 };

  test("押す場所の下に置く", () => {
    expect(placeCard([r(100, 100, 40, 30)], [r(100, 100, 40, 30)], size, 1200, 800)).toEqual({ left: 100, top: 142 });
  });

  test("下に入らなければ上、上下とも無理なら右", () => {
    expect(placeCard([r(100, 700, 40, 30)], [r(100, 700, 40, 30)], size, 1200, 800)).toEqual({ left: 100, top: 568 });
    const tall = r(100, 20, 40, 760);
    expect(placeCard([tall], [tall], size, 1200, 800)?.left).toBe(152);
  });

  test("画面の右端では左へ寄せる", () => {
    const t = r(1150, 100, 40, 30);
    expect(placeCard([t], [t], size, 1200, 800)).toEqual({ left: 1200 - 300 - 8, top: 142 });
  });

  test("モーダルの中を押すときは、モーダルに被らない所（横）へ出る", () => {
    const tab = r(420, 200, 60, 28);
    const modal = r(400, 180, 400, 400);
    const pos = placeCard([tab, modal], [tab, modal], size, 1280, 800)!;
    const box = r(pos.left, pos.top, size.w, size.h);
    expect(box.right <= modal.left || box.left >= modal.right || box.bottom <= modal.top || box.top >= modal.bottom).toBe(true);
  });

  test("どこにも置けなければ undefined（呼び出し側は左下）", () => {
    const all = r(0, 0, 400, 300);
    expect(placeCard([all], [all], size, 400, 300)).toBeUndefined();
  });

  test("幕は画面全体から穴の数だけくり抜く", () => {
    const p = shadePath([r(10, 10, 20, 20), r(100, 100, 30, 30)], 800, 600);
    expect(p.startsWith('path(evenodd, "M0 0H800V600H0Z')).toBe(true);
    expect(p.match(/Z/g)?.length).toBe(3);
    expect(shadePath([], 800, 600)).toBe('path(evenodd, "M0 0H800V600H0Z")'); // 片付け: 全部暗い
  });

  test("大きさ0や画面外は見えていない扱い", () => {
    expect(visibleIn(r(0, 0, 0, 0), 800, 600)).toBe(false);
    expect(visibleIn(r(900, 10, 20, 20), 800, 600)).toBe(false);
    expect(visibleIn(r(790, 10, 20, 20), 800, 600)).toBe(true); // 一部でも見えていれば出す
  });
});
