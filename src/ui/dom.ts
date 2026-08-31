// DOM の小道具。フレームワークは使わない（Tauri の WebView で動く軽い
// 素の DOM に寄せる方が、バンドルもデバッグも軽い）。

import { icon, type IconName } from "./icons.ts";
import type { NodeState } from "../core/model.ts";

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
