// テキスト DSL から複数ノードを一括生成するパーサ。
// Warframe State Graph の `ts/server/dsl.ts` からの移植（`type` 廃止に伴う調整のみ）。
//
// 構文: `A -> B -> [A' -> B'], A -> D`
//   - `X -> Y` は「X は Y を requires する」＝「X には Y が必要」
//   - `[...]` は直前ノードの `contains`（角括弧の最初のノードが内包先になる）。
//     角括弧の中でも `->` は requires のまま、再帰的に効く
//   - `,` で独立した式を区切る
//   - 角括弧の後も current は親のままなので、`親 -> [子1] -> [子2]` で
//     兄弟を並べられる。角括弧の中にカンマは書けない
//
// 同じ名前を2回書けば同じノードに解決される。これがこの DSL の要点で、
// 分解を書き下すときに「A が2つの枝に出てくる」を自然に表現できる。
//
// ノード id は正規化せずトリムした名前そのもの。任意のユーザー入力（日本語を
// 含む）を受けるため、`[^a-z0-9]+` 的なスラグ化をすると区別できない
// ダッシュの羅列に潰れてしまう。

import { newNode, type Node } from "./model.ts";

export interface DslError {
  message: string;
  pos: number;
}

export interface DslParseResult {
  nodes: Node[];
  errors: DslError[];
}

type TokenType = "IDENT" | "ARROW" | "COMMA" | "LBRACKET" | "RBRACKET";
interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let buf = "";
  let bufStart = 0;

  const flush = (): void => {
    // 内部の空白は「潰す」——単に前後をトリムするだけでは、textarea 内で
    // 名前が途中改行された場合に "Mag Prime" と "Mag\n  Prime" が別 id に
    // なってしまい、見た目が同じなのに別ノードになる。
    const trimmed = buf.replace(/\s+/g, " ").trim();
    if (trimmed) tokens.push({ type: "IDENT", value: trimmed, pos: bufStart });
    buf = "";
  };

  while (i < input.length) {
    if (input.startsWith("->", i)) {
      flush();
      tokens.push({ type: "ARROW", value: "->", pos: i });
      i += 2;
      bufStart = i;
    } else if (input[i] === ",") {
      flush();
      tokens.push({ type: "COMMA", value: ",", pos: i });
      i += 1;
      bufStart = i;
    } else if (input[i] === "[") {
      flush();
      tokens.push({ type: "LBRACKET", value: "[", pos: i });
      i += 1;
      bufStart = i;
    } else if (input[i] === "]") {
      flush();
      tokens.push({ type: "RBRACKET", value: "]", pos: i });
      i += 1;
      bufStart = i;
    } else {
      if (buf === "") bufStart = i;
      buf += input[i];
      i += 1;
    }
  }
  flush();
  return tokens;
}

class DslSyntaxError extends Error {
  pos: number;
  constructor(message: string, pos: number) {
    super(message);
    this.pos = pos;
  }
}

/** DSL テキストをノード集合へ。例外は投げず、最初に見つかった構文エラーを
 * `errors` に入れて返す（コンパイラが最初の停止エラーを報告して以降の
 * 復帰点を推測しないのと同じ方針）。 */
export function parseDsl(input: string): DslParseResult {
  const tokens = tokenize(input);
  const nodesByName = new Map<string, Node>();
  const order: string[] = [];

  const getOrCreateNode = (name: string): Node => {
    let n = nodesByName.get(name);
    if (!n) {
      n = newNode(name);
      nodesByName.set(name, n);
      order.push(name);
    }
    return n;
  };
  const addRequires = (from: Node, toId: string): void => {
    if (from.id !== toId && !from.requires.includes(toId)) from.requires.push(toId);
  };
  const addContains = (from: Node, toId: string): void => {
    if (from.id !== toId && !from.contains.includes(toId)) from.contains.push(toId);
  };

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];
  const endPos = input.length;

  const expectIdent = (context: string): Token => {
    const t = peek();
    if (!t || t.type !== "IDENT") {
      throw new DslSyntaxError(`${context}にはノード名が必要です`, t?.pos ?? endPos);
    }
    next();
    return t;
  };

  /** `startNode` の IDENT を呼び出し側が消費した直後から `(Arrow Target)*` を読む。
   * Target は IDENT（requires 連鎖の継続）か `[...]`（startNode の contains へ）。 */
  const continueChain = (startNode: Node): void => {
    let current = startNode;
    while (peek()?.type === "ARROW") {
      next();
      const t = peek();
      if (!t) throw new DslSyntaxError("'->' の後にノード名または '[' が必要です", endPos);
      if (t.type === "IDENT") {
        next();
        const target = getOrCreateNode(t.value);
        addRequires(current, target.id);
        current = target;
      } else if (t.type === "LBRACKET") {
        next();
        const innerFirstTok = expectIdent("'['");
        const innerFirst = getOrCreateNode(innerFirstTok.value);
        addContains(current, innerFirst.id);
        continueChain(innerFirst);
        const close = peek();
        if (!close || close.type !== "RBRACKET") {
          throw new DslSyntaxError("']' が閉じられていません", close?.pos ?? endPos);
        }
        next();
        // 角括弧は横枝であって requires 連鎖の続きではないので current は据え置き。
      } else {
        throw new DslSyntaxError("'->' の後にノード名または '[' が必要です", t.pos);
      }
    }
  };

  const parseChain = (): void => {
    const first = expectIdent("式の先頭");
    continueChain(getOrCreateNode(first.value));
  };

  const errors: DslError[] = [];
  try {
    if (tokens.length === 0) throw new DslSyntaxError("入力が空です", 0);
    parseChain();
    while (peek()) {
      const t = peek()!;
      if (t.type === "COMMA") {
        next();
        if (!peek()) throw new DslSyntaxError("',' の後にノード名が必要です", endPos);
        parseChain();
      } else {
        throw new DslSyntaxError(`予期しないトークン: '${t.value}'`, t.pos);
      }
    }
  } catch (err) {
    if (err instanceof DslSyntaxError) errors.push({ message: err.message, pos: err.pos });
    else throw err;
  }

  return { nodes: order.map((name) => nodesByName.get(name)!), errors };
}

/**
 * 前提の一括追加。選択中のノードを起点に、改行区切りのリストから
 * 複数の前提ノードを一度に作って `requires` で繋ぐ。
 *
 * 分解の流れ（「これには A と B と C が要る」と思った瞬間に3行打つ）に
 * 直結する MVP の中核機能だが、実装は**既存 DSL への組み立て直し**で済む。
 * 新しいパーサは要らない。
 *
 *   選択中: 引っ越し
 *   引っ越し先の家        →  引っ越し -> 引っ越し先の家,
 *   お金を貯める              引っ越し -> お金を貯める,
 *   不動産に行く              引っ越し -> 不動産に行く
 *
 * 仕様（2026-08-31 確定）:
 *  - 区切りは改行。1行1ノード。空行と前後の空白は無視
 *  - 既存ノード名と一致したら新規作成せず、その既存ノードに繋ぐ
 *    （DSL の `getOrCreateNode` と同じ挙動）
 *  - 階層は無し（フラット1段）。`contains` 側の一括追加は当面やらない
 */
export function buildBulkRequiresDsl(targetId: string, lines: string): string {
  const names = lines
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0 && s !== targetId);
  const unique = [...new Set(names)];
  return unique.map((n) => `${targetId} -> ${n}`).join(", ");
}

export function parseBulkRequires(targetId: string, lines: string): DslParseResult {
  const dsl = buildBulkRequiresDsl(targetId, lines);
  if (dsl === "") return { nodes: [], errors: [] };
  return parseDsl(dsl);
}
