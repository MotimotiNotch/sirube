import { expect, test } from "bun:test";
import { buildWindowQuery, parseWindowQuery } from "./window-query.ts";

test("引数の無い窓は本窓", () => {
  expect(parseWindowQuery("")).toEqual({ sub: false });
  expect(parseWindowQuery("?node=01ABC")).toEqual({ sub: false });
});

test("ノードを指したサブ窓は往復する（vault のパスの区切りや日本語も崩れない）", () => {
  const vault = "C:\Users\me\マイ vault&x=1";
  expect(parseWindowQuery(buildWindowQuery({ kind: "node", id: "01ABC" }, vault))).toEqual({
    sub: true,
    initial: { kind: "node", id: "01ABC" },
    vault,
  });
});

test("マニュアルを指したサブ窓は往復する", () => {
  expect(parseWindowQuery(buildWindowQuery({ kind: "manual" }))).toEqual({ sub: true, initial: { kind: "manual" } });
});
