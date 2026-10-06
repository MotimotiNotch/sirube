// 英語の辞書をまとめる。

import type { Messages } from "../shape.ts";
import { common } from "./common.ts";
import { app } from "./app.ts";
import { inspector } from "./inspector.ts";
import { list } from "./list.ts";
import { graph } from "./graph.ts";
import { legend } from "./legend.ts";
import { flyout } from "./flyout.ts";
import { manual } from "./manual.ts";
import { note } from "./note.ts";
import { dom } from "./dom.ts";
import { links } from "./links.ts";
import { tutorial } from "./tutorial.ts";
import { crash } from "./crash.ts";
import { store } from "./store.ts";
import { dsl } from "./dsl.ts";
import { reconcile } from "./reconcile.ts";

export const en: Messages = { common, app, inspector, list, graph, legend, flyout, manual, note, dom, links, tutorial, crash, store, dsl, reconcile };
