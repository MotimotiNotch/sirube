// 別窓の起動引数（2026-09-28）。窓の URL のクエリに「サブ窓であること」と
// 「最初に何を出すか」を載せる。Tauri 版と dev 版で同じ形を使う。
//
// 引数を URL に置くのは、窓の間で共有される場所（localStorage）を使わないため。
// そちらに置くと、2つ同時に開いたときに後の窓が前の窓の引数を読む。

import type { WindowTarget } from "./app.ts";

export interface WindowQuery {
  /** サブ窓か。無ければ本窓。 */
  sub: boolean;
  initial?: WindowTarget;
  /** サブ窓が開く vault（Tauri 版だけ）。本窓の localStorage を読まずに済ませる
   *  ——開いた後に本窓が切り替えても、この窓は開いたときのフォルダを指し続ける。 */
  vault?: string;
}

export function buildWindowQuery(target: WindowTarget, vault?: string): string {
  const q = new URLSearchParams({ window: "sub" });
  if (target.kind === "manual") q.set("manual", "1");
  else q.set("node", target.id);
  if (vault !== undefined) q.set("vault", vault);
  return `?${q.toString()}`;
}

export function parseWindowQuery(search: string): WindowQuery {
  const q = new URLSearchParams(search);
  if (q.get("window") !== "sub") return { sub: false };
  const node = q.get("node");
  const vault = q.get("vault") ?? undefined;
  const initial: WindowTarget | undefined =
    q.get("manual") === "1" ? { kind: "manual" } : node ? { kind: "node", id: node } : undefined;
  return { sub: true, ...(initial ? { initial } : {}), ...(vault !== undefined ? { vault } : {}) };
}
