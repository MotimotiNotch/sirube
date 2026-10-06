// 日本語（正）。英語は ../en/graph.ts。

export const graph = {
  notFound: "ノードが見つかりません",
  betweenTip: (n: number) => `この2つの間に ${n} 件（地図では畳んでいる）`,
  insertBetween: (from: string, to: string) => `${from} と ${to} の間に差し込む`,
  labelGoalsAhead: "この先にあるゴール",
  labelRequires: "これが必要（前提）",
  labelContains: "これで構成（内包）",
  ringEndless: (done: number, total: number) => `下で達成 ${done} 件 ／ 全 ${total} 件`,
  ring: (done: number, total: number) => `下に ${done}/${total}`,
  mergeMap: (n: number) => `${n} つのゴールがここを通る`,
  mergeDetail: (n: number) => `${n} 箇所から要求されている（片付けると ${n} つ進む）`,
  noGoals: "地図に出すゴールがまだありません。",
  oneGoal: "地図に出ているゴールは1件だけです。「グラフ」に切り替えると中を分解できます。",
  noChildren: "このノードにはまだ下がありません。右のパネルの「分解する」から、何が必要かを足せます。",
  resetView: "表示を元に戻す",
};
