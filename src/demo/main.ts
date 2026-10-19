// Web デモのエントリポイント（Cloudflare Workers の静的配信に載せる）。
//
// サーバは無い。dev と同じサンプル（src/dev/sample.ts）をメモリ上に置いて起動するので、
// ここでの変更はどこにも保存されず、読み込み直すと最初の状態に戻る。
// 別窓は出さない——窓ごとに別のメモリになり、同じ vault に見えて中身がずれるため。

import { startApp } from "../ui/app.ts";
import { sampleFs } from "../dev/sample.ts";
import { initTheme } from "../ui/theme.ts";
import { initLang, m } from "../i18n/index.ts";

const REPO_URL = "https://github.com/MotimotiNotch/sirube";

initTheme(); // vault を読む前に（読み込み中ずっとライトで光らないように）
initLang(); // 描画より前に辞書を決める

// 「保存されない」ことは触る前に分かっている必要があるので、ヘッダーに常に出す。
const badge = document.createElement("a");
badge.className = "demo-badge";
badge.href = REPO_URL;
badge.target = "_blank";
badge.rel = "noopener";
badge.textContent = m.app.demoBadge;
badge.title = m.app.demoBadgeTitle;
document.getElementById("brand")?.after(badge);

await startApp(sampleFs());
