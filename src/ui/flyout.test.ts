// 中身の一覧（フライアウト）が下のノードを覆ったときの右クリック（2026-09-28）。
// 実際の重なり（どの縮小率で何を覆うか）は happy-dom では測れないので、
// 「一覧の真下にあるもの」を elementFromPoint の差し替えで置く。

import { afterEach, expect, test } from "bun:test";
import { ensureDom } from "./test-dom.ts";

ensureDom();
const { showOutlineFlyout } = await import("./flyout.ts");
import type { Graph, Node } from "../core/model.ts";

const node = (id: string, fields: Partial<Node> = {}): Node => ({
  id,
  name: id,
  satisfied: false,
  requires: [],
  contains: [],
  note: "",
  mtimeMs: 0,
  ...fields,
});

/** A の下に、さらに下を持つ B がいる（一覧に並ぶのは下を持つノードだけ）。 */
const graph: Graph = {
  nodes: {
    A: node("A", { requires: ["B"] }),
    B: node("B", { requires: ["C"] }),
    C: node("C"),
  },
};

const realFromPoint = document.elementFromPoint;
afterEach(() => {
  document.elementFromPoint = realFromPoint;
});

const mount = (): { fly: HTMLElement; anchor: HTMLElement; covered: HTMLElement } => {
  document.body.innerHTML = `<div id="anchor"></div><div id="covered"></div><div class="flyout hidden" id="flyout"></div>`;
  return {
    fly: document.getElementById("flyout")!,
    anchor: document.getElementById("anchor")!,
    covered: document.getElementById("covered")!,
  };
};

test("一覧の上の右クリックは、一覧を閉じて真下のノードに届く", () => {
  const { fly, anchor, covered } = mount();
  showOutlineFlyout(anchor, graph, "A", () => {});
  expect(fly.classList.contains("hidden")).toBe(false); // 陽性対照: 一覧が出ている

  let seen: MouseEvent | undefined;
  covered.addEventListener("contextmenu", (e) => {
    seen = e;
  });
  // 一覧が閉じた後に引かれることも見る（閉じる前に引くと一覧自身が返る）。
  document.elementFromPoint = () => (fly.classList.contains("hidden") ? covered : fly);

  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 40 });
  fly.dispatchEvent(ev);

  expect(ev.defaultPrevented).toBe(true); // 既定のメニュー（WebView2 の「再読み込み」等）は出さない
  expect(fly.classList.contains("hidden")).toBe(true);
  expect(seen).toBeDefined();
  expect([seen!.clientX, seen!.clientY]).toEqual([30, 40]); // メニューは押した場所に出る
});

test("一覧の行の左クリックは今までどおり飛び先を選ぶ", () => {
  const { fly, anchor } = mount();
  const picked: string[] = [];
  showOutlineFlyout(anchor, graph, "A", (id) => picked.push(id));
  (fly.querySelector(".fly-item:not(.static)") as HTMLElement).click();
  expect(picked).toEqual(["B"]);
});
