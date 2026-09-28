// アプリの中のマニュアル（2026-09-28、のっち）。ヘッダーの「使い方」で真ん中に出す。
//
// チュートリアルは「初回に押す場所を順に案内する」もので、一度通ると読み返せない。
// こちらは「この画面のこれは何？」を後から引くためのもの。入口は「使い方」1つに
// まとめ、チュートリアルはここの先頭から呼ぶ——入口を2つに増やさない。
//
// 本文の正は `docs/manual.md`（`manual-doc.ts` に焼き込み）。描くのはメモと同じ
// `renderNote`——記法の解釈を2つ持たない。章（`##`）ごとに目次を作り、押すと飛ぶ。

import { h } from "./dom.ts";
import { renderNote } from "./note-view.ts";

export interface ManualCallbacks {
  /** 「チュートリアルをもう一度」。 */
  onTour(): void;
}

export function renderManual(container: HTMLElement, text: string, cb: ManualCallbacks): void {
  container.replaceChildren();
  const page = h("div", { class: "manual" });

  const tour = h("button", { class: "btn", type: "button" }, ["チュートリアルをもう一度"]);
  tour.addEventListener("click", () => cb.onTour());
  page.append(h("div", { class: "manual-actions" }, [tour]));

  const body = h("div", { class: "note-view manual-body" });
  renderNote(body, text);

  // 目次は描いた後の見出しから作る。本文を別に解析すると、コードブロックの中の
  // `##` を章と数えるなど、描いたものと目次がずれる。
  const chapters = Array.from(body.querySelectorAll<HTMLElement>(".note-h2"));
  if (chapters.length > 0) {
    const toc = h("nav", { class: "manual-toc", "aria-label": "目次" });
    for (const ch of chapters) {
      const btn = h("button", { type: "button" }, [ch.textContent ?? ""]);
      btn.addEventListener("click", () => ch.scrollIntoView({ block: "start" }));
      toc.append(btn);
    }
    page.append(toc);
  }
  page.append(body);
  container.append(page);
}
