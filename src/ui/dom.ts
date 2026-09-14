// DOM の小道具。フレームワークは使わない（Tauri の WebView で動く軽い
// 素の DOM に寄せる方が、バンドルもデバッグも軽い）。

import { icon, type IconName } from "./icons.ts";
import type { GoalColor, NodeState } from "../core/model.ts";

export function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`element not found: #${id}`);
  return node as T;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

/** アイコン入りの span。`innerHTML` に入れるのは自前の定数 SVG のみ。 */
export function iconSpan(name: IconName, size = 14): HTMLSpanElement {
  const s = h("span", { class: "icon", style: "display:flex" });
  s.innerHTML = icon(name, size);
  return s;
}

export const STATE_LABEL: Record<NodeState, string> = {
  SATISFIED: "達成済み",
  ACTIONABLE: "今やれる",
  BLOCKED: "前提待ち",
  CYCLIC: "輪で詰まっている",
};

export const STATE_ICON: Record<NodeState, IconName> = {
  SATISFIED: "circleCheck",
  ACTIONABLE: "circle",
  BLOCKED: "circleSlash",
  CYCLIC: "repeat",
};

/** 付箋の色の呼び名。**色名だけを出す**——「重要」「あとで」のような意味を
 *  こちらで決めない。何を意味するかは貼る人が決めるものなので、名前を付けた
 *  時点でその自由が減る。 */
export const COLOR_LABEL: Record<GoalColor, string> = {
  yellow: "黄",
  orange: "橙",
  pink: "桃",
  purple: "紫",
  blue: "青",
  green: "緑",
};

export function stateBadge(state: NodeState): HTMLSpanElement {
  const badge = h("span", { class: `state-badge state-${state}` });
  badge.append(iconSpan(STATE_ICON[state], 12), STATE_LABEL[state]);
  return badge;
}

export function stateDot(state: NodeState): HTMLSpanElement {
  return h("span", { class: `dot state-${state}`, title: STATE_LABEL[state] });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(message: string): void {
  const stack = el("toast-stack");
  const node = h("div", { class: "toast" }, [message]);
  stack.append(node);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 3200);
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** 手元の時刻で `2026-09-14`。`due` と同じ書き方に揃える。 */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 手元の時刻で `2026-09-14 13:43`。 */
export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
