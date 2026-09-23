# ADR-004: エラーの分類と、利用者に見せる文言への変換を一本化する

## ステータス

提案 (2026-09-22)

ADR-001 が定めた 4 層構成 (routes / usecases / domain / infra) の上に立つ。
層の切り方は変えない。この ADR が決めるのは
**層をまたぐときにエラーが何を運ぶか**と、**それを誰が画面の言葉に直すか**だけである。
ADR-002 (Transactional Outbox) と ADR-003 (団体テーブルの自前化) には影響しない。

## コンテキスト

団体作成 (SCR-006) まで実装した時点で、エラーの扱いが画面ごとに分かれていることが分かった。
以下はすべて現状のコードを数えた結果である。

### 1. `message` が 2 つの役割を兼ねている

`BaseError.message` (`app/domain/error.ts`) には、性質の違う 2 種類の文字列が混ざっている。

| 文言                                     | 実際の役割       | 場所                                    |
| ---------------------------------------- | ---------------- | --------------------------------------- |
| `"Failed to query the database"`         | 開発者向け・ログ | `infra/facility/facility-repo.ts`       |
| `"Reservation not Found"`                | 開発者向け・ログ | `infra/reservation/reservation-repo.ts` |
| `"メンバーシップの取得に失敗しました。"` | どちらとも取れる | `infra/membership/membership-repo.ts`   |
| `"指定できない役割です。"`               | 利用者向け・画面 | `usecases/group/_shared/member-role.ts` |

そのため「このコードなら `message` をそのまま画面に出してよい」という判断を、
変換する側が毎回下すことになっている。
`app/lib/group-error-message.ts` の冒頭に置かれた長い JSDoc は、
その判断基準を人間の注意力で管理するために書かれたものである。
**型が語れていないことを、コメントが肩代わりしている。**

### 2. 文言の変換が 4 か所にあり、方針が揃っていない

| 場所                                             | やり方                                                      |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `app/lib/group-error-message.ts`                 | `lib` に置いた共通関数                                      |
| `app/routes/reservations/list/action-error.ts`   | 画面フォルダ内の関数                                        |
| `app/routes/reservations/new/form-values.ts`     | 画面フォルダ内の関数。`default:` で未知のコードを握りつぶす |
| `app/routes/invitations/$invitationId/route.tsx` | エラーコードを見ずに固定文字列を返す                        |

`group-error-message.ts` が `lib` にあるのは、`app/routes.ts` の
「複数の画面で使うものは `app/components/`・`app/lib/` へ出す」という規約に従った結果である。
SCR-006 と SCR-007 の両方から使うため、置き場所が `lib` しか無かった。
だが `lib` は `date.ts` や `app-url.ts` のような**画面を知らない道具**の場所であり、
表示の方針が混ざると浮く。規約の側に穴がある。

### 3. 同じエラーが、画面によって別の文言で出る

`ReservationForbidden` は、予約一覧では固定文言
(`"この予約を操作する権限がありません。"`)、申請画面では `error.message` の素通しになっている。
同じ失敗が場所によって違う言い方で出る。

### 4. ある入力の誤りが、別の入力欄の下に出る

`validateMembershipRole` は役割の誤りに `GroupInvalidInput` を返すが
(`"指定できない役割です。"`)、`toInviteFormErrors` は `GroupInvalidInput` を
**すべて** `emailError` へ流している。役割の誤りがメールアドレス欄の下に出る。
現在は役割が Select なので通常の操作では踏めないが、
`GroupInvalidInput` という 1 つのコードから「どの欄の話か」を復元できないことが原因であり、
入力欄の形が変われば表面化する。

### 5. 存在秘匿が、真実と同じ値に潰れている

`groupNotFound()` (`usecases/group/_shared/group-authorization.ts`) は、
「本当に存在しない」ときと「所属しておらず見えない」ときの両方で同じ値を返す。
外部への応答としては正しい (COND-011) が、
**サーバーのログでも両者が区別できない。**
URL の打ち間違いと、団体 ID の総当たりによる偵察が、ログ上で同じ行になる。

### 6. status への変換とログの要否が、各ルートに書き写されている

`app/routes/groups/$groupId/route.tsx` には
「`GroupNotFound` なら 404 を throw し、`DatabaseError` ならログに残す」が 5 回書かれている。
書き写しであるため基準が揃っておらず、次の 3 か所では**失敗が握りつぶされてログにも残らない**。

- `app/routes/home/route.tsx` — `isGroupsUnavailable: true` を返すだけ
- `app/routes/reservations/new/route.tsx` — 500 を throw するだけ
- `app/routes/facility/$facilityId/route.tsx` — 500 を throw するだけ

本番で D1 の障害が起きても、これらの画面からは手がかりが残らない。

残している側も、残す範囲が狭い。`groups/$groupId/route.tsx`・`reservations/list/route.tsx`・
`reservations/staff/route.tsx` はいずれも「想定内なのでログに残さない」とコメントし、
入力の誤り・権限・不在を残していない。`logServerError` (`app/lib/log.server.ts`) は
`console.error` の 1 段しか持たないので、想定内のものまで混ぜれば本当の障害が埋もれる。
その判断自体は筋が通っているが、結果として、権限の無い操作の試行も、ID の総当たりも、
画面側の権限表示のバグも、起きた跡が残らない。

加えて、出力は `[where] code: message` という文字列で、誰の操作かを持たない。
残した分についても、コードごと・利用者ごとに数えることができない。

### 7. 列挙子の名前が型名を繰り返している

`ReservationErrorCode.ReservationNotFound` のように、列挙子の名前に型名が入っている。
`app/query/error.ts` の `QueryErrorCode` だけは
`NotFound` / `Forbidden` / `DatabaseError` になっており、すでに揃っていない。

### 8. 分類をドメインに置く先例が、すでに 2 つある

- `app/domain/mail/mail-sender.ts` の `isRetryable` — コードを分類する関数をドメインに置いている。
  理由も明記されている。「ここを呼ぶ側が code を直接見に行くと、再試行の方針が呼び出し箇所の数だけ増えてしまう」
- `app/query/error.ts` の `QueryErrorCode` — 集約をまたぐためドメイン固有のコードを持てず、
  結果として分類 (`NotFound` / `Forbidden` / `DatabaseError`) だけが残っている

この ADR がやることは、**2 つ目の語彙を書き込み側のエラーにも通し、
1 つ目のやり方でそれを表現する**ことに尽きる。

## 決定

### 1. エラーコードの列挙子から、型名の繰り返しを外す

**文字列の値は変えない。** 変えるのは TypeScript 側の名前だけである。

```ts
export const ReservationErrorCode = {
  NotFound: "RESERVATION_NOT_FOUND",
  Forbidden: "RESERVATION_FORBIDDEN",
  InvalidPeriod: "RESERVATION_INVALID_PERIOD",
  // …
  DatabaseError: "DATABASE_ERROR",
} as const;
```

値を据え置くのは、ログに出る文字列が変わると過去のログとの突き合わせができなくなるためである。

**外すのは型名の繰り返しだけで、対象が違うものは残す。**
`GroupErrorCode.MemberNotFound` と `InvitationNotFound` は
「団体が無い」ではなく「メンバーが / 招待が無い」であり、`NotFound` に短縮すると意味が変わる。

### 2. `message` を「ログ用」に固定し、利用者向けの文言を `userMessage` に分ける

```ts
export interface BaseError {
  /** ログにだけ残す説明。画面には出さない */
  readonly message: string;
  /** ドメインが利用者に向けて書いた文言。画面にそのまま出してよい */
  readonly userMessage?: string;
  /** 元となった例外。ログ出力用で、クライアントには返さない */
  readonly cause?: unknown;
}
```

`message` の名前を据え置くのは、既存の約 40 か所の構築を触らずに済ませるためである。
移すのは、利用者に向けて書かれていた側だけになる
(`groupForbiddenMessages`、`validateGroupName`、`validateMembershipRole`、予約の各検証)。

`userMessage` を付け忘れたエラーは、表 (決定 5) の既定文言に落ちる。
`"Failed to query the database"` が画面に出る代わりに汎用文言が出る、という**安全側の劣化**になる。

### 3. コードを分類する `kind` を、コードからの写像として持つ

```ts
// app/domain/error.ts
export const ErrorKind = {
  NotFound: "not_found",
  Forbidden: "forbidden",
  InvalidInput: "invalid_input",
  Conflict: "conflict",
  Internal: "internal",
} as const;

// app/domain/group/index.ts
export const groupErrorKind: Record<GroupErrorCode, ErrorKind> = {/* … */};
```

**エラーオブジェクトのフィールドにはしない。** フィールドにすると構築箇所すべてに書き足すことになり、
しかも `GroupErrorCode.NotFound` に `kind: "internal"` と書いても型が通ってしまう。
コードから引く表にすれば、構築箇所の変更はゼロで、対応は常に 1 か所で決まる。
`isRetryable` と同じ形である。

これにより次の 2 つが全ドメインで 1 行になる。

```ts
const statusOf: Record<ErrorKind, number> = {
  not_found: 404,
  forbidden: 403,
  invalid_input: 400,
  conflict: 409,
  internal: 500,
};
const logLevelOf: Record<ErrorKind, LogLevel> = {
  not_found: "info",
  forbidden: "warn",
  invalid_input: "info",
  conflict: "info",
  internal: "error",
};
```

ログは「残すか残さないか」ではなく「どのレベルで残すか」だけを決める。
レベルの選び方と、ログに何を残すかは決定 9 で述べる。

さらに、内部事情の漏洩を分岐で塞げる。

```ts
const userText = (error: BaseError, kind: ErrorKind, fallback: string) =>
  kind === ErrorKind.Internal ? fallback : (error.userMessage ?? fallback);
```

`internal` のエラーは `userMessage` を持っていても通らない。
ドメインを増やしても、この 1 か所が効き続ける。

**`kind` を付けないものもある。** `MailSendError` と `MailOutboxError` は
`app/routes/` にも `workers/app.ts` にも到達せず、利用者に提示されない。
提示されないエラーに提示用の分類は要らない。メールにはすでに `isRetryable` という別の軸がある。

一方、ユーザー (`UserError`) には `userErrorKind` を付けた。いまはどの画面もユーザーのユースケースを
使っていないが、利用者に返すために作ったユースケースのエラーであり、分類はコードの性質としてドメインに置ける。
表 (決定 5) の方は画面の側の事情なので、画面から使うときに足す (Phase 3)。

### 4. 存在秘匿は、ユースケースではなく表現の側で行う

ユースケースは正直なコードを返す。`GroupErrorCode.NotVisible` (`"GROUP_NOT_VISIBLE"`) を新設し、
`ensureGroupIsVisible` はこれを返す。`kind` は `forbidden` である。

秘匿は決定 5 の表で行う。`NotVisible` の行が `NotFound` の行と**同一であること**が、
COND-011 の表明になる。

```ts
// COND-011: 見えないことを「無い」として答える。既定の 403 を意図的に破っている
[GroupErrorCode.NotVisible]: { status: 404, message: GROUP_NOT_FOUND_TEXT },
[GroupErrorCode.NotFound]:   { message: GROUP_NOT_FOUND_TEXT },
```

2 行が同一であることはテストで固定する。
`status` が明示されている行が「ここは既定どおりではない」という印になる。

これでサーバーのログには `GROUP_NOT_VISIBLE` が `warn` として残り (決定 9)、
外部への応答は 404 のまま変わらない。

**`NotVisible` が表すのは「所属が無い」ことまでで、団体が存在するかは確かめない。**
確かめると、存在する団体のときだけ D1 への往復が 1 回増え、応答時間の差から存在が漏れる
(`get-group-management.ts` がすでに避けている)。そのため一般の利用者が打ち間違えた URL も `NotVisible` になり、
`NotFound` になるのは事務局が引いたときと ID が空のときだけである (Phase 1 で確認)。
コンテキストの 5 で挙げた打ち間違いと総当たりの区別は、1 行ずつではできず、決定 9 のとおり利用者ごとの件数で行う。
1 行ずつ区別できるようになるのは「所属の無い団体 ID を開こうとした」と「本当に無い」の 2 つである。

**予約にも同じ形で `ReservationErrorCode.NotVisible` (`"RESERVATION_NOT_VISIBLE"`) を置く。**
`ensureCanViewReservation` は、見せられない予約を「見つからない」と答えている (COND-008)。
いまは権限表の `base` が予約の概要を全員に見せているので起きないが、`base` を狭めたときに
秘匿がログにまで持ち込まれないよう、団体と同じく正直なコードを返しておく (Phase 2)。

**招待にも同じ形で `GroupErrorCode.InvitationNotVisible` (`"INVITATION_NOT_VISIBLE"`) を置く (Phase 3)。**
招待の承諾画面 (SCR-016) は、宛先が本人ではない招待を、無い・期限切れ・取り消し済みの招待と同じく
「見つからない」と答えている (COND-011)。これまではユースケースの `invitationNotFound()` が 4 つを
1 つの値に潰しており、コンテキストの 5 で見た `groupNotFound()` と同じく、ログでも区別できなかった。
宛先違いだけを `InvitationNotVisible` (`forbidden`) として返し、応答を揃えるのは SCR-016 の表で行う。
招待 ID は当て推量できないので、ここに来るのは転送されたリンクを開いたか、宛先と別のアカウントでログインしているかである。

無い・期限切れ・承諾待ちでない、の 3 つは `InvitationNotFound` のままにし、どれに当たったかは `message` にだけ書く。
利用者から見ればどれも「この招待ではもう参加できない」という同じ事実で、`kind` を分ける理由が無い。

承諾と辞退は `InvitationNotFound` のままで、宛先違いを見分けない。判定を条件付き UPDATE に畳み込んでおり
(事前に SELECT しないことで競合を防いでいる)、どの条件で外れたかが分からないためである。
見分けるために SELECT を足すとその利点を失う。宛先違いは、承諾より前に画面を開いた時点で `InvitationNotVisible` として残る。

**表で上書きするのは status と文言だけで、ログのレベルは上書きしない。**
秘匿が要るのは外部への応答であって、サーバーのログではない。
`NotVisible` のレベルを `NotFound` に合わせて `info` へ落とすと、秘匿をログにまで持ち込むことになり、
正直なコードを返すようにしたこの決定の意味が無くなる。

### 5. 利用者に見せる文言は、ドメインごとの表 1 枚に集める

置き場所は `app/routes/_shared/` とする。`app/routes.ts` はルートを明示設定しているため、
`_shared` フォルダがルートとして拾われることはない。`app/usecases/_shared/` と同じ言い回しになる。

```ts
interface ErrorView {
  /** 省略時は kind から決まる。破るときだけ書く */
  readonly status?: number;
  readonly message: string;
}
const groupErrorView: Record<GroupErrorCode, ErrorView> = {/* … */};
```

`ErrorView` にはログのレベルを持たせない。この表が決めるのは外部に何を見せるかだけで、
何をどのレベルで残すかは `kind` だけで決まる (決定 4・9)。

`Record<GroupErrorCode, ErrorView>` にするのは、コードを増やしたときに型エラーで気づくためである。
現在の `toFormErrors` の `default:` のような握りつぶしが構造的に起きなくなる。

`app/lib/group-error-message.ts` は削除する。
あわせて `app/routes.ts` の規約コメントに `routes/_shared/` を加える。

**Query の表は、何が無かったのかを名指しできない (Phase 3)。**
Query は集約をまたぐので (ADR-001)、`QueryErrorCode.NotFound` が施設のことか予約のことかを表は知らない。
文言は「表示する内容が見つかりません。」にとどめ、画面ごとの具体的な案内は各ルートの ErrorBoundary が status を見て出す。
いまの ErrorBoundary はどれも status しか見ておらず、応答の文言を画面に出していないので、これで足りる。

### 6. どの入力欄に出すかは、ドメインの `field` と画面ごとの表で決める

「どの項目の誤りか」はドメインが知っている。`validateGroupName` は名前について、
`validateMembershipRole` は役割について検証している。その情報を捨てないようにする。

```ts
// app/domain/group/index.ts
export const GroupField = {
  Name: "group_name",
  InviteeEmail: "invitee_email",
  MemberRole: "member_role",
} as const;

export interface GroupError extends BaseError {
  readonly code: GroupErrorCode;
  /** 入力の誤りのとき、どの項目についての誤りか。画面が欄を決めるのに使う */
  readonly field?: GroupField;
}
```

`*Input` ではなく `*Field` としたのは、`UpdateGroupNameInput` など
「ユースケースへの入力」を表す既存の命名と衝突させないためである。

画面側は、ドメインの語彙を自分の欄名に対応づける小さな表を持つ。

```ts
// app/routes/groups/$groupId/route.tsx (招待の送信)
...groupActionErrors(contextOf("invite-member"), result.error, {
  [GroupField.InviteeEmail]: "emailError",
  // MemberRole はこの画面では Select。欄の下に出す先が無いので、書かずに Alert へ落とす
}),
```

**この表だけ `Partial` にする。** 決定 5 の表は書き忘れると秘匿が破れるため網羅を強制するが、
こちらは書き忘れても文言がフォーム上部の Alert に出るだけで、安全側に劣化する。
**忘れたときの被害の大きさに、強制の度合いを合わせる。**

**`field` は入力の誤り (`invalid_input`) に限らない。** 承認済みの予約との重なり (`Conflict`) なら利用時間を、
申請元の団体が承認待ち (`GroupNotEligible`) なら団体を選び直せば通る。どの欄の下に出るかで
何を選び直せばよいかが伝わるので、選び直せば通る失敗にも `field` を付ける。
欄の無い画面 (予約一覧) では表に載らないので、フォームの上に出るだけである (Phase 2 で確認)。

予約の申請フォームでは、使用人数と備考の誤りが `InvalidInput` の 1 つのコードに潰れていたため、
どちらもフォームの上に出ていた。コンテキストの 4 と同じ原因で、`field` によってそれぞれの欄の下に出るようになった。

### 7. ルートのグルーを 2 本に畳む

```ts
// loader
if (result.isErr()) {
  throw groupErrorResponse({ where: "groups.detail.loader", userId: user.id }, result.error);
}

// action
if (result.isErr()) {
  return groupActionErrors({ where: "groups.detail.action", userId: user.id }, result.error, {
    /* … */
  });
}
```

どのレベルで残すかは `kind` から決まり、グルーには「残さない」という選択肢が無い。
そのため、コンテキストの 6 に挙げた 3 か所の取りこぼしも同時に埋まる。

`userId` を必須の引数にするのは、決定 9 のとおり、誰の操作かが無いとログから傾向を読めないためである。

**action のグルーは、status が 404 になるエラーだけは返さずに投げる。**
404 はその URL が指すもの (画面そのもの) が無いことを表し、誤りを出す先のフォームが無い。
また loader が 404 を返す状況で action だけ 200 を返すと、応答の違いから存在を推測できる (COND-011)。
そのため、URL ではなくフォームで指したものが無いとき (`MemberNotFound`・`InvitationNotFound`) は、
表で status を 409 に上書きする。URL の団体はあり、画面を開いた後に状態が変わっただけだからである。

**投げる応答の文言は表のものだけを使い、`userMessage` は使わない。**
画面ごと差し替える応答なのでフォームに向けた文言の出番が無く、
また `NotVisible` に誰かが `userMessage` を付けても秘匿が崩れないようにするためである。

**同じコードでも、画面によって URL の指すものかどうかが変わる。** 予約の `NotFound` は、
予約詳細 (SCR-005) では URL の指すものだが、予約一覧 (SCR-003) の各行の操作ではフォームで指したものである。
団体の `MemberNotFound` のようにコードを分けることはできない (どちらも「予約が無い」という同じ事実で、
ユースケースは画面を知らない)。そのため予約は表を 2 枚持ち、loader 用の表では `NotFound` を 404 に、
action 用の表では 409 にする。いま予約を操作する action はどれも予約をフォームで指しているためで、
予約詳細に action を足すときは、loader 用の表を使う action のグルーを足す (Phase 2)。

招待も同じで、団体の画面 (SCR-007) ではフォームで指すので 409、承諾画面 (SCR-016) では URL が指すので 404 にする。
SCR-016 の表 (`invitationErrorView`) は `groupErrorView` を広げて招待の 2 行だけを差し替えたもので、
`InvitationNotVisible` の行は `InvitationNotFound` の行と同じ文言の 404 にしてある (Phase 3)。

action 用の表では `NotFound` と `NotVisible` を投げずに返すので、上の理由で守られていた秘匿が `userMessage` で崩れうる。
そこで `ErrorView` に `ignoreUserMessage` を足し、秘匿のために揃えたこの 2 行に付けた。
付けた行は `userMessage` を持つエラーでも表の文言だけを出す。404 を投げる行には要らない。

**失敗しても画面を開く loader のために、ログだけを残す関数を足す (Phase 3)。**
ダッシュボードの loader は、団体の一覧が読めなくても画面を開く (ログイン後の行き先なので、500 にすると行き場が無くなる)。
応答を作らないので 2 本のグルーのどちらも使えず、ルートから `logFailure` を直接呼ぶと、
分類からレベルを引く処理をルートに書き写すことになる。そこで `error-response.server.ts` の `logDomainError` を公開し、
Query 用に `logQueryError` を置いた。失敗を握って画面を続けるかどうかは画面が決めてよいが、
ログに残すかどうかは画面に決めさせない、という線はこれでも変わらない。

**ルートで先に弾く分岐も、ログを残さない分岐になる (Phase 3)。**
事務局の予約画面 (`reservations/staff/route.tsx`) は、loader と action の冒頭で「事務局でなければ 403」を自前で投げていた。
ユースケースにも同じ判定があり (`getReservationListUseCase` の `scope: "all"`、`canTransition` の事務局だけの操作)、
ルートの分は判定の書き写しであるうえ、そこで弾いた分はログに残らなかった。
ルートの判定を外し、ユースケースの `Forbidden` を表に通すようにした。loader は 403、action はフォームの上の誤りになり、どちらも warn で残る。
action では予約を 1 回引いてから弾くことになるが、事務局でない人が送ってくるのは画面を経ない送信だけなので、問題にならない。

### 8. Infra と UseCase でエラー型は分けない

infra が構築しているエラーコードを全件数えたところ、`DatabaseError` と `*NotFound` の 2 種類しか無く、
`ReservationInvalidPeriod` のような業務寄りのコードを infra が作っている箇所は無かった
(メール送信を除く)。**分離は事実上すでにできている。**

型を 2 本に割っても表現できる情報は増えず、増えるのは `InfraError → DomainError` の変換が
現在の 15 か所から全リポジトリ呼び出しへ膨らむ費用だけである。
必要な区別は決定 3 の `kind` で足りる (`internal` は原理的に infra 由来)。

### 9. ログは `kind` に応じたレベルで、すべて残す

**`internal` 以外も残す。** 想定内の差し戻しも、バグと偵察を見つける手がかりになる。

| `kind`          | レベル  | 残す理由                                                                                                                                             |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `internal`      | `error` | 障害。人が対応する                                                                                                                                   |
| `forbidden`     | `warn`  | 通常の操作では起きない (権限の無い操作は画面に出していない)。起きたなら、古いタブ・改ざん・画面側の権限表示のバグのどれか。`NotVisible` もここに入る |
| `not_found`     | `info`  | 打ち間違いと、ID の総当たり。1 件ずつでは区別できないが、同じ利用者からの件数で区別できる                                                            |
| `invalid_input` | `info`  | ほとんどは入力の誤り。ただし画面側で防いでいるはずの誤り (Select の値の改ざんなど) はここにしか出ない                                                |
| `conflict`      | `info`  | 予約の重なりなど。どれだけ起きているかは運用の判断材料になる                                                                                         |

コンテキストの 6 で見たとおり、これまでは想定内のものを残さないことで障害が埋もれるのを防いでいた。
レベルで分ければ、障害は `error` で絞るだけで取り出せる。**残さない理由の方が無くなる。**

**残す形は、次の項目を持つオブジェクトにする。**

```ts
{
  level: "warn",
  where: "groups.detail.loader",
  code: "GROUP_NOT_VISIBLE",
  kind: "forbidden",
  userId: "…",
  message: "…",
}
```

- **オブジェクトで出す。** Workers Logs はオブジェクトで出したログの項目を索引し、絞り込みに使えるようにする。
  文字列の `[where] code: message` では、コードごと・利用者ごとに数えられない。
- **`level` を項目にも入れる。** `console.warn` と `console.info` の違いで絞り込めるかは、
  Workers Logs の説明に書かれていない。項目にしておけば、それに頼らずに済む。
- **`userId` を必ず入れる。** 無いと「1 人が ID を 1,000 回試した」と「1,000 人が 1 回ずつ打ち間違えた」が
  ログ上で同じに見える。偵察を見分けるには、誰の操作かが要る。
- `cause` は今と同じく残す。Workers Logs がオブジェクトの中の `Error` をどう直すかは説明に書かれておらず、
  `JSON.stringify` では `Error` の name・message・stack が列挙されないため `{}` になる。
  そのため `log.server.ts` が `cause` をたどり、`Error` を `{ name, message, stack, cause }` に直してから渡す
  (Phase 1 で確認)。

**入力値は残さない。** `message` にも、どの項目にも、利用者が入力した値を埋め込まない。
とくに招待相手のメールアドレスは、まだ団体に加わっていない第三者の個人情報である。
`internal` 以外も残すようになると、入力の誤りを説明しようとして値を埋め込みたくなる場面が増えるため、
ここで禁止しておく。ID (団体・予約・利用者など) は埋め込んでよい。
今の `message` が埋め込んでいるのも ID だけである (`infra/user/user-repo.ts` など)。

## 理由

### 案 A: 現状のまま、気づいたところだけ直す (却下)

変換が 4 か所に散っている構造が残るため、画面を足すたびに 5 か所目が増える。
コンテキストの 3・4 のようなズレは、増えた箇所どうしの間で再び発生する。

### 案 B: Infra 用と UseCase 用でエラー型を分ける (却下)

層の責務としては筋が通るが、決定 8 のとおり infra が作るコードは 2 種類しか無く、
分離によって得られる情報がほぼ無い。変換の記述量だけが増える。

### 案 C: 全ドメイン共通の変換関数を 1 つ作る (却下)

文言はドメインの語彙であり (「団体が見つかりません」「予約が見つかりません」)、
1 つの関数に集めると分岐の中でドメインを見分けることになる。
共通化してよいのは**表の形**と**表を読むグルー**だけで、表の中身は共通化できない。

### 案 D: 分類 (`kind`) + ドメインごとの表 + 画面ごとの表 (採用)

決めることを 3 つに分け、それぞれを決められる場所に置く。

| 決めること         | 決める人                         | 置き場所              |
| ------------------ | -------------------------------- | --------------------- |
| status             | `kind` (既定) + 表の上書き       | `app/domain/`         |
| ログのレベル       | `kind` のみ (上書きしない)       | `app/domain/`         |
| 画面に出す文言     | ドメインごとの表 + `userMessage` | `app/routes/_shared/` |
| どの入力欄に出すか | `field` + 画面ごとの表           | `app/routes/<画面>/`  |

共有できるもの (方針) と共有できないもの (欄の名前) の間に線を引ける唯一の案である。

## トレードオフ

- **短縮した列挙子は、ドメインをまたぐと見分けがつきにくい。**
  `GroupErrorCode.NotFound` と `ReservationErrorCode.NotFound` は見た目が似る。
  型が違うので取り違えはコンパイルで落ちるが、読むときは import 名に頼ることになる。
- **`kind` から status が決まることに寄りかかりすぎると、秘匿を壊す。**
  既定を破る行 (`NotVisible`) は必ず `status` を明示し、理由をコメントに書くこと。
- **`userMessage` の付け忘れは型では防げない。** 付け忘れると汎用文言に落ちるだけで壊れないが、
  利用者に対しては不親切になる。ドメインの検証関数を書くときの約束として `AGENTS.md` に残す。
- **`GroupNotEligible` と `FacilityNotAvailable` の `kind` は `conflict` とした (Phase 2)。**
  forbidden とも invalid_input とも読めたが、申請する権限はこの確認より前に確かめ終えており、
  送られてきた ID も正しい形をしている。通らない理由は団体・施設のいまの状態 (承認待ち・無効) なので、
  `ErrorKind.Conflict` の定義 (入力は正しいが、いまの状態と両立しない) に当たる。
  その代わり、ログは `info` になる。申請フォームの選択肢は有効な団体・施設に絞ってあるので、
  書き換えた送信もここに `info` で混ざる。見分ける必要が出たら `forbidden` (`warn`) へ移すことを考える。
- **ログの件数が増える。** 差し戻しもすべて残すためである。ただし Workers Logs の上限
  (無料プランで 1 日 20 万件、有料プランで月 2,000 万件) に届く規模ではない。
- **ログだけ残して失敗を握る書き方ができるようになった (Phase 3)。** `logDomainError`・`logQueryError` を
  公開したためである。使ってよいのは、失敗しても画面を開くと決めた loader (ダッシュボード) だけで、
  応答を返す・投げる場面では 2 本のグルーを使うこと。ログは残るので、握ったことは後から追える。
- **残すだけでは、偵察は見つからない。** `warn` を自動で知らせる仕組みは、この ADR では作らない。
  また Workers Logs の保存期間は無料プランで 3 日、有料プランで 7 日であり、
  それより長い期間の傾向を見るには別の保存先が要る。どちらも必要になったときに決める。

## 影響範囲

| 層                    | 変更                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/domain/`         | `ErrorKind` を追加。各ドメインに `*ErrorKind` の表と `*Field` を追加。列挙子を改名。`ReservationError` を `BaseError` 継承に直し、`FacilityErrorCode.DataBaseError` の綴りを直す                                                       |
| `app/usecases/`       | 利用者向けの文言を `userMessage` へ移す。`ensureGroupIsVisible` が `NotVisible`、`getInvitationUseCase` が宛先違いに `InvitationNotVisible` を返す。`get-group-management.ts` が再定義している `toGroupDatabaseError` を共有版に寄せる |
| `app/infra/`          | 英語の文言を日本語に揃える。`facility-availability-calendar-query.ts` が書いている利用者向け文言を表へ移す                                                                                                                             |
| `app/routes/_shared/` | 新設。ドメインごとの表と、グルー 2 本 (と、失敗しても画面を開く loader のためのログだけの関数)                                                                                                                                         |
| `app/routes/`         | 各ルートのエラー分岐をグルー呼び出しに置き換え (想定内の差し戻しもログに残るようになる)。画面ごとの `field` の表を置く。事務局の予約画面で自前に書いていた事務局の確認を外す                                                           |
| `app/lib/`            | `group-error-message.ts` を削除。`log.server.ts` をレベルとオブジェクト形式に対応させ、`logServerError` を削除                                                                                                                         |
| `app/routes.ts`       | 規約コメントに `routes/_shared/` を追加                                                                                                                                                                                                |
| `AGENTS.md`           | 5 章にエラーの決まりを一段追加                                                                                                                                                                                                         |

DB マイグレーションは発生しない。

## 適用の順序

| 段階    | 内容                                                                                                                                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 0 | 設計変更に依存しない後始末。ログ漏れ 3 か所、`toGroupDatabaseError` の重複、`DataBaseError` の綴り、`ReservationError` の `BaseError` 継承                                                                                                                                                                                 |
| Phase 1 | group ドメインで縦に 1 本通す (決定 1〜7・9)。`lib/group-error-message.ts` と `$groupId/action-error.ts` が消える。移行の済んでいないルートのために `logServerError` を残す                                                                                                                                                |
| Phase 2 | reservation へ展開。コンテキストの 3 と `default:` の握りつぶしが解消する。予約詳細 (SCR-005) の loader が DB の失敗をログに残さず 500 を返していた件も、グルーに置き換えて解消する                                                                                                                                        |
| Phase 3 | invitation / facility / user / query。固定文字列を表へ寄せる。`logServerError` を消す。招待の承諾画面 (SCR-016) は招待が URL の指すものなので、団体の表 (`InvitationNotFound` を 409) とは別の表を持つ。空き状況 (SCR-001) の loader が失敗をまったくログに残さずに 404 / 500 を返していた件も、グルーに置き換えて解消する |
| Phase 4 | この ADR を承認に更新し、`AGENTS.md` に反映                                                                                                                                                                                                                                                                                |

Phase 1 だけやや大きいが、group で形が決まらないと Phase 2 以降の差分をレビューできないため分割しない。

## 適用範囲

この ADR はエラーの分類と、利用者に見せる文言への変換についてのみ述べる。

COND-001 (承認済み予約の重なり) の判定が `infra/reservation/reservation-repo.ts` の中で
`noApprovedOverlap` と `existsApprovedOverlap` に二重に書かれている件は、
エラーの扱いとは独立しているため、この ADR では扱わない。
なお、ユースケース側の事前確認と UPDATE 側の条件は**意図的な二段構え**であり
(D1 では確認と書き込みを 1 つのトランザクションに入れられない)、どちらも残すこと。

メール配送 (`usecases/mail/flush-mail-outbox.server.ts` など) のログも扱わない。
利用者の操作ではなく cron と Queue から動くので `userId` が無く、決定 9 の形に載らない。
エラーも画面に届かない (決定 3 で `kind` を付けないとしたもの) ため、文字列の `console.error` のままである。

ADR-001 の層構成、ADR-002 のメール配送、ADR-003 の団体テーブルは変更しない。
