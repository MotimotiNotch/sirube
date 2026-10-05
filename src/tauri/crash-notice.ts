// 前回までの異常終了の記録を、起動直後に知らせる（2026-10-05）。
//
// 記録は外へ送らないので、人の手で渡してもらうしかない。だから**全文をコピー
// できること**がこの画面の役目で、読ませることではない——中身は開発者向け。
// 友人の Bazzite の不具合も、エラー全文をのっち経由でもらって直した（2026-09-28）。
//
// 出すのは本窓の起動時に1回だけ。出したものは本体が `seen/` へ移すので、
// 閉じれば次から出ない。

import { h, toast } from "../ui/dom.ts";

export interface StoredReport {
  name: string;
  body: string;
}

export function showCrashNotice(reports: readonly StoredReport[]): void {
  const all = reports.map((r) => `# ${r.name}\n\n${r.body}`).join("\n\n---\n\n");

  const box = h("div", { class: "crash-notice", role: "alertdialog", "aria-label": "異常終了の記録" });
  const title = h("div", { class: "crash-notice-title" }, [
    reports.length === 1 ? "前回、異常が記録されました" : `前回までに、異常が ${reports.length} 件記録されました`,
  ]);
  const lead = h("p", { class: "crash-notice-lead" }, [
    "画面が止まった・消えたときの記録です。外へは送っていません。直すときに全文をコピーして渡してください。",
  ]);

  const detail = h("pre", { class: "crash-notice-body" }, [all]);
  detail.hidden = true;

  const copy = h("button", { class: "btn primary", type: "button" }, ["全文をコピー"]);
  copy.addEventListener("click", () => {
    navigator.clipboard.writeText(all).then(
      () => toast("記録をコピーしました"),
      () => {
        // コピーできない環境でも、全文を開けば選んで写せる。
        detail.hidden = false;
        toast("コピーできませんでした。下の全文を選んでコピーしてください");
      },
    );
  });
  const show = h("button", { class: "btn", type: "button" }, ["中身を見る"]);
  show.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    show.textContent = detail.hidden ? "中身を見る" : "中身を隠す";
  });
  const close = h("button", { class: "btn", type: "button" }, ["閉じる"]);
  close.addEventListener("click", () => box.remove());

  const actions = h("div", { class: "crash-notice-actions" }, [copy, show, close]);
  box.append(title, lead, actions, detail);
  document.body.append(box);
}
