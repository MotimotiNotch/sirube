// 辞書の型。日本語（ja/）が正で、英語はこの形に合わせる。
//
// 値は文字列か、引数を取って文字列を返す関数のどちらか。数や名前が入る文言は
// 関数にする——英語は数で語形が変わる（1 node / 2 nodes）ので、テンプレート文字列の
// 穴埋めでは足りない。キーの過不足も、関数の引数の食い違いも型で落ちる。

import type { ja } from "./ja/index.ts";

type Entry = string | ((...args: never[]) => string);

export type Shape<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => string ? (...args: A) => string : string;
};

export type Messages = { [N in keyof typeof ja]: Shape<(typeof ja)[N]> };

// ja の各名前空間が Entry だけでできていることの確認（入れ子の辞書は作らない）。
export type _Check = { [N in keyof typeof ja]: { [K in keyof (typeof ja)[N]]: (typeof ja)[N][K] extends Entry ? true : never } };
