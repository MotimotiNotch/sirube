// 日本語（正）。英語は ../en/app.ts。
// src/ui/app.ts（ヘッダー・モーダル・右クリック・パンくず・サイドバー）と index.html の文言。

type Kind = "requires" | "contains";
const kindLabel = (kind: Kind): string => (kind === "requires" ? "前提" : "中身");

export const app = {
  // ---- index.html（静的な部分。startApp が差し替える）
  searchPlaceholder: "ノード名・本文を検索（空欄で「今やれること」）",
  helpTitle: "マニュアルを開く（チュートリアルもここから）",
  goalsHeading: "目的",
  newGoalTitle: "新しい目的を作る",
  resizerTitle: "ドラッグで幅を変える／端まで寄せて格納／ダブルクリックで既定に戻す",

  // ---- ヘッダー
  help: "使い方",
  autoFix: "自動解決",
  undo: "戻す",
  undoTitleStructure: (label: string) => `${label}を戻す`,
  /** `cancelled` は戻す対象が「取り消し」だったか（false なら「達成」）。 */
  undoTitleToggle: (name: string, cancelled: boolean, count: number) =>
    `「${name}」の${cancelled ? "取り消し" : "達成"}を戻す（${count}件）`,
  themeSystem: "OS に合わせる",
  themeLight: "ライト",
  themeDark: "ダーク",
  themeGroup: "明るさ",
  langGroup: "言語",
  settingsTitle: (theme: string, lang: string) => `設定（明るさ: ${theme}、言語: ${lang}）`,

  // ---- トースト
  fileIssues: (n: number) => `${n} 件のファイルに読み取り上の問題があります`,
  mocSyncFailed: "入口ファイル（MOC）の更新に失敗しました",
  noteCopied: "メモをコピーしました",
  copyFailed: "コピーできませんでした",
  noGoalsYet: "ゴールがまだありません",
  undoStale: "ファイルが外で変わったので、この分は戻せません",
  undone: (label: string) => `${label}を戻しました`,
  undoneCount: (n: number) => `${n} 件を戻しました`,
  toggleStale: "ファイルが外で変わったので、もう一度押してください",
  cascaded: (n: number) => `${n} 件が連動して変わりました（ヘッダーの「戻す」で元に戻せます）`,
  goalShown: (name: string) => `「${name}」を地図に出しました`,
  goalHidden: (name: string) => `「${name}」を地図から外しました`,
  detached: (parent: string, child: string) =>
    `「${parent}」から「${child}」を外しました（ヘッダーの「戻す」、または「まとめて書く」に「${parent} -> ${child}」で戻せます）`,
  noteSaved: "メモを保存しました",
  renameFailed: "名前を変えられませんでした",
  renamed: (name: string) => `「${name}」に変えました`,
  deleted: (name: string) => `「${name}」を削除しました（ヘッダーの「戻す」で戻せます）`,

  // ---- 差し込み
  insertTitle: "間に差し込む",
  insertHint: (parent: string, child: string) => `「${parent}」と「${child}」の間に入れる。`,
  insertHintRequires: "元の繋がりは外れ、前提の鎖が1つ伸びる。",
  insertHintContains: "元の繋がりは外れ、内包が1段深くなる。",
  insertPlaceholder: "先にやること",
  insertOk: "差し込む",
  insertFailed: "差し込めませんでした",
  inserted: (name: string) => `「${name}」を間に入れました`,

  // ---- 右クリック
  surfaceNote: "（目的として一覧に出ます）",
  markDone: "達成にする",
  reopen: "未達に戻す",
  breakDown: "分解する",
  openInWindow: "別窓で開く",
  hideFromMap: "地図から外す",
  showOnMap: "地図に出す",
  openInGraph: "グラフで開く",
  detachFrom: (parent: string, note: string) => `「${parent}」から外す${note}`,
  insertNodeBetween: "間にノードを差し込む",
  detachEdge: (parent: string, child: string, note: string) => `「${parent}」から「${child}」を外す${note}`,
  edit: "編集する",
  copyNote: "メモをコピー",
  newGoal: "目的を1つ作る",
  bulkAdd: "まとめて書く",

  // ---- ペイン
  openSidebar: "目的の一覧を開く",
  openInspector: "詳細パネルを開く",

  // ---- データの場所
  vaultTitle: "データの場所",
  vaultHint: "ノードはこのフォルダの中だけにあります。Git で共有するのも、Obsidian で開くのもこの単位。",
  openOtherFolder: "別のフォルダを開く",
  openOtherFolderSub: "別のフォルダを開くのは最初の窓から。この窓はそのとき閉じます。",

  // ---- 作る（1つ作る / まとめて書く）
  tabOne: "1つ作る",
  oneHint: "達成したいことを1つ書く。作るとグラフが開くので、何が必要かは右の「分解する」から足せる。Enter で作成。",
  onePlaceholder: "引っ越す",
  create: "作成",
  nameRequired: "名前を入れてください",
  alreadyExists: (name: string) => `「${name}」は既にあります`,
  created: (name: string) => `「${name}」を作りました`,
  bulkHint: "分解を書き下すと、そのままノードとエッジになる。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。Ctrl+Enter で追加。",
  bulkHelpSummary: "書き方",
  bulkRuleRequires: "X -> Y は「X には Y が必要」（requires）",
  bulkRuleContains: "[...] は直前のノードの中身（contains）。親 -> [子1] -> [子2] で兄弟が並ぶ",
  bulkRuleComma: ", で式を区切る。同じ名前は同じノードになる",
  bulkExample: "引っ越し -> 引っ越し先の家 -> 不動産に行く,\n引っ越し -> お金を貯める",
  bulkPlaceholder: "リリース -> 手順書, リリース -> CI/CD",
  bulkPreviewLinked: (fresh: number, linked: number) => `${fresh} 件を新しく作り、${linked} 件は既存に繋ぎます`,
  bulkPreviewFresh: (fresh: number) => `${fresh} 件を新しく作ります`,
  bulkDone: (created: number, updated: number) => `${created} 件を作り、${updated} 件に繋ぎました`,

  // ---- 分解する（前提 / 中身）
  tabRequires: "前提",
  tabContains: "中身",
  decomposeTitleRequires: (name: string) => `「${name}」には何が必要？`,
  decomposeTitleContains: (name: string) => `「${name}」は何でできている？`,
  decomposeHintRequires: (name: string) => "揃ったあとも「" + name + "」自体にやることが残るなら前提。",
  decomposeHintContains: (name: string) =>
    "全部揃えば「" + name + "」自体にやることは残らないなら中身（担当分・部品・機能のまとまり）。",
  decomposeHintLines: "1行に1つ書く。既にある名前を書けば、そのノードに繋がる（新しくは作られない）。Ctrl+Enter で追加。",
  decomposePlaceholderRequires: "引っ越し先の家\nお金を貯める\n不動産に行く",
  decomposePlaceholderContains: "近道を見せる\n中身を一括で足す",
  decomposePreviewAdd: (kind: Kind, adding: number, linked: number) =>
    linked > 0
      ? `${adding} 件の${kindLabel(kind)}を追加します（うち ${linked} 件は既存に繋ぎます）`
      : `${adding} 件の${kindLabel(kind)}を追加します`,
  decomposePreviewAlready: (kind: Kind, already: number) => `${already} 件は既に${kindLabel(kind)}です`,
  /** 下見の2文をつなぐ区切り。 */
  previewJoin: "。",
  decomposeAddedBoth: (total: number, linked: number) => `${total} 件を追加しました（うち ${linked} 件は既存に繋ぎました）`,
  decomposeAdded: (made: number) => `${made} 件を追加しました`,
  decomposeLinked: (linked: number) => `${linked} 件を既存に繋ぎました`,
  decomposeAllAlready: (kind: Kind) => `どれも既に${kindLabel(kind)}です`,

  // ---- 達成済みの親に中身を足したとき
  reopenTitle: (name: string) => `「${name}」は達成済みです`,
  reopenHint: (n: number) =>
    `未達の中身を ${n} 件足したので、今ある分はまだ終わっていません。未達に戻しますか？ 戻さないと、達成のまま中に未達が残ります（自動解決はここを戻しません）。`,

  // ---- 近道
  shortcutsTitle: "直接の繋がりが要らなくなりました",
  shortcutsHint: "別の前提を通って同じノードに届いています。直接の線を残すと、2か所から求められている合流点に見えます。外しても達成状態は変わりません。",
  shortcutItem: (from: string, to: string, via: string) => `${from} → ${to}（${via} から届く）`,
  shortcutsStale: "ファイルが外で変わったので、外しませんでした",
  shortcutsDetached: (n: number) => `直接の線を ${n} 本外しました（ヘッダーの「戻す」で戻せます）`,

  // ---- トグルの下見
  togglePreviewOn: "達成にすると、前提も達成になります",
  togglePreviewOff: "達成を取り消すと、下流も戻ります",
  togglePreviewHintOn: "「後が終わっているなら、前も終わっていたはず」として遡ります。ファイルに書き込むので、内容を確認してください。",
  togglePreviewHintOff: "「前提が崩れたなら、その上に積んだものも本当は終わっていない」として戻します。前提側には触りません。",
  rewrites: (n: number) => `書き換わる（${n}）`,
  unmarkDone: "達成を戻す",
  fillPrerequisite: "前提を埋める",
  prerequisiteOf: (name: string, via: string) => `${name}（${via} の前提）`,
  parentDone: "親を達成に",
  childrenDone: (name: string) => `${name}（子が全部揃った）`,
  becauseUndone: (name: string, via: string) => `${name}（${via} が戻るため）`,
  toggleAndHint: "覚えのないものが並んでいたら、前提が AND になっているか疑ってください。「どれか1本立てばいい」ものは前提ではなく選択肢なので、繋がずにメモへ書きます。",
  cancelDone: "取り消す",

  // ---- 自動解決
  reconcileNone: "不整合はありませんでした。",
  reconcileHint: "変更時刻の新しい方を「最新の意図」として扱います。実行前に内容を確認してください。",
  reconcileFixes: (n: number) => `自動解決する（${n}）`,
  newerThan: (name: string, other: string) => `${name}（${other} の方が新しい）`,
  childNewer: (parent: string, child: string) => `${parent}（中身の ${child} が未達で、そちらの方が新しい）`,
  createEmpty: "空ノード作成",
  referencedBy: (id: string, names: string[]) => `${id}（${names.join(", ")} が参照）`,
  needsDecision: (n: number) => `判断が必要（${n}）`,
  cycle: "待ち合い",
  cycleItem: (names: string[]) => `${names.join("・")}（分解が要る）`,
  nearDuplicate: "表記ゆれ",
  containsCycle: "内包の待ち合い",
  containsCycleItem: (names: string[]) => `${names.join(" → ")} → …（割るのではなく、どれかの「これで構成」を外す）`,
  oscillating: "決められない",
  oscillatingItem: (name: string) => `${name} — 達成と未達成を行き来するので、どちらが正しいか手で決めてください`,
  tooClose: "時刻が近すぎる",
  tooCloseItem: (a: string, b: string) => `${a} と ${b} — どちらが新しいか判断できません`,
  fileProblems: (n: number) => `ファイルの問題（${n}）`,
  unreadable: "読めない",
  run: "実行",

  // ---- サイドバー・パンくず・一覧
  readyNow: "今やれること",
  recentChanges: "最近の変更",
  noGoalsOnMap: "地図に出している目的がありません",
  noGoals: "まだ目的がありません",
  makeGoal: "目的を作る",
  addToTitle: (name: string) => `「${name}」に足す（既にある名前を書けば繋がる）`,
  bulkAddTitle: "まとめて書く（既にある名前を書けば繋がる）",
  underScope: (name: string) => `${name} の配下`,
  graph: "グラフ",
  searchResultsFor: (query: string) => `「${query}」の検索結果`,
  searchResults: "検索結果",
  map: "地図",
  whole: "全体",
  overview: "俯瞰",
};
