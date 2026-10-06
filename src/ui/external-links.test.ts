import { beforeEach, expect, test } from "bun:test";
import { ensureDom } from "./test-dom.ts";

ensureDom();

const { routeExternalLinks } = await import("./external-links.ts");
const { MANUAL_DOC } = await import("./manual-doc.ts");

const opened: string[] = [];
let routed = false;

beforeEach(() => {
  opened.length = 0;
  // 張るのは1回だけ（document に張るので、テストごとに張ると押すたびに増える）
  if (!routed) {
    routeExternalLinks((url) => opened.push(url));
    routed = true;
  }
  document.body.innerHTML = "";
});

const link = (href: string, text = "link"): HTMLAnchorElement => {
  const a = document.createElement("a");
  a.href = href;
  a.setAttribute("href", href);
  a.target = "_blank";
  a.append(document.createElement("span"));
  a.firstChild!.textContent = text;
  document.body.append(a);
  return a;
};

test("http / https のリンクは渡された open に回し、WebView には開かせない", () => {
  const a = link("https://ko-fi.com/motimotinotch");
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  (a.firstChild as HTMLElement).dispatchEvent(ev); // 中の要素を押しても拾う
  expect(opened).toEqual(["https://ko-fi.com/motimotinotch"]);
  expect(ev.defaultPrevented).toBe(true);
});

test("http / https 以外は触らない", () => {
  const a = link("#section");
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  expect(opened).toEqual([]);
  expect(ev.defaultPrevented).toBe(false);
});

test("マニュアルの末尾に Ko-fi への案内がある", () => {
  expect(MANUAL_DOC).toContain("## 10. 応援");
  expect(MANUAL_DOC).toContain("https://ko-fi.com/motimotinotch");
});
