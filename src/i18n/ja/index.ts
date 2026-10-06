// 日本語の辞書をまとめる。名前空間はソースの領域ごと（並べて直せるように分けてある）。

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

export const ja = { common, app, inspector, list, graph, legend, flyout, manual, note, dom, links, tutorial, crash, store, dsl, reconcile };
