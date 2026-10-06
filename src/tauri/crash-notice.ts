// 前回までの異常終了の記録を、起動直後に知らせる（2026-10-05）。
//
// 記録は外へ送らないので、人の手で渡してもらうしかない。だから**全文をコピー
// できること**がこの画面の役目で、読ませることではない——中身は開発者向け。
// 友人の Bazzite の不具合も、エラー全文をのっち経由でもらって直した（2026-09-28）。
//
// 出すのは本窓の起動時に1回だけ。出したものは本体が `seen/` へ移すので、
// 閉じれば次から出ない。

import { h, toast } from "../ui/dom.ts";
import { m } from "../i18n/index.ts";

export interface StoredReport {
  name: string;
  body: string;
}

export function showCrashNotice(reports: readonly StoredReport[]): void {
  const all = reports.map((r) => `# ${r.name}\n\n${r.body}`).join("\n\n---\n\n");

  const box = h("div", { class: "crash-notice", role: "alertdialog", "aria-label": m.crash.noticeAria });
  const title = h("div", { class: "crash-notice-title" }, [
    m.crash.noticeTitle(reports.length),
  ]);
  const lead = h("p", { class: "crash-notice-lead" }, [
    m.crash.noticeLead,
  ]);

  const detail = h("pre", { class: "crash-notice-body" }, [all]);
  detail.hidden = true;

  const copy = h("button", { class: "btn primary", type: "button" }, [m.crash.copyAll]);
  copy.addEventListener("click", () => {
    navigator.clipboard.writeText(all).then(
      () => toast(m.crash.copied),
      () => {
        // コピーできない環境でも、全文を開けば選んで写せる。
        detail.hidden = false;
        toast(m.crash.copyFailed);
      },
    );
  });
  const show = h("button", { class: "btn", type: "button" }, [m.crash.show]);
  show.addEventListener("click", () => {
    detail.hidden = !detail.hidden;
    show.textContent = detail.hidden ? m.crash.show : m.crash.hide;
  });
  const close = h("button", { class: "btn", type: "button" }, [m.crash.close]);
  close.addEventListener("click", () => box.remove());

  const actions = h("div", { class: "crash-notice-actions" }, [copy, show, close]);
  box.append(title, lead, actions, detail);
  document.body.append(box);
}
