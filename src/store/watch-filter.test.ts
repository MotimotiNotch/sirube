import { expect, test } from "bun:test";
import { isContentChange } from "./watch-filter.ts";

test("開いた・読んで閉じただけでは読み直さない（Linux で読み直しの輪になっていた）", () => {
  expect(isContentChange({ access: { kind: "open", mode: "any" } })).toBe(false);
  expect(isContentChange({ access: { kind: "close", mode: "read" } })).toBe(false);
  expect(isContentChange({ access: { kind: "any" } })).toBe(false);
  expect(isContentChange({ modify: { kind: "metadata", mode: "access-time" } })).toBe(false);
});

test("作成・削除・内容の変更・書き込みの完了・mtime の変更では読み直す", () => {
  expect(isContentChange({ create: { kind: "file" } })).toBe(true);
  expect(isContentChange({ remove: { kind: "file" } })).toBe(true);
  expect(isContentChange({ modify: { kind: "data", mode: "content" } })).toBe(true);
  expect(isContentChange({ modify: { kind: "rename", mode: "both" } })).toBe(true);
  expect(isContentChange({ access: { kind: "close", mode: "write" } })).toBe(true);
  // inotify の ATTRIB は mode を区別できず any で来る。touch などの mtime の変更もここ。
  expect(isContentChange({ modify: { kind: "metadata", mode: "any" } })).toBe(true);
  expect(isContentChange({ modify: { kind: "metadata", mode: "write-time" } })).toBe(true);
});

test("種類が分からないものは読み直す側に倒す", () => {
  expect(isContentChange("any")).toBe(true);
  expect(isContentChange("other")).toBe(true);
  expect(isContentChange({ modify: { kind: "any" } })).toBe(true);
});
