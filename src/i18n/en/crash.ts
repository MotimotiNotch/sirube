// 英語。キーと引数の形は ../ja/crash.ts と同じでないと型で落ちる。

import type { Shape } from "../shape.ts";
import type { crash as Ja } from "../ja/crash.ts";

export const crash: Shape<typeof Ja> = {
  noticeAria: "Crash reports",
  noticeTitle: (n) => (n === 1 ? "A crash was recorded last time" : `${n} crashes were recorded since the last run`),
  noticeLead: "These are records of the screen freezing or going blank. Nothing has been sent anywhere. To get it fixed, copy the full text and pass it on.",
  copyAll: "Copy full text",
  copied: "Copied the report.",
  copyFailed: "Couldn't copy. Select the full text below and copy it.",
  show: "Show details",
  hide: "Hide details",
  close: "Close",
  pickVaultFirst: "Choose a folder to keep your Sirube data in",
  pickVaultSwitch: "Choose a folder to open",
  windowFailed: (detail) => `Couldn't open a new window (${detail}).`,
  noVault: "Sirube couldn't start because no folder was chosen. Close the window and open it again.",
  watchFailed: (detail) => `Changes made outside Sirube won't show up automatically (${detail}). Reopen the folder after editing.`,
  openFailed: (vault, detail) => `Couldn't open the folder.

${vault}

${detail}`,
};
