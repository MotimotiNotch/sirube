// 日本語（正）。英語は ../en/tutorial.ts。
//
// 目的・前提などの名前は引数で受け取り、括弧（『』）はここで付ける——英語では括り方が違う。

export const tutorial = {
  ariaLabel: "チュートリアル",
  title: "使い方",
  cleanupCount: "片付け",
  finished: "チュートリアルを終えました。ヘッダーの「使い方」からいつでもやり直せます。",
  goal: "左の「目的」の ＋ から、達成したいことを1つ作ります。例: 引っ越す（自分の目的をそのまま書いても大丈夫です）",
  selectGoal: (goal: string) => `まず『${goal}』を選んでください。`,
  requires: (goal: string) =>
    `右の「分解する」の「前提」タブに、『${goal}』には何が必要かを書きます。例: 荷造りを終える。前提ができると『${goal}』は「前提待ち」になります。`,
  selectPrereq: (prereq: string) => `次は『${prereq}』を選んでください。`,
  contains: (prereq: string) =>
    `「分解する」の「中身」タブに、『${prereq}』が何でできているかを書きます。例: 本を箱に詰める、服を箱に詰める（1行に1つ）。前提は揃ったあとも自分の作業が残るもの、中身は全部揃えば終わるもの、という違いです。`,
  selectLeaf: (leaf: string) => `中身の『${leaf}』を選んでください。`,
  achieve: (prereq: string, goal: string) =>
    `右の「達成にする」を押します。中身が全部達成になると『${prereq}』は自動で達成になり、『${goal}』が「今やれる」に変わります。`,
  deleteSelect: (goal: string, leaf: string) =>
    `『${goal}』が「今やれる」になりました。目的から下ろして、末端から片付ける——使い方はこれだけです。最後に片付けます。中身の『${leaf}』を選んでください。`,
  delete: "右の一番下の「その他」→「このノードを削除」で消してみてください。直後ならヘッダーの「戻す」で戻せます。",
  /** finished: 最後まで進んだ（残り）か、スキップした（作ったもの全部）か。 */
  cleanup: (finished: boolean, names: string[]) =>
    `${finished ? `残り ${names.length} 件` : `チュートリアルで作った ${names.length} 件`}（${names.join("・")}）もまとめて削除しますか？ 自分の目的を書いた場合は残してください。`,
  deleteAll: "まとめて削除",
  deleted: (n: number) => `${n} 件を削除しました。ヘッダーの「使い方」からいつでもやり直せます。`,
  keep: "残す",
  kept: "残しました。ヘッダーの「使い方」からいつでもやり直せます。",
  skip: "スキップ",
};
