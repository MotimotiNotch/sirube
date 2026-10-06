// 日本語（正）。英語は ../en/dsl.ts。「まとめて書く」の構文エラー。

export const dsl = {
  nameAfterBracket: "'['にはノード名が必要です",
  nameAtStart: "式の先頭にはノード名が必要です",
  nameOrBracketAfterArrow: "'->' の後にノード名または '[' が必要です",
  unclosedBracket: "']' が閉じられていません",
  empty: "入力が空です",
  nameAfterComma: "',' の後にノード名が必要です",
  unexpectedToken: (token: string) => `予期しないトークン: '${token}'`,
};
