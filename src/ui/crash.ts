// 異常終了の記録（2026-10-05）。
//
// きっかけは「4件目を足して前提を入れようとしたら死んだ」。窓は残ったまま中身が
// 消えたのに、ログもダンプもイベントログも何も残っていなかった——**直せない
// のではなく、何が起きたのか分からない**のが本当の問題だった（のっち）。
//
// 拾うものは3種類で、拾い方がそれぞれ違う:
//
// 1. 画面側の未捕捉の例外（`error` / `unhandledrejection`）→ ここで拾って本体へ渡す
// 2. 本体（Rust）の panic → `lib.rs` の panic hook
// 3. **固まった**（無限ループ等）→ 画面は自分の停止を書けない。ここから本体へ
//    生存通知を送り、途絶えたら本体が書く（`lib.rs` の見張り）
//
// ここに置くのはシェルに依存しない部分だけ。どこへ書くか（`sink`）はシェルが渡す。
// **外へは送らない。** 置き場所はアプリのデータフォルダで、vault には置かない。

/** 直前の操作を何件残すか。再現に要るのは「落ちる直前に何をしたか」だけ。 */
const CRUMB_LIMIT = 20;
/** 1件の長さ。ノード名の長いものがそのまま入ると、レポートが読めなくなる。 */
const CRUMB_TEXT_LIMIT = 60;

export interface Crumb {
  at: number;
  what: string;
}

export interface CrashReport {
  kind: "error" | "rejection";
  message: string;
  stack?: string;
  at: number;
  /** どの窓か（本窓 / 別窓）。別窓だけで落ちることもある。 */
  window: string;
  version?: string;
  crumbs: readonly Crumb[];
}

/** 直前の操作の輪。古いものから捨てる。 */
export class Breadcrumbs {
  private items: Crumb[] = [];
  private version = 0;

  add(what: string, at: number = Date.now()): void {
    const text = what.replace(/\s+/g, " ").trim();
    if (text === "") return;
    this.items.push({ at, what: text.length > CRUMB_TEXT_LIMIT ? `${text.slice(0, CRUMB_TEXT_LIMIT)}…` : text });
    if (this.items.length > CRUMB_LIMIT) this.items.splice(0, this.items.length - CRUMB_LIMIT);
    this.version += 1;
  }

  list(): readonly Crumb[] {
    return this.items;
  }

  /** 変わったかを安く見るための通し番号。生存通知に毎回全部を載せないため。 */
  get revision(): number {
    return this.version;
  }
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** 手元の時刻で `2026-10-05 19:24:03.120`。並べたときに前後が分かる細かさにする。 */
export function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatCrumbs(crumbs: readonly Crumb[]): string {
  if (crumbs.length === 0) return "（記録なし）";
  return crumbs.map((c) => `${stamp(c.at)}  ${c.what}`).join("\n");
}

/** 人がそのまま貼れる形にする。のっち経由で全文をもらって直す前提なので、
 *  見出しと本文だけのプレーンテキストにしてある。 */
export function formatReport(r: CrashReport): string {
  return [
    `種類: ${r.kind === "error" ? "画面側の例外" : "画面側の未処理の Promise 拒否"}`,
    `時刻: ${stamp(r.at)}`,
    `窓: ${r.window}`,
    `版: ${r.version ?? "不明"}`,
    "",
    "## メッセージ",
    r.message,
    "",
    "## スタック",
    r.stack ?? "（無し）",
    "",
    "## 直前の操作（古い順）",
    formatCrumbs(r.crumbs),
    "",
  ].join("\n");
}

/** 例外の中身を取り出す。`throw "文字列"` や `reject(undefined)` もあるので型を決め打ちしない。 */
export function describeThrown(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack };
  if (typeof value === "string") return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

/** クリックされたものを1行で言う。ボタンの文字、無ければ `aria-label` / `title`。 */
function describeTarget(target: EventTarget | null): string | undefined {
  if (!(target instanceof Element)) return undefined;
  const hit = target.closest("button, a, [role='button'], [role='tab'], input, textarea, select, [data-id], .node, .hit");
  if (!hit) return undefined;
  const label =
    hit.getAttribute("aria-label") ??
    hit.getAttribute("title") ??
    (hit instanceof HTMLInputElement || hit instanceof HTMLTextAreaElement ? hit.placeholder : undefined) ??
    hit.textContent ??
    "";
  const tag = hit.tagName.toLowerCase();
  return `click ${tag}${label.trim() ? ` 「${label.trim()}」` : ""}`;
}

export interface CaptureOptions {
  window: string;
  version?: string;
  /** レポートの書き出し先。**失敗しても投げない**こと——落ちた後の処理で落ちると、
   *  元の例外が見えなくなる。 */
  sink: (report: CrashReport, text: string) => void;
}

/**
 * 未捕捉の例外と直前の操作を拾い始める。返すのは操作の輪（生存通知に載せる）。
 *
 * 操作は**捕獲フェーズで document から拾う**。app.ts の各ボタンに記録を足して
 * 回ると、足し忘れたボタンで落ちたときに手がかりが消える。
 */
export function installCrashCapture(opts: CaptureOptions): Breadcrumbs {
  const crumbs = new Breadcrumbs();

  document.addEventListener(
    "click",
    (e) => {
      const what = describeTarget(e.target);
      if (what) crumbs.add(what);
    },
    { capture: true },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      // 文字入力は残さない（何を書いたかではなく、何を押したかが要る）。
      // 確定・取り消し・ショートカットだけ。
      const mod = e.ctrlKey || e.metaKey || e.altKey;
      if (e.key === "Enter" || e.key === "Escape" || e.key === "Delete" || (mod && e.key.length === 1)) {
        const combo = [e.ctrlKey && "Ctrl", e.metaKey && "Meta", e.altKey && "Alt", e.shiftKey && "Shift", e.key]
          .filter(Boolean)
          .join("+");
        crumbs.add(`key ${combo}`);
      }
    },
    { capture: true },
  );

  const emit = (kind: CrashReport["kind"], thrown: unknown): void => {
    try {
      const { message, stack } = describeThrown(thrown);
      const report: CrashReport = {
        kind,
        message,
        stack,
        at: Date.now(),
        window: opts.window,
        version: opts.version,
        crumbs: [...crumbs.list()],
      };
      opts.sink(report, formatReport(report));
    } catch {
      // 記録の失敗で二次災害を起こさない。
    }
  };

  window.addEventListener("error", (e) => emit("error", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => emit("rejection", e.reason));
  return crumbs;
}
