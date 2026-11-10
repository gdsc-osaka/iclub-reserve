/**
 * PR に出すマイグレーションの概要を組み立てる（ADR-017 決定 6・8）。
 *
 * D1 や git には触れない。集めた事実を受け取り、コメントの Markdown と、チェックを落とす理由を返す。
 * 公開リポジトリなので、行数と行の中身はコメントに出さない（表の名前だけを出す）。
 */
import { stripVTControlCharacters } from "node:util";
import {
  analyzeStatement,
  findDeleteActions,
  splitStatements,
  type DeleteAction,
  type StatementInfo,
} from "./migration-sql.js";

/** 比べる相手の D1。`develop` 向きの PR は preview、`main`・`release/*`・`hotfix/*` 向きの PR は本番 */
export type PlanTarget = "production" | "preview";

export const TARGET_LABEL: Record<PlanTarget, string> = {
  production: "本番の D1",
  preview: "preview の D1",
};

/** コメントを見つけて書き直すための印 */
export const PLAN_MARKER = "<!-- migration-plan -->";

export interface MigrationFile {
  name: string;
  sql: string;
}

/** 予行演習（相手の D1 の写しに、未適用のものを当てた結果） */
export type DryRun =
  | {
      ok: true;
      /** 当てる前と後の、表ごとの行数。コメントには出さず、減ったかどうかだけに使う */
      before: ReadonlyMap<string, number>;
      after: ReadonlyMap<string, number>;
    }
  | { ok: false; failedFile?: string; message: string };

export interface PlanInput {
  target: PlanTarget;
  databaseName: string;
  repository: string;
  headSha: string;
  /** ベースのブランチにあって、この PR で書き換えた・消したマイグレーションのファイル */
  modified: readonly string[];
  deleted: readonly string[];
  /** 相手の D1 に当たっていないもの（当てる順） */
  unapplied: readonly MigrationFile[];
  /** 相手の D1 に当たっているのに、この PR に無いもの */
  appliedNotInHead: readonly string[];
  /** この PR で当てた後に、中身を書き換えたもの（本番への承認の記録と比べた） */
  appliedChanged: readonly string[];
  /** この PR で当たっているのに、当てたときの記録が無いもの */
  appliedUnrecorded: readonly string[];
  /** 相手の D1 の表の定義（表の名前 → CREATE TABLE の文）。CASCADE を調べるのに使う */
  schemaBefore: ReadonlyMap<string, string>;
  /** 未適用のものが無ければ予行演習はしない */
  dryRun?: DryRun;
  /** Cloudflare のトークンが無く、相手の D1 を読めなかった */
  credentialsMissing?: boolean;
}

export interface PlanResult {
  markdown: string;
  /** チェックを落とす理由 */
  errors: string[];
  /** コメントに出すだけで、チェックは落とさない */
  warnings: string[];
}

/** 文と、それを含むファイル */
interface LocatedStatement extends StatementInfo {
  file: string;
}

const code = (name: string) => `\`${name.replaceAll("`", "'")}\``;
const list = (names: Iterable<string>) => [...names].map(code).join("、");

/** 改名を順にたどって、表の最後の名前を返す */
function finalName(table: string, renames: readonly (readonly [string, string])[]): string {
  let name = table;
  for (const [from, to] of renames) {
    if (from === name) name = to;
  }
  return name;
}

/**
 * 当てる前と後の行数を比べ、行が減った表と、無くなった表を返す。
 * 同じ名前の表が後にもあれば、その表と比べる（Drizzle の表の作り直しは、作り直した後の表と比べる）。
 * 無ければ RENAME TO をたどり、改名後の表と比べる。
 */
export function compareRowCounts(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  renames: readonly (readonly [string, string])[],
): { decreased: string[]; removed: string[] } {
  const decreased: string[] = [];
  const removed: string[] = [];

  for (const [table, count] of before) {
    const name = after.has(table) ? table : finalName(table, renames);
    const afterCount = after.get(name);
    if (afterCount === undefined) {
      removed.push(table);
    } else if (afterCount < count) {
      decreased.push(name === table ? table : `${table}（改名後: ${name}）`);
    }
  }
  return { decreased, removed };
}

/** 子の表に起きること。`{tables}` に子の表の名前を入れる */
const DELETE_ACTION_EFFECT: Record<DeleteAction, string> = {
  CASCADE: "ON DELETE CASCADE で、参照している {tables} の行も消える。",
  "SET NULL": "ON DELETE SET NULL で、参照している {tables} の列が NULL になる。",
  "SET DEFAULT": "ON DELETE SET DEFAULT で、参照している {tables} の列が既定値になる。",
};

/**
 * 文を順にたどり、DROP TABLE で子の表に起きることを警告にする。
 * D1 では外部キーの確認を止められないので、`PRAGMA foreign_keys=OFF` があっても子の表に及ぶ。
 */
function dropTableWarnings(
  statements: readonly LocatedStatement[],
  schemaBefore: ReadonlyMap<string, string>,
): string[] {
  const schema = new Map(schemaBefore);
  const warnings: string[] = [];

  for (const s of statements) {
    if (!s.table) continue;
    if (s.operation === "CREATE TABLE") {
      schema.set(s.table, s.sql);
    } else if (s.operation === "RENAME TABLE" && s.renamedTo) {
      const sql = schema.get(s.table);
      schema.delete(s.table);
      if (sql) schema.set(s.renamedTo, sql);
    } else if (s.operation === "DROP TABLE") {
      const dropped = s.table;
      const children = new Map<DeleteAction, Set<string>>();
      for (const [table, sql] of schema) {
        if (table === dropped) continue;
        for (const fk of findDeleteActions(sql)) {
          if (fk.parent !== dropped) continue;
          children.set(fk.action, (children.get(fk.action) ?? new Set()).add(table));
        }
      }
      const effects = [...children].map(([action, tables]) =>
        DELETE_ACTION_EFFECT[action].replace("{tables}", list(tables)),
      );
      warnings.push(`${code(s.file)}: ${code(dropped)} を DROP TABLE する。${effects.join("")}`);
      schema.delete(dropped);
    }
  }
  return warnings;
}

/** 値を消したり変えたりする文の警告 */
function dataChangeWarnings(statements: readonly LocatedStatement[]): string[] {
  return statements.flatMap((s) => {
    switch (s.operation) {
      case "DROP COLUMN":
        return [`${code(s.file)}: ${code(`${s.table}.${s.name}`)} を DROP COLUMN する。`];
      case "UPDATE":
        return [`${code(s.file)}: ${code(s.table ?? "?")} を UPDATE する。`];
      case "DELETE":
        return [`${code(s.file)}: ${code(s.table ?? "?")} の行を DELETE する。`];
      case "UNKNOWN":
        return [`${code(s.file)}: 読み取れなかった文がある。SQL を手で確かめてください。`];
      default:
        return [];
    }
  });
}

/** 操作を短く書く（表ごとの一覧に使う） */
function describe(s: LocatedStatement): string {
  switch (s.operation) {
    case "RENAME TABLE":
      return `RENAME TO ${code(s.renamedTo ?? "?")}`;
    case "RENAME COLUMN":
      return `RENAME COLUMN ${code(s.name ?? "?")} → ${code(s.renamedTo ?? "?")}`;
    case "ADD COLUMN":
    case "DROP COLUMN":
      return `${s.operation} ${code(s.name ?? "?")}`;
    case "CREATE INDEX":
    case "CREATE TRIGGER":
      return `${s.operation} ${code(s.name ?? "?")}`;
    default:
      return s.operation;
  }
}

/** 表ごとに、どのファイルで何をするかの Markdown の表 */
function tableOperations(statements: readonly LocatedStatement[]): string {
  const byTable = new Map<string, string[]>();
  const others: string[] = [];

  for (const s of statements) {
    if (s.operation === "PRAGMA") continue;
    const item = `${describe(s)}（${code(s.file)}）`;
    if (s.table) {
      byTable.set(s.table, [...(byTable.get(s.table) ?? []), item]);
    } else {
      const named = s.name ? `${s.operation} ${code(s.name)}` : s.operation;
      others.push(`${named}（${code(s.file)}）`);
    }
  }

  const rows = [...byTable].map(([table, ops]) => `| ${code(table)} | ${ops.join("<br>")} |`);
  if (others.length > 0) rows.push(`| （表を特定できない文） | ${others.join("<br>")} |`);
  if (rows.length === 0) return "表を触る文はありません。";
  return ["| 表 | 操作 |", "| --- | --- |", ...rows].join("\n");
}

/** コメントが GitHub の上限（65536 文字）を超えないよう、SQL は合わせてこの長さまでにする */
const SQL_BUDGET = 40_000;

function sqlDetails(input: PlanInput): string {
  let budget = SQL_BUDGET;
  const blocks = input.unapplied.map((file) => {
    const url = `https://github.com/${input.repository}/blob/${input.headSha}/drizzle/migrations/${file.name}`;
    const heading = `[${code(file.name)}](${url})`;
    if (file.sql.length > budget)
      return `${heading}（長いので省きました。リンク先で読んでください）`;
    budget -= file.sql.length;
    return `${heading}\n\n\`\`\`\`sql\n${file.sql.trimEnd()}\n\`\`\`\``;
  });
  return `<details><summary>SQL</summary>\n\n${blocks.join("\n\n")}\n\n</details>`;
}

/** 失敗の文に混じる端末の色の指定を除く */
export const stripAnsi = (text: string) => stripVTControlCharacters(text);

export function buildPlan(input: PlanInput): PlanResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const target = `${TARGET_LABEL[input.target]}（${code(input.databaseName)}）`;

  for (const name of input.modified) {
    errors.push(
      `${code(name)} を書き換えています。当て済みのマイグレーションは書き換えず、新しいファイルを足してください。`,
    );
  }
  for (const name of input.deleted) {
    errors.push(`${code(name)} を消しています。当て済みのマイグレーションは消さないでください。`);
  }
  for (const name of input.appliedChanged) {
    errors.push(
      `${code(name)} は本番に当てた後に書き換えています。本番には書き換える前の中身が当たっています。新しいファイルを足して直してください。`,
    );
  }
  if (input.credentialsMissing) {
    errors.push(
      `${target}を読めませんでした（Cloudflare のトークンがありません）。フォークや Dependabot の PR では secret が渡らないので、マイグレーションを足すときは、このリポジトリのブランチから PR を出してください。`,
    );
  }

  // 最初のリリースでは、前に手で当てたものがまとめて並ぶので、1 つの警告にする
  if (input.appliedUnrecorded.length > 0) {
    warnings.push(
      `${list(input.appliedUnrecorded)} は${target}に当たっていますが、当てたときの記録がありません。手で当てたものなら、当てた中身と今の中身が同じかを確かめてください。`,
    );
  }
  if (input.appliedNotInHead.length > 0) {
    warnings.push(
      `${target}に、この PR に無いマイグレーションが当たっています: ${list(input.appliedNotInHead)}。ほかの PR で当てたものなら、その PR を先にマージするか、取り込んでください。`,
    );
  }

  const statements: LocatedStatement[] = input.unapplied.flatMap((file) =>
    splitStatements(file.sql).map((sql) => ({ ...analyzeStatement(sql), file: file.name })),
  );
  warnings.push(...dropTableWarnings(statements, input.schemaBefore));
  warnings.push(...dataChangeWarnings(statements));

  const dryRun = input.dryRun;
  if (dryRun?.ok) {
    const renames = statements
      .filter((s) => s.operation === "RENAME TABLE" && s.table && s.renamedTo)
      .map((s) => [s.table!, s.renamedTo!] as const);
    const { decreased, removed } = compareRowCounts(dryRun.before, dryRun.after, renames);
    if (decreased.length > 0) warnings.push(`予行演習で行が減った表: ${list(decreased)}。`);
    if (removed.length > 0) warnings.push(`予行演習で無くなった表: ${list(removed)}。`);
  } else if (dryRun) {
    errors.push(
      dryRun.failedFile
        ? `予行演習で ${code(dryRun.failedFile)} を当てるのに失敗しました。`
        : "予行演習でマイグレーションを当てるのに失敗しました。",
    );
  }

  const sections = [PLAN_MARKER, "## マイグレーションの概要", ""];
  sections.push(
    `比べた相手: ${target}・コミット ${code(input.headSha.slice(0, 7))}`,
    "",
    "### 当てるマイグレーション",
    "",
  );

  if (input.unapplied.length === 0) {
    sections.push(
      input.credentialsMissing
        ? "相手の D1 を読めなかったので、分かりません。"
        : `${target}に、まだ当てていないマイグレーションはありません。`,
    );
  } else {
    sections.push(
      input.unapplied.map((file) => `- ${code(file.name)}`).join("\n"),
      "",
      sqlDetails(input),
      "",
      "### 触る表と操作",
      "",
      tableOperations(statements),
      "",
      "### 予行演習",
      "",
    );
    if (!dryRun) {
      sections.push("予行演習はしていません。");
    } else if (dryRun.ok) {
      sections.push(`${target}の写しに、すべて当てられました。`);
    } else {
      sections.push(
        `${target}の写しに当てるのに失敗しました。`,
        "",
        "````text",
        stripAnsi(dryRun.message).trim(),
        "````",
      );
    }
  }

  if (errors.length > 0) {
    sections.push("", "### チェックを落とした理由", "", ...errors.map((e) => `- ${e}`));
  }
  if (warnings.length > 0) {
    const reader = input.target === "production" ? "本番への承認をする人は" : "レビューする人は";
    sections.push(
      "",
      "### 警告",
      "",
      `チェックは落としません。${reader}、意図したとおりかを確かめてください。`,
      "",
      ...warnings.map((w) => `- ${w}`),
    );
  }

  return { markdown: `${sections.join("\n")}\n`, errors, warnings };
}

/** マイグレーションを足していない PR で、前に書いたコメントを書き直すときの中身 */
export function buildEmptyPlan(): string {
  return `${PLAN_MARKER}\n## マイグレーションの概要\n\nこの PR はマイグレーションを足していません。\n`;
}
