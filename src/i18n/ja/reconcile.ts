// 日本語（正）。英語は ../en/reconcile.ts。自動解決の結果の1行。

export const reconcile = {
  /** 「N件解決しました。M件は判断が必要なため残しました」 */
  summary: (fixed: number, unresolved: number) => {
    if (fixed === 0 && unresolved === 0) return "不整合はありませんでした。";
    const parts: string[] = [];
    if (fixed > 0) parts.push(`${fixed}件を自動解決しました`);
    if (unresolved > 0) parts.push(`${unresolved}件は判断が必要なため残しました`);
    return `${parts.join("。")}。`;
  },
};
