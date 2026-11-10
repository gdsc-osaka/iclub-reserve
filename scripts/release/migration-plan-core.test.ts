import { describe, expect, it } from "vite-plus/test";

import { buildPlan, compareRowCounts, PLAN_MARKER, type PlanInput } from "./migration-plan-core.js";

const counts = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("compareRowCounts", () => {
  it("同じ名前の表どうしを比べる（Drizzle の表の作り直しは、作り直した後の表と比べる）", () => {
    expect(
      compareRowCounts(
        counts({ room: 3, reservation: 5 }),
        counts({ room: 3, reservation: 4, __new_x: 0 }),
        [["__new_room", "room"]],
      ),
    ).toEqual({ decreased: ["reservation"], removed: [] });
  });

  it("改名した表は、改名後の表と比べる", () => {
    expect(
      compareRowCounts(counts({ users: 2 }), counts({ user: 2 }), [["users", "user"]]),
    ).toEqual({ decreased: [], removed: [] });
    expect(
      compareRowCounts(counts({ users: 2 }), counts({ user: 1 }), [["users", "user"]]),
    ).toEqual({ decreased: ["users（改名後: user）"], removed: [] });
  });

  it("後に無い表は、無くなった表にする", () => {
    expect(compareRowCounts(counts({ old: 0 }), counts({}), [])).toEqual({
      decreased: [],
      removed: ["old"],
    });
  });
});

const baseInput: PlanInput = {
  target: "production",
  databaseName: "iclub-reserve-db",
  repository: "gdsc-osaka/iclub-reserve",
  headSha: "0123456789abcdef",
  modified: [],
  deleted: [],
  unapplied: [],
  appliedNotInHead: [],
  appliedChanged: [],
  appliedUnrecorded: [],
  schemaBefore: new Map(),
};

describe("buildPlan", () => {
  it("当てるものが無ければ、そう書いてチェックを通す", () => {
    const plan = buildPlan(baseInput);
    expect(plan.errors).toEqual([]);
    expect(plan.markdown.startsWith(PLAN_MARKER)).toBe(true);
    expect(plan.markdown).toContain("まだ当てていないマイグレーションはありません");
  });

  it("当て済みのファイルを書き換えた・消したら、チェックを落とす", () => {
    const plan = buildPlan({
      ...baseInput,
      modified: ["0001_a.sql"],
      deleted: ["0002_b.sql"],
      appliedChanged: ["0026_c.sql"],
    });
    expect(plan.errors).toHaveLength(3);
    expect(plan.markdown).toContain("### チェックを落とした理由");
  });

  it("DROP TABLE は、ON DELETE CASCADE で参照している表と一緒に警告する", () => {
    const plan = buildPlan({
      ...baseInput,
      schemaBefore: new Map([
        ["reservation", "CREATE TABLE `reservation` (`id` text PRIMARY KEY)"],
        [
          "reservation_read",
          "CREATE TABLE `reservation_read` (`reservation_id` text, FOREIGN KEY (`reservation_id`) REFERENCES `reservation`(`id`) ON UPDATE no action ON DELETE cascade)",
        ],
      ]),
      unapplied: [
        {
          name: "0026_recreate.sql",
          sql: [
            "PRAGMA foreign_keys=OFF;--> statement-breakpoint",
            "CREATE TABLE `__new_reservation` (`id` text PRIMARY KEY, `note` text);--> statement-breakpoint",
            "INSERT INTO `__new_reservation`(`id`) SELECT `id` FROM `reservation`;--> statement-breakpoint",
            "DROP TABLE `reservation`;--> statement-breakpoint",
            "ALTER TABLE `__new_reservation` RENAME TO `reservation`;--> statement-breakpoint",
            "PRAGMA foreign_keys=ON;",
          ].join("\n"),
        },
      ],
      dryRun: {
        ok: true,
        before: counts({ reservation: 2, reservation_read: 2 }),
        after: counts({ reservation: 2, reservation_read: 0 }),
      },
    });

    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([
      "`0026_recreate.sql`: `reservation` を DROP TABLE する。ON DELETE CASCADE で、参照している `reservation_read` の行も消える。",
      "予行演習で行が減った表: `reservation_read`。",
    ]);
    expect(plan.markdown).toContain("| `reservation` | DROP TABLE（`0026_recreate.sql`） |");
    expect(plan.markdown).toContain(
      "| `__new_reservation` | CREATE TABLE（`0026_recreate.sql`）<br>INSERT（`0026_recreate.sql`）<br>RENAME TO `reservation`（`0026_recreate.sql`） |",
    );
  });

  it("行数はコメントに出さない", () => {
    const plan = buildPlan({
      ...baseInput,
      unapplied: [{ name: "0026_a.sql", sql: "DELETE FROM `session`;" }],
      dryRun: { ok: true, before: counts({ session: 98_765 }), after: counts({ session: 0 }) },
    });
    expect(plan.markdown).not.toContain("98765");
    expect(plan.markdown).not.toContain("98,765");
    expect(plan.warnings).toContain("予行演習で行が減った表: `session`。");
  });

  it("予行演習で失敗したら、どのファイルかを書いてチェックを落とす", () => {
    const plan = buildPlan({
      ...baseInput,
      target: "preview",
      databaseName: "iclub-reserve-preview-db",
      unapplied: [{ name: "0026_a.sql", sql: "CREATE UNIQUE INDEX u ON `user` (`email`);" }],
      dryRun: {
        ok: false,
        failedFile: "0026_a.sql",
        message: "\u001b[31mUNIQUE constraint failed: user.email\u001b[0m",
      },
    });
    expect(plan.errors).toEqual(["予行演習で `0026_a.sql` を当てるのに失敗しました。"]);
    expect(plan.markdown).toContain("UNIQUE constraint failed: user.email");
    expect(plan.markdown).not.toContain("\u001b[");
  });

  it("トークンが無ければ、チェックを落とす", () => {
    const plan = buildPlan({ ...baseInput, target: "preview", credentialsMissing: true });
    expect(plan.errors).toEqual([expect.stringContaining("トークンがありません")]);
  });
});
