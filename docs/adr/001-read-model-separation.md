# ADR-001: 読み取り専用モデル (Query 層) を Repository から分離する

## ステータス

提案

## コンテキスト

現在のアーキテクチャは、DDD をイメージした 4 層構成になっている。

```text
routes/     … React Router の loader / action。HTTP と画面のことだけを知る
usecases/   … 依存 (ポート) を引数で受け取る関数。認可判定と入力検証を行う
domain/     … Entity と Repository ポート。DB を知らない
infra/      … Drizzle による Repository 実装。SQL を書いてよい唯一の層
```

Repository はすべて「集約 1 件を ID で取る」形に揃っている
(`GroupRepository.findById` / `FacilityRepository.findById` /
`ReservationRepository.findById` / `MembershipRepository.findByGroupAndUser`)。
更新のための読み取りとしては、この形で過不足ない。

一方、PRD 8 章の画面一覧には、**複数の集約をまたいで一覧・集計するだけの画面**が並んでいる。

| 画面                       | 必要なデータ                          |
| -------------------------- | ------------------------------------- |
| SCR-007 団体管理画面       | グループ + 所属メンバー + 役割        |
| SCR-003 予約一覧・管理画面 | 予約 + 施設名 + 団体名                |
| SCR-005 予約詳細画面       | 予約 + 施設名 + 団体名 + 申請者名     |
| SCR-001 空き状況カレンダー | 施設 + 期間内の承認済み予約           |
| SCR-008 団体一覧画面       | 自分が所属する全グループ + メンバー数 |

これらを今の Repository だけで実現しようとすると、次のどちらかに必ず突き当たる。

1. **集約が肥大化する** — 表示のために `Group` へ `members` を持たせると、
   グループ名を変えるだけの更新系でも毎回メンバーを読むことになる。
   Entity が画面の都合で太り、不変条件がどこにあるのか分からなくなる。
2. **N+1 クエリになる** — `findById` を件数分繰り返す形になる。
   本番は Cloudflare D1 で 1 クエリごとにネットワーク往復が発生するため、
   ローカルの SQLite では顕在化しない遅さが本番でだけ出る。

つまり「**更新のための読み取り**」と「**画面のための読み取り**」は要求が正反対であり、
同じポートで両方を満たそうとしたことが問題の原因である。

## 決定

CQRS の考え方を軽量に取り入れ、**読み取り専用の Query 層 (`app/query/`) を新設**して、
表示のための読み取りを Repository から分離する。

### 1. レイヤー構成

```text
app/
  domain/           書き込み側: Entity と Repository ポート (現状のまま)
    group/index.ts
  query/            ★新設: 読み取り専用モデルと Query ポート
    error.ts
    group/group-member-list.ts
  infra/
    group/
      group-repo.ts               既存 (Repository 実装)
      group-member-list-query.ts  ★JOIN を書くのはここだけ
  usecases/
    group/
      get-group.ts                既存
      get-group-member-list.ts    ★Query を deps で受け取る
```

依存の向きは `usecases → query (ポート) ← infra (実装)` で、Repository とまったく同じ。
新しく覚える概念は「Query ポート」ひとつだけに抑える。

### 2. Repository と Query の使い分け

|                      | Repository                     | Query                      |
| -------------------- | ------------------------------ | -------------------------- |
| 返すもの             | 集約 1 件 (Entity)             | 画面 1 つ分のデータ (View) |
| 置き場所             | `app/domain/`                  | `app/query/`               |
| 用途                 | 更新に使う / 不変条件を守る    | 表示するだけ               |
| JOIN                 | 集約の内側をまとめて読むなら可 | 自由 (集計・ページングも)  |
| 結果で更新してよいか | **よい**                       | **いけない**               |

判断基準は JOIN の有無ではない。**取得したデータで更新するか**、
**集約をまたぐ表示専用か**の 2 点だけで決まる。

### 3. `query/` 配下のフォルダ分け

`domain/` は「集約ごと」に分けるが、`query/` は「**読み取りの入口ごと**」に分ける。
ここが両者の決定的な違いである。

> **そのクエリを呼ぶとき、引数に渡す ID は何か。その ID の集約がフォルダ。**

```text
app/query/group/group-member-list.ts
          ~~~~~ 入口 (引数は groupId)
                ~~~~~~~~~~~~~~~~~ 出口 (メンバーの一覧が返る)
```

フォルダが入口、ファイル名が出口を表すので、両方が名前から読み取れる。
「group と member はどちらが主体か」を意味論で議論すると必ず割れるため、
**常に答えの出る問い (どの ID を渡すか) に置き換える**のがこのルールの狙いである。

具体的な割り当ては次のとおり。

| 画面                                | Query の引数        | フォルダ             | ファイル                            |
| ----------------------------------- | ------------------- | -------------------- | ----------------------------------- |
| SCR-007 団体管理 (メンバー一覧)     | `groupId`           | `query/group/`       | `group-member-list.ts`              |
| SCR-003 予約一覧 (団体・自団体のみ) | `groupId`           | `query/group/`       | `group-reservation-list.ts`         |
| SCR-005 予約詳細                    | `reservationId`     | `query/reservation/` | `reservation-detail.ts`             |
| SCR-001 空き状況カレンダー          | `facilityId` + 期間 | `query/facility/`    | `facility-availability-calendar.ts` |
| SCR-008 団体一覧 (団体・自分の所属) | `userId`            | `query/user/`        | `user-group-list.ts`                |
| SCR-003 予約一覧 (事務局・全団体)   | ID なし (絞り込み)  | `query/reservation/` | `reservation-search.ts`             |
| SCR-008 団体一覧 (事務局・全団体)   | ID なし (絞り込み)  | `query/group/`       | `group-search.ts`                   |

判断の手順:

1. **引数の ID がある → その集約のフォルダ。**
   迷ったら URL を見る。`app/routes.ts` は既に入口を URL で表しているので、
   `/groups/:groupId` 配下の画面なら `query/group/` で確定する。
2. **引数に ID が無い → 返る一覧の 1 行が何かで決める。**
   事務局の承認待ち予約一覧なら 1 行 = 予約なので `query/reservation/`。
3. **どちらでも決まらない → 画面名のフォルダ。**
   ダッシュボードのような横断画面のみ `query/dashboard/` を認める。
   これは逃げ道なので、この種のフォルダが 3 つを超えたら
   ルール 1・2 の適用を諦めすぎていないか疑うこと。

### 4. フォルダを作ってよい集約

原則として `app/domain/` に対応するモデルがあるものだけ。
ただしこれは必要条件であって十分条件ではない。

**`query/membership/` は作らない。** `app/domain/membership/` は存在するが、
Membership は認可判定のための概念であり、
「この membership を表示する」画面が PRD のどこにも無い ―― つまり入口にならないため。
`session` / `account` / `verification` も同じ理由でフォルダを持たない。

### 5. 同じ組み合わせが 2 つのフォルダに現れるのは、重複ではなく正解

```text
query/group/group-member-list.ts   SCR-007 団体管理: 「このグループに誰がいる？」
query/user/user-group-list.ts      SCR-008 団体一覧: 「私はどのグループにいる？」
```

どちらも group × member を読むが、WHERE 句も必要な列も並び順も認可も違う。
1 本にまとめるとフラグと省略可能引数だらけの関数になり、
片方の画面の都合でもう片方が壊れる。**読み取りモデルは重複してよい。**
更新側と違い、重複してもデータの不整合は起きない。

### 6. 命名規則

```text
app/query/group/group-member-list.ts        型: GroupMemberList / GroupMemberListQuery
                                            メソッド: findByGroupId(groupId)
app/infra/group/group-member-list-query.ts  実装: createGroupMemberListQuery(db)
```

- ファイル名で主体を繰り返す (`group/member-list.ts` ではなく `group/group-member-list.ts`)。
  既存の `infra/group/group-repo.ts` `infra/group/group-converter.ts` と同じ流儀にそろえ、
  エディタのファイル検索で一意に引けるようにするため。
- infra 側は既存の `app/infra/<集約>/` に同居させ、`-repo` / `-query` で役割を区別する。
  ディレクトリを増やさず、「この集約に触る SQL はこのフォルダに全部ある」を保つ。

### 7. 認可は読み取りでも usecase 層で行う

Query は認可を判定しない。SCR-003 や SCR-007 は
「自団体のみ」「オーナーのみ」といった制限があるため、
`MembershipRepository` と `canPerform` による判定を usecase 層に置き、
そこを通過した場合のみ Query を実行する。

読み取りだけなら loader から Query を直接呼ぶ設計もありうるが、
このプロジェクトは認可が絡む画面がほとんどなので、**usecase は省略しない**。

## 理由

検討した選択肢は 3 つ。

### 案 A: Repository にメソッドを足す (却下)

`GroupRepository.findMembersByGroupId()` のように既存ポートを拡張する。
新しい層が要らず学習コストは最小だが、

- 戻り値が Entity でない (グループ + ユーザー + 役割の組) ため、
  Repository の「集約を返す」という約束が崩れる
- あるいは `Group` に `members` を持たせることになり、集約が肥大化する
- 「この Repository の結果は更新に使ってよいか」が呼び出し側から判別できなくなる

不変条件の置き場所が曖昧になる代償が大きく、却下。

### 案 B: usecase で複数の Repository を組み合わせる (却下)

新しい層を作らず、usecase 内で `groupRepository` と別の Repository を順に呼ぶ。
層構成は変わらないが、

- 一覧を取るメソッドを結局 Repository に足す必要があり、案 A と同じ問題に戻る
- 件数分の往復が発生し、D1 では N+1 が直接レイテンシに跳ね返る
- 結合処理 (JS 側での突き合わせ) が usecase に散らばり、
  同じ結合を別の画面でもう一度書くことになる

### 案 C: Query 層を分離する (採用)

- **集約を守れる。** Entity は更新の都合だけで設計でき、表示都合で太らない。
- **SQL の最適化を 1 箇所に閉じ込められる。** JOIN も集計もページングも
  `app/infra/` 配下の `*-query.ts` の中だけで完結し、上位層は形の変化を知らない。
- **層の形が Repository と同一。** ポートを domain の外に置くだけで、
  依存の向きも DI の書き方もテストの書き方も既存と変わらない。
  初心者中心のチームでも「Repository と同じ」で説明が済む。
- **テストが軽い。** Query ポートはインターフェースなので、
  usecase のテストは既存の Repository と同じくオブジェクトリテラルの
  フェイクを渡すだけで書ける。

## トレードオフ

| 犠牲・リスク                             | 対策                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ディレクトリと概念が 1 つ増える          | 層の形を Repository と完全に同一にし、覚える差分を「Query は更新に使わない」の 1 点に絞る          |
| 同じテーブルを読むコードが複数箇所に散る | これは意図した重複 (決定 5)。共通化を禁止するルールとして明文化する                                |
| Query の結果を誤って更新に使う事故       | View 型を `readonly` で固定し、メソッドを持たせない。ポートの JSDoc に「更新に使わない」と明記する |
| 読み取りモデルとテーブルの乖離           | Query の実装は必ず `infra/` に置き、スキーマ変更の影響範囲を `app/infra/` に閉じ込める             |
| ルールを知らずに書かれた PR が混ざる     | `AGENTS.md` に判断表を転記し、レビュー時のチェック項目にする                                       |

## 実装ガイド

SCR-007 (団体管理画面のメンバー一覧) を例に、4 ファイルの実装例を示す。

### 1. 共通のエラー型 — `app/query/error.ts`

```ts
import type { BaseError } from "~/domain/error";

export const QueryErrorCode = {
  NotFound: "NOT_FOUND",
  Forbidden: "FORBIDDEN",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type QueryErrorCode = (typeof QueryErrorCode)[keyof typeof QueryErrorCode];

export interface QueryError extends BaseError {
  readonly code: QueryErrorCode;
}
```

### 2. ポートと読み取りモデル — `app/query/group/group-member-list.ts`

```ts
import type { ResultAsync } from "neverthrow";
import type { MembershipRole } from "~/domain/membership";
import type { QueryError } from "../error";

/** 一覧に並ぶメンバー 1 人分。画面に出す項目だけを持つ */
export interface GroupMemberListItem {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly roles: readonly MembershipRole[];
  readonly joinedAt: Date;
}

/** 「グループのメンバー一覧」画面 1 つ分のデータ */
export interface GroupMemberList {
  readonly groupId: string;
  readonly groupName: string;
  readonly memberCount: number;
  readonly members: readonly GroupMemberListItem[];
}

/**
 * 読み取り専用の窓口 (ポート)。
 *
 * Repository が「集約 1 件」を返すのに対し、Query は「画面 1 つ分」を返す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface GroupMemberListQuery {
  findByGroupId(groupId: string): ResultAsync<GroupMemberList, QueryError>;
}
```

### 3. 実装 — `app/infra/group/group-member-list-query.ts`

```ts
import { asc, eq } from "drizzle-orm";
import { err, ok, ResultAsync, type Result } from "neverthrow";
import { member, organization, user } from "~/db/schema";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { GroupMemberList, GroupMemberListQuery } from "~/query/group/group-member-list";
import type { Database } from "../db";
import { toMembershipRoles } from "../membership/membership-converter";

export const createGroupMemberListQuery = (db: Database): GroupMemberListQuery => ({
  findByGroupId: (groupId) =>
    ResultAsync.fromPromise(
      // メンバーが 0 人のグループも「存在する」と分かるように leftJoin にする。
      // innerJoin だと 0 件になり、「グループが無い」と区別できず誤って 404 になる。
      db
        .select({
          groupName: organization.name,
          userId: user.id,
          userName: user.name,
          email: user.email,
          role: member.role,
          joinedAt: member.createdAt,
        })
        .from(organization)
        .leftJoin(member, eq(member.organizationId, organization.id))
        .leftJoin(user, eq(user.id, member.userId))
        .where(eq(organization.id, groupId))
        .orderBy(asc(member.createdAt)),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "グループのメンバー一覧の取得に失敗しました。",
        cause: error,
      }),
    ).andThen((rows) => toGroupMemberList(groupId, rows)),
});

/** JOIN で横に並んだ行を、画面が扱いやすい入れ子の形に組み直す */
const toGroupMemberList = (
  groupId: string,
  rows: readonly {
    groupName: string;
    userId: string | null;
    userName: string | null;
    email: string | null;
    role: string | null;
    joinedAt: Date | null;
  }[],
): Result<GroupMemberList, QueryError> => {
  const head = rows.at(0);

  // 1 行も返らない = そもそもグループが存在しない
  if (head === undefined) {
    return err({
      code: QueryErrorCode.NotFound,
      message: `ID が ${groupId} のグループは見つかりませんでした。`,
    });
  }

  // leftJoin なので、メンバー 0 人のときは user 側が null の行が 1 本だけ返る。
  // flatMap なら「null の行を捨てつつ変換する」が 1 回で書け、型も同時に絞れる。
  const members = rows.flatMap((row) =>
    row.userId === null ||
    row.userName === null ||
    row.email === null ||
    row.role === null ||
    row.joinedAt === null
      ? []
      : [
          {
            userId: row.userId,
            name: row.userName,
            email: row.email,
            roles: toMembershipRoles(row.role),
            joinedAt: row.joinedAt,
          },
        ],
  );

  return ok({ groupId, groupName: head.groupName, memberCount: members.length, members });
};
```

### 4. ユースケース (認可あり) — `app/usecases/group/get-group-member-list.ts`

```ts
import { errAsync, type ResultAsync } from "neverthrow";
import { GroupAction, groupPermissions } from "~/domain/group";
import { canPerform, type MembershipRepository } from "~/domain/membership";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { GroupMemberList, GroupMemberListQuery } from "~/query/group/group-member-list";

export interface GetGroupMemberListDeps {
  readonly groupMemberListQuery: GroupMemberListQuery;
  readonly membershipRepository: MembershipRepository;
}

export interface GetGroupMemberListArgs {
  readonly groupId: string;
  /** 閲覧しようとしているユーザー */
  readonly userId: string;
}

/**
 * グループの所属メンバー一覧を取得するユースケース (SCR-007)。
 *
 * 読み取りであっても認可は必要なので、所属と役割を確かめてから Query を実行する。
 * Query 自体は認可を知らない。
 */
export const getGroupMemberListUseCase = (
  deps: GetGroupMemberListDeps,
  args: GetGroupMemberListArgs,
): ResultAsync<GroupMemberList, QueryError> => {
  const groupId = args.groupId.trim();

  if (groupId === "") {
    return errAsync<GroupMemberList, QueryError>({
      code: QueryErrorCode.NotFound,
      message: "グループ ID が指定されていません。",
    });
  }

  return deps.membershipRepository
    .findByGroupAndUser(groupId, args.userId)
    .mapErr(
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "所属情報の取得に失敗しました。",
        cause: error,
      }),
    )
    .andThen((membership) =>
      // 所属していない場合 membership は null で、canPerform は必ず false を返す
      canPerform(groupPermissions, membership, GroupAction.View)
        ? deps.groupMemberListQuery.findByGroupId(groupId)
        : errAsync<GroupMemberList, QueryError>({
            code: QueryErrorCode.Forbidden,
            message: "このグループを閲覧する権限がありません。",
          }),
    );
};
```

テストは既存の usecase と同じく、フェイクを渡すだけで書ける。

```ts
const fakeQuery: GroupMemberListQuery = {
  findByGroupId: () => okAsync({ groupId: "g1", groupName: "テスト", memberCount: 0, members: [] }),
};
```

## Cloudflare D1 での注意

- **N+1 が致命的。** クエリごとにネットワーク往復が入るため、1 画面 = 1 クエリを目標にする。
  ローカルの SQLite では速度差が出ないので、レビューでクエリ本数を見ること。
- **独立した複数クエリが避けられない場合は `Promise.all([...])`** で同時に投げる。
  互いの結果を待たないので、待ち時間は 1 往復分に収まる。
- **`db.batch([...])` は使わないこと。** batch の結果だけは列名をキーにした
  オブジェクトを経由して配列に戻される (drizzle の `d1ToRawMapping`) ため、
  `organization.id` と `facility.id` のように**同じ列名を同時に選ぶと、
  同名の列がオブジェクト上で 1 つに潰れ、値が 1 列ずつずれて返る**。
  通常の実行は列の順番のまま読むので、この問題は起きない。
  例外も型エラーも出ず、別の列の値が静かに入るだけなので気づきにくい
  (`app/infra/user/user-reservation-list-query.ts` で実際に踏んだ)。
- **JOIN に使う列のインデックスを確認する。** `member_organizationId_idx` と
  `member_userId_idx` は既にあるので、上記のクエリは問題ない。
  新しい Query を追加するときは、WHERE と JOIN の列にインデックスがあるか確認する。
- **Drizzle のリレーショナルクエリも使える。** `app/db/schema/auth.ts` に
  `organizationRelations` / `memberRelations` が定義済みなので、
  `db.query.organization.findFirst({ with: { members: { with: { user: true } } } })`
  と書けば同等の結果が 1 クエリで得られる。
  単純な入れ子ならこちらが短いが、`COUNT` などの集計や凝った絞り込みは書けない。
  **単純な入れ子は RQB、集計や条件が入るなら明示 JOIN** と使い分ける。

## 適用範囲

**この ADR は既存コードの書き換えを求めない。**
`getGroupUseCase` `getFacilityUseCase` `getReservationUseCase` のような
単一集約の取得は Repository のままが正しい。

導入は段階的に行う。

1. `app/query/` を作り、最初は SCR-007 のメンバー一覧 1 本だけ実装する
2. `AGENTS.md` に「Repository と Query の使い分け」と「フォルダ分けの判断手順」を転記する
3. 以降、**JOIN や集計が必要になった画面から**順に Query へ切り出す

最初から全画面を CQRS 化する必要はない。

実際の初適用は、SCR-007 ではなくトップページ (SCR-003 の団体側) の
`app/query/user/user-reservation-list.ts` になった。
画面を 1 つ動かすのに一覧が必要になったのがここだったためで、手順そのものは変えていない。
