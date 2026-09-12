// メモの閲覧モード（2026-09-12、のっち依頼）。
//
// メモはノードの Markdown 本文そのもの（Obsidian で開いても同じものが見える）。
// これまで入力欄を出しっぱなしにしていたが、**読む時間の方が長い**——半年ぶりに
// 開いて「何をしようとしていたか」を思い出す道具なので、既定は読む側でいい。
// 将来ここに他の人のコメントが積まれていく想定でもあるので、なおさら読み物になる。
//
// **描くのは、のっちが実際に書いている記法だけ**（実 vault の `#66` に見出しと
// 表がある）。ライブラリは入れない——ここで要るのは「読めること」であって
// Markdown の完全な実装ではないし、入れた瞬間に本文の解釈が2つ（Obsidian と
// ここ）になる。解釈しなかった記法は**素の文字のまま**残すので、消えはしない。
//
// DOM は組み立てて作る（`innerHTML` を使わない）。本文は人が書いたものが
// そのまま来るので、文字列から HTML を起こす経路を1つも作らない。

import { h } from "./dom.ts";

/** 段落や表の中の文字。`code` と **強調** と裸の URL だけ見る。 */
function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  // 3つを1本の正規表現で拾う。別々に走らせると、コードの中の `**` を強調として
  // 食う（コードは「そのまま出す」ためのものなので、そこが崩れると意味が無い）。
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(https?:\/\/[^\s<>"']+)/g;
  let last = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(h("code", {}, [m[1]]));
    else if (m[2] !== undefined) out.push(h("strong", {}, [m[2]]));
    else if (m[3] !== undefined) {
      // リンクにはするが、開くのはブラウザ任せ（Tauri の WebView では既定で
      // 外部ブラウザへ出る）。押せない文字列のままにすると、URL を書く意味が薄い。
      const a = h("a", { href: m[3], target: "_blank", rel: "noreferrer noopener" }, [m[3]]);
      out.push(a);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** 表の1行を `|` で割る。両端の `|` は落とす。 */
function cells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isTableRow = (line: string): boolean => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line: string): boolean => /^\s*\|[\s:|-]+\|\s*$/.test(line);

/**
 * メモ本文を `container` へ描く。**読むためのもので、編集はしない。**
 *
 * 解釈するのは見出し（`#` 〜 `###`）・箇条書き（`-` / `1.`、チェックボックス込み）・
 * 引用・コードブロック・表・区切り線・段落。それ以外は段落の文字として出る。
 */
export function renderNote(container: HTMLElement, text: string): void {
  container.replaceChildren();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  /** 今まとめている段落。空行か別の記法で閉じる。 */
  let para: string[] = [];
  const flush = (): void => {
    if (para.length === 0) return;
    const p = h("div", { class: "note-p" });
    para.forEach((line, idx) => {
      if (idx > 0) p.append(h("br"));
      for (const part of inline(line)) p.append(part);
    });
    container.append(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i]!;

    // コードブロック。閉じが無いまま終わっても、そこまでを出す。
    const fence = /^\s*```(.*)$/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // 閉じの ``` を飛ばす
      container.append(h("pre", { class: "note-code" }, [body.join("\n")]));
      continue;
    }

    if (line.trim() === "") {
      flush();
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      container.append(h("hr", { class: "note-hr" }));
      i += 1;
      continue;
    }

    const head = /^(#{1,3})\s+(.*)$/.exec(line);
    if (head) {
      flush();
      const level = head[1]!.length;
      const el = h("div", { class: `note-h note-h${level}` });
      for (const part of inline(head[2]!)) el.append(part);
      container.append(el);
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      flush();
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const q = h("div", { class: "note-quote" });
      body.forEach((b, idx) => {
        if (idx > 0) q.append(h("br"));
        for (const part of inline(b)) q.append(part);
      });
      container.append(q);
      continue;
    }

    // 表。見出し行の下に `|---|` があるときだけ1行目を見出しとして扱う。
    if (isTableRow(line)) {
      flush();
      const rows: string[][] = [];
      let headed = false;
      while (i < lines.length && isTableRow(lines[i]!)) {
        if (isTableRule(lines[i]!)) {
          headed = rows.length === 1;
          i += 1;
          continue;
        }
        rows.push(cells(lines[i]!));
        i += 1;
      }
      const table = h("table", { class: "note-table" });
      rows.forEach((row, idx) => {
        const tr = h("tr");
        for (const c of row) {
          const cell = h(headed && idx === 0 ? "th" : "td");
          for (const part of inline(c)) cell.append(part);
          tr.append(cell);
        }
        table.append(tr);
      });
      container.append(table);
      continue;
    }

    const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flush();
      const ordered = /\d/.test(item[2]!);
      const list = h(ordered ? "ol" : "ul", { class: "note-list" });
      while (i < lines.length) {
        const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[2]!) !== ordered) break;
        const li = h("li", { class: m[1]!.length >= 2 ? "note-li-in" : "" });
        let body = m[3]!;
        // チェックボックスは**印だけ**出す。ここから触れると、メモの中に
        // 「達成」がもう1つあることになる（状態は `satisfied` だけが持つ）。
        // 四角は CSS で描く——絵文字は使わない方針で、SVG を1つ増やすほどの
        // ものでもない。
        const box = /^\[( |x|X)\]\s*(.*)$/.exec(body);
        if (box) {
          li.append(h("span", { class: `note-box${box[1] === " " ? "" : " on"}` }));
          body = box[2]!;
        }
        for (const part of inline(body)) li.append(part);
        list.append(li);
        i += 1;
      }
      container.append(list);
      continue;
    }

    para.push(line);
    i += 1;
  }
  flush();
}
