/**
 * マイグレーションの SQL を文に分け、どの表に何をするかを読み取る（ADR-017 決定 8）。
 *
 * PR のコメントに「触る表と操作」と警告を出すために使う。SQLite の構文をすべて読むのではなく、
 * Drizzle が生成する文と、手で書いたマイグレーションで使う文だけを読む。
 * 読み取れなかった文は `UNKNOWN` にし、警告として人に確かめてもらう。
 */

export type Operation =
  | "CREATE TABLE"
  | "DROP TABLE"
  | "RENAME TABLE"
  | "ADD COLUMN"
  | "DROP COLUMN"
  | "RENAME COLUMN"
  | "CREATE INDEX"
  | "DROP INDEX"
  | "CREATE TRIGGER"
  | "DROP TRIGGER"
  | "CREATE VIEW"
  | "DROP VIEW"
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "PRAGMA"
  | "UNKNOWN";

export interface StatementInfo {
  operation: Operation;
  /** 操作する表。DROP INDEX・DROP TRIGGER・VIEW・PRAGMA・UNKNOWN では分からないので無い */
  table?: string;
  /** 列の名前（ADD・DROP・RENAME COLUMN）や、索引・トリガー・ビューの名前、PRAGMA の中身 */
  name?: string;
  /** 改名した後の名前（RENAME TABLE・RENAME COLUMN） */
  renamedTo?: string;
  /** コメントを除き、空白を 1 つにまとめた文 */
  sql: string;
}

/**
 * SQL を文に分ける。コメントを除き、引用符の外の空白は 1 つにまとめる。
 * Drizzle の `--> statement-breakpoint` もコメントなので、`;` で分ければ足りる。
 * CREATE TRIGGER は本体の中に `;` を持つので、`END` で終わるまでを 1 つの文にする。
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const pushCurrent = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = "";
  };

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      current += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += " ";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let end = i + 1;
      // 引用符を 2 つ重ねたものは、閉じではなく引用符そのもの
      while (end < sql.length && !(sql[end] === close && sql[end + 1] !== close)) {
        end += sql[end] === close ? 2 : 1;
      }
      current += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (/\s/.test(ch)) {
      if (!current.endsWith(" ")) current += " ";
      i++;
      continue;
    }
    if (ch === ";") {
      const isTrigger = /^\s*CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(current);
      if (!isTrigger || /\bEND\s*$/i.test(current)) {
        pushCurrent();
      } else {
        current += ";";
      }
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  pushCurrent();
  return statements;
}

/** 文を読み進めるための小さなカーソル。キーワードと名前を前から順に読む */
class Cursor {
  constructor(
    private readonly text: string,
    private pos = 0,
  ) {}

  /** 並んだキーワードがすべて合えば読み進めて true。合わなければ位置を戻して false */
  keywords(...words: string[]): boolean {
    let pos = this.pos;
    for (const word of words) {
      const match = new RegExp(`^\\s*${word}\\b`, "i").exec(this.text.slice(pos));
      if (!match) return false;
      pos += match[0].length;
    }
    this.pos = pos;
    return true;
  }

  /** 名前を読む。`"x"`・`` `x` ``・`[x]`・引用符なしに対応し、`main.x` なら `x` を返す */
  ident(): string | undefined {
    const first = this.identPart();
    if (first === undefined) return undefined;
    if (this.text[this.pos] === ".") {
      this.pos++;
      return this.identPart() ?? first;
    }
    return first;
  }

  /** ここから後の文 */
  rest(): string {
    return this.text.slice(this.pos).trim();
  }

  private identPart(): string | undefined {
    while (this.text[this.pos] === " ") this.pos++;
    const ch = this.text[this.pos];
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      let end = this.pos + 1;
      let name = "";
      while (end < this.text.length) {
        if (this.text[end] === close) {
          if (close !== "]" && this.text[end + 1] === close) {
            name += close;
            end += 2;
            continue;
          }
          break;
        }
        name += this.text[end];
        end++;
      }
      this.pos = end + 1;
      return name;
    }
    const match = /^[A-Za-z_][\w$]*/.exec(this.text.slice(this.pos));
    if (!match) return undefined;
    this.pos += match[0].length;
    return match[0];
  }
}

/** 文 1 つが、どの表に何をするかを読む */
export function analyzeStatement(sql: string): StatementInfo {
  const c = new Cursor(sql);
  const unknown: StatementInfo = { operation: "UNKNOWN", sql };
  const temp = () => c.keywords("TEMP") || c.keywords("TEMPORARY");

  if (c.keywords("CREATE")) {
    const unique = c.keywords("UNIQUE");
    if (c.keywords("INDEX")) {
      c.keywords("IF", "NOT", "EXISTS");
      const name = c.ident();
      if (!c.keywords("ON")) return unknown;
      return { operation: "CREATE INDEX", name, table: c.ident(), sql };
    }
    if (unique) return unknown;
    temp();
    if (c.keywords("TABLE")) {
      c.keywords("IF", "NOT", "EXISTS");
      return { operation: "CREATE TABLE", table: c.ident(), sql };
    }
    if (c.keywords("TRIGGER")) {
      c.keywords("IF", "NOT", "EXISTS");
      const name = c.ident();
      // BEFORE・AFTER・INSTEAD OF と、DELETE・INSERT・UPDATE OF 列 の後の ON が、対象の表
      const on = / ON ("(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[A-Za-z_][\w$.]*)/i.exec(c.rest());
      const table = on ? new Cursor(on[1]).ident() : undefined;
      return { operation: "CREATE TRIGGER", name, table, sql };
    }
    if (c.keywords("VIEW")) {
      c.keywords("IF", "NOT", "EXISTS");
      return { operation: "CREATE VIEW", name: c.ident(), sql };
    }
    return unknown;
  }

  if (c.keywords("DROP")) {
    const kind = (["TABLE", "INDEX", "TRIGGER", "VIEW"] as const).find((k) => c.keywords(k));
    if (!kind) return unknown;
    c.keywords("IF", "EXISTS");
    const name = c.ident();
    if (kind === "TABLE") return { operation: "DROP TABLE", table: name, sql };
    return { operation: `DROP ${kind}`, name, sql };
  }

  if (c.keywords("ALTER", "TABLE")) {
    const table = c.ident();
    if (c.keywords("RENAME", "TO")) {
      return { operation: "RENAME TABLE", table, renamedTo: c.ident(), sql };
    }
    if (c.keywords("RENAME")) {
      c.keywords("COLUMN");
      const name = c.ident();
      if (!c.keywords("TO")) return unknown;
      return { operation: "RENAME COLUMN", table, name, renamedTo: c.ident(), sql };
    }
    if (c.keywords("ADD")) {
      c.keywords("COLUMN");
      return { operation: "ADD COLUMN", table, name: c.ident(), sql };
    }
    if (c.keywords("DROP")) {
      c.keywords("COLUMN");
      return { operation: "DROP COLUMN", table, name: c.ident(), sql };
    }
    return unknown;
  }

  if (c.keywords("INSERT") || c.keywords("REPLACE")) {
    if (c.keywords("OR")) c.ident();
    if (!c.keywords("INTO")) return unknown;
    return { operation: "INSERT", table: c.ident(), sql };
  }

  if (c.keywords("UPDATE")) {
    if (c.keywords("OR")) c.ident();
    return { operation: "UPDATE", table: c.ident(), sql };
  }

  if (c.keywords("DELETE", "FROM")) {
    return { operation: "DELETE", table: c.ident(), sql };
  }

  if (c.keywords("PRAGMA")) {
    return { operation: "PRAGMA", name: c.rest(), sql };
  }

  return unknown;
}

/** 親の行が消えたときに、子の行に起きること。NO ACTION・RESTRICT は止めるだけなので含めない */
export type DeleteAction = "CASCADE" | "SET NULL" | "SET DEFAULT";

export interface ForeignKeyAction {
  /** 参照している先の表 */
  parent: string;
  action: DeleteAction;
}

/**
 * CREATE TABLE の文から、外部キーの ON DELETE の動きを読む。
 * D1 では外部キーの確認を止められないので、親の表を DROP TABLE すると、この動きで子の行が消えたり変わったりする。
 */
export function findDeleteActions(createTableSql: string): ForeignKeyAction[] {
  const [text = ""] = splitStatements(createTableSql);
  const actions: ForeignKeyAction[] = [];

  for (const match of text.matchAll(/\bREFERENCES /gi)) {
    const c = new Cursor(text, match.index + match[0].length);
    const parent = c.ident();
    if (!parent) continue;

    // 参照先の列の並び `(...)` の後から、次の `,` か閉じ括弧までが、この外部キーの句
    let clause = c.rest();
    if (clause.startsWith("(")) clause = clause.slice(clause.indexOf(")") + 1);
    const end = clause.search(/[,)]/);
    if (end !== -1) clause = clause.slice(0, end);

    const onDelete = /\bON DELETE (CASCADE|SET NULL|SET DEFAULT)\b/i.exec(clause);
    if (onDelete) {
      actions.push({ parent, action: onDelete[1].toUpperCase() as DeleteAction });
    }
  }
  return actions;
}
