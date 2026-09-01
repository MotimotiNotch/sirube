import { describe, expect, test } from "bun:test";
import { isUlid, ulid, ulidTime, ULID_LENGTH } from "./ulid.ts";

describe("ULID", () => {
  test("26文字・Crockford Base32 で、紛らわしい文字を含まない", () => {
    const id = ulid();
    expect(id).toHaveLength(ULID_LENGTH);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(id).not.toMatch(/[ILOU]/);
  });

  test("ファイル名として安全な文字しか出ない", () => {
    // ファイル名＝id をやめた動機そのもの。ここが破れると元の木阿弥。
    for (let i = 0; i < 200; i += 1) expect(ulid()).not.toMatch(/[\\/:*?"<>|.\s]/);
  });

  test("生成時刻が復元できる", () => {
    const now = 1_756_700_000_000;
    expect(ulidTime(ulid(now))).toBe(now);
  });

  test("時刻が同じでも乱数部で別物になる", () => {
    const now = 1_756_700_000_000;
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(now)));
    expect(ids.size).toBe(1000);
    // 前半10文字（時刻部）は全部同じ＝別れているのは乱数部
    expect(new Set([...ids].map((id) => id.slice(0, 10))).size).toBe(1);
  });

  test("時刻順に並ぶ", () => {
    const a = ulid(1_000_000_000_000);
    const b = ulid(1_000_000_000_001);
    expect(a < b).toBe(true);
  });

  test("形式チェックは長さ・文字種・大小を見る", () => {
    expect(isUlid(ulid())).toBe(true);
    expect(isUlid("確定申告")).toBe(false);
    expect(isUlid(ulid().slice(0, 25))).toBe(false);
    expect(isUlid(ulid().toLowerCase())).toBe(false); // 生成は常に大文字
    expect(isUlid(`${"0".repeat(25)}I`)).toBe(false); // 除外文字
  });

  test("扱えない時刻は静かに壊れず例外にする", () => {
    expect(() => ulid(-1)).toThrow();
    expect(() => ulid(1.5)).toThrow();
    expect(() => ulid(281_474_976_710_656)).toThrow();
  });
});
