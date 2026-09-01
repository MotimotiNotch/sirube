// ノード id 用の ULID。
//
// ファイル名＝id をやめる理由は改名のしやすさではなく、**今のやり方に静かな
// データ破壊がある**こと（Windows 実機で確認済み）:
//   - `リリース: v1.0` を保存すると `リリース v1.0.md` になり、`:` が消える。
//     id が書いたとおりに往復しないので、他ファイルの参照が全部切れる
//   - `Ruv` と `ruv` は同じファイルに潰れ、片方が黙って消える
//
// 表示名は frontmatter の `name` に置き、ファイル名は意味を持たない id に
// する。26文字・Crockford Base32 なので、どのファイルシステムでも安全。
//
// 衝突について: 48bit のタイムスタンプ + 80bit の乱数なので、**同一ミリ秒内で
// しか衝突しえない**（同ミリ秒に n 個作ったときの確率が約 n²/2^81）。確率
// そのものは無視してよく、**入れる対策は乱数以外の経路のため**:
//   - 乱数源が弱いと保証が消える  → `crypto.getRandomValues` 以外は使わない
//   - 時計が巻き戻るとタイムスタンプ部が重複する
//   - 現実に起きるのは「ノードファイルを手でコピーして作る」で、乱数と無関係
// 最後のものは id をファイル名だけに置くことでファイルシステムが弾く。
// 生成側は排他作成（既に在れば失敗）で受け止める——ストア側の責務。

/** Crockford Base32。`I` `L` `O` `U` を含まないので、目で読んでも取り違えにくい。 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;
export const ULID_LENGTH = TIME_LEN + RANDOM_LEN;

/** 48bit で表せる最大時刻（西暦 10889 年ごろ）。 */
const MAX_TIME = 281_474_976_710_655;

function encodeTime(time: number, len: number): string {
  if (!Number.isInteger(time) || time < 0 || time > MAX_TIME) {
    throw new Error(`ULID に使えない時刻です: ${time}`);
  }
  let rest = time;
  let out = "";
  for (let i = 0; i < len; i += 1) {
    const mod = rest % 32;
    out = ALPHABET[mod]! + out;
    rest = (rest - mod) / 32;
  }
  return out;
}

function encodeRandom(len: number): string {
  const source = globalThis.crypto;
  if (source?.getRandomValues === undefined) {
    // ここで `Math.random()` に落ちない。落ちた瞬間に衝突しないという前提が
    // 消えるので、静かに劣化するより止まる方がいい。
    throw new Error("crypto.getRandomValues が使えないため ULID を生成できません");
  }
  // 1バイトから5bit だけ使う。256 は 32 で割り切れるのでマスクしても偏らない。
  const bytes = source.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31]!;
  return out;
}

/** 新しい ULID を1つ作る。
 *
 * 同一ミリ秒内での単調増加は保証しない（その範囲では乱数部の順になる）。
 * 並び順に意味を持たせているのは「いつ作られたか」の粒度までで、ミリ秒未満の
 * 前後関係を使う場所がないため。 */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now, TIME_LEN) + encodeRandom(RANDOM_LEN);
}

/** ファイル名が ULID の形式か。
 *
 * 重複そのものはファイルシステムが弾く（同じディレクトリに同名は作れない）
 * ので、読み込み側で見るのは形式だけでいい。移行漏れや手で作られたファイルが
 * ここに引っかかる。小文字は受け付けない——生成は常に大文字で、大小しか
 * 違わない2つはファイルシステム上そもそも共存できないため。 */
export function isUlid(s: string): boolean {
  if (s.length !== ULID_LENGTH) return false;
  for (const ch of s) if (!ALPHABET.includes(ch)) return false;
  return true;
}

/** ULID に埋まっている生成時刻（epoch ms）。形式が違えば `undefined`。 */
export function ulidTime(s: string): number | undefined {
  if (!isUlid(s)) return undefined;
  let time = 0;
  for (const ch of s.slice(0, TIME_LEN)) time = time * 32 + ALPHABET.indexOf(ch);
  return time;
}
