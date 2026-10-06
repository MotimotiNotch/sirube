// DOM の小道具。フレームワークは使わない（Tauri の WebView で動く軽い
// 素の DOM に寄せる方が、バンドルもデバッグも軽い）。

import { icon, type IconName } from "./icons.ts";
import type { GoalColor, NodeState } from "../core/model.ts";
import { m } from "../i18n/index.ts";

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

// 表の形のまま引けるように getter で持つ。値を定数に写すと言語の差し替えが届かない。
export const STATE_LABEL: Readonly<Record<NodeState, string>> = {
  get SATISFIED() { return m.dom.stateSatisfied; },
  get ACTIONABLE() { return m.dom.stateActionable; },
  get BLOCKED() { return m.dom.stateBlocked; },
  get CYCLIC() { return m.dom.stateCyclic; },
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
export const COLOR_LABEL: Readonly<Record<GoalColor, string>> = {
  get yellow() { return m.dom.colorYellow; },
  get orange() { return m.dom.colorOrange; },
  get pink() { return m.dom.colorPink; },
  get purple() { return m.dom.colorPurple; },
  get blue() { return m.dom.colorBlue; },
  get green() { return m.dom.colorGreen; },
};

export function stateBadge(state: NodeState): HTMLSpanElement {
  const badge = h("span", { class: `state-badge state-${state}` });
  badge.append(iconSpan(STATE_ICON[state], 12), STATE_LABEL[state]);
  return badge;
}

export function stateDot(state: NodeState): HTMLSpanElement {
  return h("span", { class: `dot state-${state}`, title: STATE_LABEL[state] });
}

/**
 * 下から出るお知らせ。**1つずつ自分のタイマーで消える。**
 *
 * 以前はタイマーを全部で1本だけ持ち、次のお知らせが出ると差し替えていた。
 * 3.2秒以内に2つ出ると前のものを消す人がいなくなり、画面に残り続けた
 * （2026-09-25、のっちが続けて削除して気づいた）。`ms` はテスト用。
 */
export function toast(message: string, ms = 3200): void {
  const stack = el("toast-stack");
  const node = h("div", { class: "toast" }, [message]);
  stack.append(node);
  setTimeout(() => node.remove(), ms);
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
