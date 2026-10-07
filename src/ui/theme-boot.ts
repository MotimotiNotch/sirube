// `<head>` で同期に読み込む小さなスクリプト（2026-10-07）。中身は theme.ts の判定そのもので、
// ここで書き直さない——保存の鍵や「OS に合わせる」の解決を2か所に持つと、片方だけ直したときに
// 起動直後とそれ以降で違う色になる。詳しくは theme.ts の bootTheme()。
import { bootTheme } from "./theme.ts";

bootTheme();
