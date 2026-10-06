// 外へのリンクを既定のブラウザで開く（2026-10-06、Ko-fi のリンクを足したとき）。
//
// メモの URL（note-view.ts）もマニュアルのリンクも `<a target="_blank">` で出している。
// それをどこで開くかは WebView の既定任せで、アプリの中に別の窓が開くことも
// あり得る。Ko-fi のように「アプリの外へ出てもらう」リンクを足すにあたり、
// 開く先を1か所で決める——押された瞬間に拾って、シェルが渡した `open` に回す。
//
// 拾うのは http / https だけ。それ以外（`#` やアプリ内の操作）は今までどおり。

import { toast } from "./dom.ts";
import { m } from "../i18n/index.ts";

export function routeExternalLinks(open: (url: string) => unknown, root: Document = document): void {
  root.addEventListener(
    "click",
    (e) => {
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) return;
      e.preventDefault();
      // 開けなかったときに黙って何も起きないのが一番困る。URL は画面に出ているので、
      // コピーして開いてもらう。
      const fail = (): void => toast(m.links.openFailed(href));
      try {
        void Promise.resolve(open(href)).catch(fail);
      } catch {
        fail();
      }
    },
    true,
  );
}
