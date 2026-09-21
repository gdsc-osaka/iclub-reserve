# ADR-003: Better Auth の組織プラグインをやめ、団体管理を自前のテーブルで持つ

## ステータス

承認 (2026-09-21)

ADR-001 (読み取り専用モデルの分離) と ADR-002 (Transactional Outbox) には影響しない。
この ADR が変えるのは「団体・メンバー・招待を**誰が持つか**」だけである。

## コンテキスト

組織プラグイン (`better-auth/plugins` の `organization`) は、
招待・役割・権限を Better Auth に任せられることを期待して導入した。
団体 (`organization`)・メンバー (`member`)・招待 (`invitation`) の 3 テーブルと、
`/api/auth/organization/*` のエンドポイント一式が手に入る、という判断である。

SCR-007 (団体管理画面) を PR1〜PR4 まで実装した時点で、この期待は成立しないことが分かった。

### 1. 実行時の API を 1 か所も呼んでいない

アプリから Better Auth の組織 API を呼んでいる箇所は**ゼロ**である。
`auth.api.*` の呼び出しは `getSession` (`app/lib/auth/auth-session.server.ts`) と
`listPasskeys` (`app/routes/passkey/suggest/route.tsx`) の 2 つだけ、
`authClient.*` は `addPasskey` だけしかない。

団体の読み取りは `app/query/` の読み取りモデル、
更新は `app/usecases/group/` と `app/infra/` の自前実装で完結している。
つまり組織プラグインが実際に果たしている役割は、
**テーブル定義を生成することと、誰も呼ばないエンドポイントを生やすことの 2 つ**だけである。

### 2. 事務局は組織 API を構造的に通れない

better-auth 1.7.5 の組織書き込みルート
(`update-organization` / `update-member-role` / `remove-member` / `invite-member` / `cancel-invitation`)
は、どれも最初に「操作者の member 行」を引き、行が無ければ
`USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` を返す。`ac` / `roles` による権限判定はその後である。

このアプリの事務局 (`user.is_staff`) は団体に所属しない前提 (COND-009) なので、
事務局の操作は**設定をどう変えても**組織 API を通らない。
`allowUserToCreateOrganization: false` を迂回できる `createOrganization` の `userId` 指定のような
抜け道も、書き込みルートには無い。
SCR-007 の更新系を自前に倒したのは、この制約が理由である (PR2 以降)。

### 3. プラグインの設定が残りの要求を塞いでいる

- **REQ-016 (団体の新規作成)** — `allowUserToCreateOrganization: false` のため利用者は作成できない
- **REQ-021 (事務局による有効化・無効化)** — `status` が `input: false` のため変更する経路が無い

どちらも自前の経路を作って回避するしかない。団体系で残っている要求
(REQ-016 / REQ-021 / UC-022 招待の承諾) は、すべて自前で書くことが既に確定している。

### 4. 権限表を二重に持っている

`app/lib/auth/permission.ts` は、ドメインの権限表 (`app/domain/group/index.ts` の `groupPermissions`) を
Better Auth の statement へ翻訳している。導出にしてあるので食い違いは起きないが、
**翻訳先を使うエンドポイントを 1 つも呼んでいない**以上、これは丸ごと不要な層である。

### 5. 使わないエンドポイントを塞ぐコードを保守している

`app/lib/auth/organization-guard.ts` は、組織プラグインが生やすエンドポイントのうち
4 経路を「使う予定も無いため塞ぐ」として 404 に倒し、
役割を受け取る 2 経路の入力を検証している。
プラグインが無ければ、そもそも塞ぐべき経路が存在しない。

### 6. スキーマが要件と合っていない

| 実態 | 要件 |
| --- | --- |
| `member.role` は `"admin,member"` のようにカンマ区切りで複数持てる | COND-007「メンバーの役割は 1 人 1 つ」 |
| `organization.slug` が NOT NULL UNIQUE | slug を使う画面も URL も無い |
| `session.active_organization_id` | 「現在の団体」を持つ設計を採っていない (複数所属が前提) |
| `organization` / `member` / `invitation` | RDRA では団体・団体メンバー・招待 |

カンマ区切り仕様のせいで、`toMembershipRoles` での分解、
管理者の人数を SQL で数えられず全行を引いて TS 側で数える実装 (`membership-repo.ts` の `countAdmins`)、
`(organization_id, user_id)` に一意制約が張れないこと、といった不便が連鎖している。

## 決定

### 1. 組織プラグインを外す。認証は Better Auth のまま残す

やめるのは `organization` プラグインだけである。
`user` / `session` / `account` / `verification` / `passkey` と、
emailOTP・パスキーの各プラグインは今までどおり Better Auth が持つ。
団体まわりのテーブルは、`user.id` を参照する**このアプリのテーブル**になる。

### 2. 団体・メンバー・招待は手書きのスキーマファイルで持つ

`app/db/schema/auth.ts` は `pnpm db:auth:generate` が上書きする生成物なので、
3 テーブルは `app/db/schema/group.ts` に移して手で書く。
生成物が小さくなるぶん、CLI の再生成で列が消える事故も減る。

### 3. テーブル名は `group` / `group_member` / `group_invitation`

`group` は SQL の予約語だが、Drizzle は識別子を必ず引用符 (マイグレーションではバッククォート) で
囲んで出力するため問題にならない。このプロジェクトは生 SQL をほとんど書かないので、
要件の語彙に合わせることを優先する。
**手で SQL を書くときだけは必ず `"group"` と引用符で囲むこと。**

TypeScript 側の変数名は既存の `facilityTable` / `reservationTable` にそろえて
`groupTable` / `groupMemberTable` / `groupInvitationTable` とする。

### 4. 列を整理する

- `group`: `slug` / `logo` / `metadata` を削除する
- `group_member` / `group_invitation`: `organization_id` を `group_id` に改名する
- `group_member`: `(group_id, user_id)` に UNIQUE 制約を張る
- `group_invitation`: `role` を NOT NULL にする
- `session`: `active_organization_id` を削除する

### 5. 役割は 1 人 1 つに固定する

`Membership.roles: readonly MembershipRole[]` を `Membership.role: MembershipRole` にする。
COND-007 を型とスキーマの両方で保証し、カンマ区切りを前提にした分解
(`toMembershipRoles`)・人数の数え直し (`countAdminUsers`)・
「いずれかの役割が許可すれば許可」の判定 (`rolesCan`) を取り除く。

管理者の人数は SQL の `count()` で数えられるようになる。
D1 は 1 クエリが 1 往復なので、転送量と組み立ての手間がそのまま減る。

### 6. 認可の定義元を `groupPermissions` 1 つにする

`app/lib/auth/permission.ts` を削除する。
役割と操作の対応は `app/domain/group/index.ts` の `groupPermissions` が唯一の定義元になり、
判定は `canPerform` (所属の有無を含む) を通す、という形だけが残る。

### 7. `organization-guard.ts` を削除する

塞ぐ対象のエンドポイントごと無くなる。
メールアドレスのドメイン制限 (`hooks.before` の認証コード送信チェック) はそのまま残す。

### 8. データ移行はしない

本番 D1 に団体のデータは無く、プレビューとローカルにはシードのデータしか無い。
REQ-016 が未実装で、そもそも利用者が団体を作る経路が存在しないためである。
移行スクリプトは書かず、マイグレーションは `ALTER TABLE ... RENAME TO` による素直な改名で済ませる。

**この判断が成り立つのは今だけである。** 承諾 (UC-022)・団体の作成 (REQ-016)・
有効化 (REQ-021) はどれも団体テーブルの上に積み上がるので、
先に進むほど移行の費用は上がる。だから招待の承諾を実装する前にここで切り替える。

## 理由

### 案 A: 現状のまま進める (却下)

追加の作業はゼロだが、コンテキストに挙げた 6 つの不都合がそのまま残り、
承諾・団体作成・有効化を実装するたびに「Better Auth の設定を迂回する」コードが増える。
迂回が増えるほど、プラグインは利益を生まないまま撤去の費用だけを押し上げる。

### 案 B: Better Auth の組織 API に寄せ直す (却下)

一見すると筋が良いが、コンテキストの 2 番により**実現できない**。
事務局を全団体の member 行として登録すれば通せるが、
所属していない人を所属させる形になり、
メンバー一覧や通知の宛先 (`reservation-mail-recipients-query.ts`) にも事務局が混ざる。
認可のために業務データを歪める判断であり、採らない。

### 案 C: 組織プラグインを撤去する (採用)

コードは差し引きで減る (`permission.ts`・`organization-guard.ts` と各テストが消える)。
ドメイン層とユースケース層は、PR1〜PR4 で 4 層に切り分けてきた結果、
すでに Group / Membership / Invitation の語彙で書かれており、
`organizationId → groupId` の変換は converter に閉じている。
そのため変更は infra とスキーマにほぼ収まる。

## トレードオフ

- **Better Auth の組織機能に戻る道は実質閉じる。** データが入ったあとの再移行は高くつく。
  ただし案 B のとおり、戻っても事務局の操作は通らない。
- **招待の承諾・団体の作成・有効化を自前で書く。** もともと自前で書くと決めていたので、増分は無い。
- **`group` が予約語であることを覚えておく必要がある。** 生 SQL を書く場面 (マイグレーションの手書き、
  `wrangler d1 execute`) では引用符が要る。

## 影響範囲

| 層 | 変更 |
| --- | --- |
| `app/db/schema/` | `group.ts` を新設。`auth.ts` から 3 テーブルと `active_organization_id` が消える |
| `drizzle/migrations/` | 改名・列削除・UNIQUE 追加のマイグレーションを 1 本追加 |
| `app/lib/auth/` | `permission.ts` と `organization-guard.ts` (+ 各テスト) を削除。`auth.server.ts` / `auth-client.ts` からプラグインの登録を削除 |
| `app/infra/` `app/query/` | 参照するテーブルの変数名と列名を差し替え。役割が単一になる |
| `app/domain/` | `Membership.roles` → `role`。`rolesCan` を削除 |
| `app/usecases/` | 役割の扱い以外は変更しない |
| `app/routes/` `app/components/` | 役割を配列で受け取っていた部品の型を直す |
| `scripts/seed/` | `slug` を落とし、列名を合わせる |

## 適用範囲

この ADR は団体管理のテーブルとプラグインの構成についてのみ述べる。
認証 (BIZ-006) の作り、メール通知 (ADR-002)、読み取りモデルの分離 (ADR-001) は変更しない。
