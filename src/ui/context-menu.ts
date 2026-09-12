// 右クリックのメニュー（2026-09-12、のっち依頼）。
//
// なぜ作ったか: 操作の入口が右のパネルに集まっていて、グラフを見ながら手を
// 動かすとそのたびにパネルまで往復していた。**線の操作はもっと厳しい**——
// 「間に差し込む」は 14px の透明な当たり判定を押す、「外す」はインスペクタの
// 上向きリンクにホバーして `×` を出す、のどちらかしか無く、どちらも画面に
// 何も出ていないので知らなければ辿り着けない。
//
// 右クリックは「隠れているが、探しに行ける」場所なので、**表示量を増やさずに
// 入口を足せる**（表示量の原則3「畳んで、必要な人だけ開く」と同じ扱い）。
// ただし入口が増えることは確かなので、**ここにしか無い操作は置かない**
// ——全部どこかにあるものの近道にする。
//
// **既定のメニューを全部潰すことはしない。** 文字入力の上では貼り付けが要る。
// 潰すのはノード・線・グラフの地の3箇所だけ（`graph-view.ts` が配線する）。

import { h, iconSpan } from "./dom.ts";
import type { IconName } from "./icons.ts";

/** 右クリックされた場所。**何を出すかは呼び先が決める**——メニューを描く側も
 *  グラフを描く側も、どの操作がその場面で意味を持つかは知らない。 */
export type MenuTarget =
  | { kind: "node"; id: string }
  | { kind: "edge"; parentId: string; childId: string; edge: "requires" | "contains" }
  | { kind: "space" };

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** 押すと消える・外れる系。色で区別する。 */
  danger?: boolean;
  onSelect(): void;
}

let current: HTMLElement | undefined;
/** 開いている間だけ張る後始末。閉じるときに必ず外す（要素だけ消して
 *  リスナーを残すと、次に開いたメニューが前の指示で閉じる）。 */
let teardown: (() => void) | undefined;

export function closeContextMenu(): void {
  teardown?.();
  teardown = undefined;
  current?.remove();
  current = undefined;
}

/**
 * `x, y`（ビューポート座標）にメニューを開く。**同時に開くのは1つだけ。**
 *
 * 項目を押したら先に閉じてから実行する——押した先で描き直しが走るので、
 * 開いたままだと相手のいないメニューが画面に残る。
 */
export function openContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();
  if (items.length === 0) return;

  const menu = h("div", { class: "ctx-menu", role: "menu" });
  for (const item of items) {
    const btn = h("button", { class: `ctx-item${item.danger ? " danger" : ""}`, type: "button", role: "menuitem" });
    if (item.icon) btn.append(iconSpan(item.icon, 13));
    btn.append(h("span", {}, [item.label]));
    btn.addEventListener("click", () => {
      closeContextMenu();
      item.onSelect();
    });
    menu.append(btn);
  }
  document.body.append(menu);
  current = menu;

  // 画面の外へはみ出さない位置へ寄せる。窓が測れない環境（テストの happy-dom は
  // 0 を返す）では素直に指した場所へ置く——測れない値で計算すると、実機では
  // 合っているものがテストだけで動くことになる。
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  const left = vw > 0 && w > 0 && x + w > vw - 4 ? Math.max(4, x - w) : x;
  const top = vh > 0 && hgt > 0 && y + hgt > vh - 4 ? Math.max(4, y - hgt) : y;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const onDocDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) closeContextMenu();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") closeContextMenu();
  };
  // 拡大縮小・移動・窓のリサイズで位置がずれる。追従させるより閉じる方が素直。
  const onMove = (): void => closeContextMenu();
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("wheel", onMove, { passive: true });
  window.addEventListener("resize", onMove);
  teardown = () => {
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("wheel", onMove);
    window.removeEventListener("resize", onMove);
  };
}
