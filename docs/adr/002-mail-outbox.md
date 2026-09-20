# ADR-002: 通知メールを Transactional Outbox で確実に届ける

## ステータス

承認

## コンテキスト

現在、メールの送信はログイン時の認証コード (OTP) の 1 か所だけで、リクエストの中で同期的に送っている。

```text
app/lib/auth/auth.server.ts   sendVerificationOTP コールバック
  └ usecases/mail/send-verification-otp.server.ts   文面を組み立てる
      └ usecases/mail/send-email.server.ts          入力を検証して MailSender に渡す
          └ domain/mail/mail-sender.ts              ポート
              └ infra/mail/smtp-mail-sender.server.ts   Oracle Email Delivery へ SMTP
```

PRD 5 章「通知 (メール) 設計」には、これから実装する通知が 11 種類並んでいる。
このうち認証コード (EVT-013) と招待 (EVT-014) を除く 9 種類は、
「申請者・団体管理者全員・事務局」のように**1 つのイベントで複数の宛先へ送る**。
仮予約申請 (EVT-001) 1 件で 8 通前後になる。

今の同期送信をそのまま横展開すると、3 つの問題が出る。

1. **失敗した通知が消える。** SMTP は一過性の失敗 (接続断・レート超過・相手側の一時エラー) を
   普通に返す。今は失敗してもログが残るだけで、再送する仕組みが無い。
   「承認したのに団体に通知が届かない」がそのまま起きる。
2. **レスポンスが SMTP に引きずられる。** 1 通ごとに接続 → TLS → 認証 → 送信 → 切断を行うため、
   8 通で数秒かかる。承認ボタンを押した事務局がその間待たされ、
   しかも 8 通目で失敗すると「承認は成功・通知は一部だけ」という中途半端な状態になる。
3. **業務データと通知が食い違う。** 「予約を承認する」と「通知を送る」を順に実行する限り、
   承認だけ成功して通知が飛ばない状態を**検出する手段が無い**。

3 番目は、送信手段を Queue や Pub/Sub に替えても解けない。
DB への書き込みとキューへの投入という、**2 つの外部システムへの書き込みを跨ぐ問題**
(dual write) だからである。

```text
予約を承認 → キューへ投入   … 投入が失敗したら通知は永久に飛ばない
キューへ投入 → 予約を承認   … 承認が失敗したら、承認されていない予約の通知が飛ぶ
```

どちらの順でも穴が開く。つまり「確実に送る」の芯はキューの側ではなく、
**送信の意図を業務データと同じトランザクションで残せるか**にある。

### 前提の確認

設計の前に、この構成で動かせる範囲を確認した。

- **D1 に interactive transaction は無い。** `BEGIN` … `COMMIT` の間にアプリのコードを挟めない。
  代わりに `db.batch([...])` が暗黙のトランザクションとして atomic に実行される。
  複数の書き込みを不可分にする手段はこれだけである。
- **Cloudflare Queues は無料プランでも使える。** 10,000 operations/日・メッセージ保持 24 時間。
  有料は 100 万 operations/月 + 保持 14 日。配送保証は at-least-once。
- **Cron Triggers の最小間隔は 1 分。**
- **OCI Email Delivery (有料テナンシー) は 18,000 通/分・50,000 通/日。**
  この規模では送信レート自体がボトルネックになることはない。
  ただし `421 Too many connections` は接続の張り方次第で起きる。
- **OCI は 4xx を一過性、5xx を恒久として返す。** 抑制リスト (ハードバウンスと苦情で自動登録される)
  に入った宛先には `254 4.7.1 Suppression for user ...` が返り、
  **何度再送しても永久に届かない**。

## 決定

**Transactional Outbox を D1 に置き、業務データの書き込みと同じ `db.batch()` で送信予定を残す。
配送は Cloudflare Queues が即時に行い、取りこぼしは Cron Trigger が毎分回収する。**

### 1. 全体像

```text
[action] 予約を承認する
   │
   ├─ db.batch([ 予約の UPDATE, mail_outbox への INSERT × 宛先数 ])   ← ここだけが唯一の真実
   │
   └─ waitUntil(env.MAIL_QUEUE.send({ outboxIds }))                  ← 失敗してよい (ただの近道)

[queue consumer]  outbox を読む → 送信済みなら捨てる → SMTP 送信 → sent に更新
                                                    → 失敗なら next_attempt_at を先送り

[cron 毎分]  status='pending' かつ next_attempt_at <= now を拾って送る
             + status='sending' のまま放置された行を pending に戻す
```

**キューへの投入の成否を、業務処理の成否に結びつけない。**
投入が失敗しても outbox 行は残っているので、遅くとも 1 分後に cron が拾う。
Queues は「1 分待たずに送るための近道」でしかなく、信頼性はすべて outbox 側が担う。
ここを取り違えると、Queues の障害がそのまま通知の消失になる。

### 2. `mail_outbox` テーブル

`app/db/schema/mail.ts` を新設する (`auth.ts` は自動生成なので触らない)。

```ts
import { createId } from "@paralleldrive/cuid2";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { MailOutboxStatus } from "~/domain/mail/mail-outbox";

export const mailOutboxTable = sqliteTable(
  "mail_outbox",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),

    /** 同じメールを二度積まないための鍵。詳細は MailDraft の JSDoc を参照 */
    idempotencyKey: text("idempotency_key").notNull().unique(),

    toAddress: text("to_address").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodyHtml: text("body_html"),

    status: text("status")
      .$type<MailOutboxStatus>()
      .notNull()
      .$default(() => MailOutboxStatus.Pending),

    /** 何回送信を試みたか。backoff の指数と、諦める判断に使う */
    attemptCount: integer("attempt_count").notNull().default(0),

    /** 次に送ってよい時刻。積んだ直後は「今すぐ」 */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    /** 直近の失敗。調査用にそのまま残す */
    lastError: text("last_error"),

    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),

    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  // cron が毎分投げるクエリの WHERE 句そのもの。行が増えても全表走査にしない
  (table) => [index("mail_outbox_due_idx").on(table.status, table.nextAttemptAt)],
);
```

列の設計で決めたこと。

- **本文はレンダリング済みで持つ。** 「イベント種別 + payload」ではなく、
  件名と本文を文字列として保存する。送信時に DB を読み直さずに済み、
  **すでに削除された予約の通知を送ろうとして落ちる**事故が起きない。
  代償は 2 つあり、どちらも受け入れる。
  (a) 文面を直しても、積まれたままのメールには反映されない。
  (b) 宛先と本文が D1 に残る。`sent` の行は一定期間で消すことを想定する (Phase 3)。
- **差出人 (`from`) は持たない。** `getMailFrom()` が環境変数から解決する。
  差出人アドレスを変えるのにマイグレーションが要らず、
  プレビューと本番で同じ行を別の差出人として送れる。
- **`idempotency_key` に UNIQUE を張る。**
  `reservation:approved:<reservationId>:<userId>` のように、
  **イベントと宛先から決まる**文字列を入れる。
  同じ操作が二度走っても 2 通目は INSERT で弾かれる。
- **`(status, next_attempt_at)` に複合インデックス。**
  ADR-001 に書いたとおり、D1 ではクエリ 1 本ごとにネットワーク往復が入る。
  毎分走るクエリには必ずインデックスを用意する。

### 3. 原子性は Repository が引き受ける

D1 に interactive transaction が無い以上、
「業務データの更新」と「outbox への追加」を原子的に書く方法は `db.batch()` しかない。
よって**両方を 1 つの Repository メソッドで受け取る**。

予約の状態遷移は `applyStatusTransition` の 1 メソッドに集約されているので、
新しいメソッドを足さず、ここに第 2 引数を生やす。

```ts
export interface ReservationRepository {
  /**
   * 予約のステータスを条件付きで更新し、同じトランザクションで通知メールを outbox に積む。
   *
   * 2 つの引数を 1 つのメソッドで受けるのは、D1 に interactive transaction が無く、
   * 不可分に書く手段が `db.batch()` しか無いため。分けて呼べる形にすると、
   * 「承認だけ成功して通知が積まれない」窓が必ず開く。
   *
   * メールを積まない遷移 (却下・キャンセルなど) では空配列を渡す。
   */
  applyStatusTransition(
    args: ApplyStatusTransitionArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<boolean, ReservationError>;
}
```

Repository がメールを知るのは一見おかしいが、ここで受け取るのは「送る」ではなく
**「送る予定を同じトランザクションで書く」**である。
`MailDraft` は `app/domain/mail/` の型なので、依存の向きは domain → domain のまま壊れない。

#### 条件付き UPDATE と INSERT を噛み合わせる

ここに落とし穴がある。`applyStatusTransition` の UPDATE は**条件付き**で、
競合時には 0 件しか更新しない。一方 `db.batch()` は**中の文を無条件に全部実行する**。
素直に `batch([update, insert])` と書くと、
**承認に失敗したのに「承認されました」メールが積まれる。**

そこで outbox への INSERT は `INSERT ... SELECT ... FROM reservation WHERE ...` の形にし、
**直前の UPDATE が書いた行が存在するときだけ 1 行入る**ようにする。
同じ batch の中なので、WHERE では**更新後**の `status` と `updated_at` を突き合わせる。

```sql
INSERT INTO mail_outbox (id, idempotency_key, to_address, to_name, subject, body_text, body_html,
                         status, attempt_count, next_attempt_at, last_error, created_at, updated_at)
SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, null, ?, ?
  FROM reservation
 WHERE id = ? AND status = ? AND updated_at = ?   -- UPDATE で書いた値
ON CONFLICT (idempotency_key) DO NOTHING
```

`ON CONFLICT DO NOTHING` は必須。`idempotency_key` は UNIQUE なので、
これが無いと重複時に**batch 全体がロールバックされて承認まで巻き戻る**。

更新できたかの判定は、今までどおり UPDATE の `RETURNING` の行数
(`db.batch()` の結果の 0 番目) で行う。
`mails` が空のときは `db.batch()` を使わず UPDATE 単体で実行する
(Drizzle の `batch` は空配列を受け付けない)。

usecase の責務は変わらない。認可を確かめ、宛先を集め、`MailDraft[]` を組み立てて Repository に渡す。
**宛先の展開は積む時点で行う** (送信時ではない)。
「イベントが起きた時点の団体管理者」に送るのが正しい意味論であり、
承認の 3 日後に管理者が交代しても、承認通知の宛先は変わらないため。

### 4. リトライは `next_attempt_at` に一本化する

Queues にも再試行機構 (`message.retry()` と DLQ) があるが、
**SMTP の失敗に対しては使わない**。
リトライの方針が outbox と Queues の 2 か所に分かれると、
実際の再送間隔がどちらで決まるのか誰にも追えなくなるため。

| 事象                  | consumer の振る舞い                                                                 |
| --------------------- | ----------------------------------------------------------------------------------- |
| 送信成功              | `status='sent'` にして `ack()`                                                      |
| 一過性の失敗          | `attempt_count` を増やし `next_attempt_at` を先送りして `ack()`。以後は cron が拾う |
| 恒久的な失敗          | `status='dead'` にして `ack()`。再送しない                                          |
| consumer 自体が落ちた | ack されないので Queues が再配信する。outbox 側が `sent` を見て二重送信を防ぐ       |

Queues のリトライ (`max_retries: 3`) は
**「consumer のバグや Worker の異常終了に対する保険」としてだけ**効かせる。
DLQ は置かない。`status='dead'` の行が DLQ の役目を果たし、
再送も調査も D1 の 1 テーブルで完結する
(Queues のメッセージ保持は無料プランで 24 時間しかなく、
調査の拠り所にはできないという事情もある)。

backoff は `next_attempt_at = now + min(30 秒 × 2^attempt_count, 1 時間)`。
`attempt_count` が 5 を超えたら `dead` にする。
30 秒 → 1 分 → 2 分 → 4 分 → 8 分と延びるので、
OCI 側の一時的な不調はこの範囲でほぼ吸収できる。

### 5. SMTP のエラーは応答コードで分類する

再試行してよいかは、OCI が返す応答コードで決まる。

| コード                          | 意味                         | 扱い                                    |
| ------------------------------- | ---------------------------- | --------------------------------------- |
| `254`                           | 宛先が抑制リストに載っている | **`dead`**。再送しても永久に届かない    |
| `421`                           | 接続過多 / 認証失敗の多発    | 再試行                                  |
| `455`                           | 分・日の送信上限を超えた     | 再試行 (backoff を長めに)               |
| その他の 4xx                    | 一過性                       | 再試行                                  |
| `535`                           | SMTP の認証情報が誤っている  | **`dead`** + 運用に通知。再送しても無駄 |
| その他の 5xx                    | 恒久的な拒否                 | **`dead`**                              |
| 応答なし (接続断・タイムアウト) | 送れたか不明                 | 再試行 (重複を許容する。後述)           |

worker-mailer は種類ごとの例外クラスを持たず、
`Failed to send DATA: 455 Maximum messages sent per minute reached` のように
**サーバーの応答をそのまま例外メッセージに載せる**。
したがって、メッセージから 3 桁の応答コードを抜き出して分類する。

現在の `toMailSendError` は `/auth/i` や `/connect|socket|timeout|prohibited/i` という
**語**で判定しているが、これは件名や宛先に同じ語が混ざると誤判定する。
応答コードを一次情報にし、コードが取れなかったときだけ語による判定に落とす。

判定そのものは `app/infra/mail/smtp-error.ts` に `classifySmtpError` という純粋関数として置く。
**3 桁の応答コードは SMTP という送信手段そのものの都合**であり、ドメインの語彙ではないため infra に置く。
`smtp-mail-sender.server.ts` に直接書かず別ファイルに切り出すのは、
このファイルが `cloudflare:sockets` を読むため
**vitest から import できず、分類の表をテストで固定できない**ためである。

`MailSendError` には `RateLimited` (再試行すべき) と `Rejected` (恒久的な拒否) を足す。
型は他のドメインと同じく `MailSendErrorCode` を `as const` で定義し、
`BaseError` を継承した `{ code, message, cause? }` の形にそろえる。

再試行の可否を判定する `isRetryable` は `domain/mail/mail-sender.ts` に置く。
**どの層でも同じ基準で判定できるようにする**のが目的で、
ここを infra に置くと consumer が SMTP の都合を知ることになる。
逆に言えば、送信側は SMTP の応答コードを `MailSendErrorCode` へ正規化するところまでが責務で、
**その先の「再送するか」の判断はドメインの側にある**。

### 6. 重複は許容し、同じメールだと分かるようにする

SMTP は `DATA` の後の `250` を受け取る前にタイムアウトすると、
**送れたのか送れていないのか原理的に分からない**。
ここで送らない側に倒すと通知が消えるので、送る側に倒す。
つまり配送保証は Queues と同じ **at-least-once** で、まれな重複は受け入れる。

そのうえで、`Message-ID` を outbox の行 ID から決定的に生成する。

```ts
headers: { "Message-ID": `<${entry.id}@gdgoc-osaka.jp>` }
```

worker-mailer は `Message-ID` が指定されていなければ `crypto.randomUUID()` で作るため、
**指定しないと再送のたびに別のメールとして扱われる**。
指定しておけば受信側のクライアントで同一メールとして畳まれる可能性があり、
少なくとも調査時に「これは同じ 1 通の再送」と断定できる。

この方針が成り立つのは、通知の文面が**何度届いても害が無い**内容だからである。
「承認されました」が 2 通届いても誤解は生まれない。
将来この前提を崩す通知を足すときは、この節に立ち返ること。

### 7. 認証コード (OTP) は同期送信のまま残す

認証コードは cron の 1 分も、キューの数秒も待てない。リクエストの中で送り切る今の形を維持する。

ただし現状には別の穴がある。`sendVerificationOTP` は Better Auth がバックグラウンドで実行するため、
**送信に失敗しても HTTP は 200 のまま**で、画面には「コードを送りました」と表示される。
ユーザーは来ないコードを待ち続ける。あわせて次のようにする。

- 一過性のエラー (`421` / `455` / 接続断) のときは、同じリクエストの中で最大 2 回まで即座に再試行する
- それでも失敗したらエラーを投げ、画面に「送信できなかった」と表示する
- 成否にかかわらず `mail_outbox` に 1 行残す。ただし `sent` か `dead` の**終端状態で INSERT** し、
  cron の対象にはしない。目的は再送ではなく「本当に送ったのか」を後から追えるようにすること

### 8. 層の割り当て

```text
app/domain/mail/
  mail-outbox.ts                  ★ MailDraft / MailOutboxEntry / MailOutbox ポート / 状態
  reservation-mail.ts             ★ 承認通知の MailDraft を組み立てる純粋関数
  mail-sender.ts                    既存。MailSendErrorCode に RateLimited と Rejected、isRetryable を足す
  mail-message.ts                   既存。Message-ID を渡すため headers を足す (決定 6)
app/db/schema/
  mail.ts                         ★ mailOutboxTable (index.ts から再 export する)
app/query/reservation/
  reservation-mail-recipients.ts  ★ 申請者 + 団体管理者のメールアドレスを引く
app/infra/mail/
  d1-mail-outbox.ts               ★ MailOutbox の実装。この機能の SQL はここにだけ書く
  smtp-error.ts                   ★ classifySmtpError。応答コードによる分類 (決定 5)
  smtp-mail-sender.server.ts        既存。classifySmtpError を呼び、Message-ID を付ける
app/infra/reservation/
  reservation-mail-recipients-query.ts ★ 上の query の実装
  reservation-repo.ts               既存。applyStatusTransition に mails を足す (決定 3)
app/usecases/mail/
  flush-mail-outbox.server.ts     ★ 送信待ちを取り出して送る
app/usecases/reservation/
  change-reservation-status.ts      既存。承認時に宛先を集めて MailDraft[] を組み立てる
app/domain/reservation/index.ts     既存。ReservationRepository の型を変える
workers/app.ts                    ★ scheduled ハンドラを足す (queue は Phase 2)
```

宛先を引く query が無いので新しく作る。EVT-005 の宛先は
**申請者 + その団体の管理者全員** (`docs/prd.md` 5 章)。
`reservation.created_by` は `null` を取りうるので、その場合は申請者を宛先から落とす。
同じ人が申請者と管理者を兼ねていることがあるため、**メールアドレスで重複を除く**。

ADR-001 と同じく、**ポートは domain、SQL は infra、組み立ては usecase** の形を崩さない。
新しく覚える概念は「outbox に積む」の 1 つだけになる。

プレビュー環境では `createMailSender()` が Discord を返すため、
`scheduled` からの送信も (Phase 2 の consumer も) そのまま Discord に流れる。
ここに手を入れる必要は無い。

### 9. wrangler.jsonc

`queues` は `vars` や `d1_databases` と同じく**環境に継承されない**。
トップレベル・`env.production`・`env.preview` の**3 か所すべて**に書くこと。
一方 `triggers` は**継承される**ので、トップレベルに 1 度書けばよい。

```jsonc
// トップレベル (ローカル開発用)。production / preview には queues だけ同じ形で再掲する
"triggers": {
  // 最小間隔は 1 分。これが通知の最大遅延になる
  "crons": ["* * * * *"],
},
"queues": {
  "producers": [{ "queue": "iclub-reserve-mail-preview", "binding": "MAIL_QUEUE" }],
  "consumers": [
    {
      "queue": "iclub-reserve-mail-preview",
      "max_batch_size": 10,
      "max_batch_timeout": 5,
      // SMTP の失敗はここでは再試行しない (決定 4)。consumer が落ちた場合の保険
      "max_retries": 3,
      // OCI の 421 Too many connections を避けるため、同時に開く接続を絞る
      "max_concurrency": 2,
    },
  ],
},
```

キュー名は環境ごとに分ける (`iclub-reserve-mail` / `iclub-reserve-mail-preview`)。
ローカル開発では Queues はローカルでシミュレートされ、リモートのキューには触れない。

**Phase 1 で足すのは `triggers` だけ**で、`queues` は Phase 2 に入ってから足す。

## 理由

検討した選択肢は 5 つ。

### 案 A: 同期送信のまま横展開する (却下)

新しい概念が要らず、今日書けるのが唯一の利点。
しかしコンテキストに挙げた 3 つの問題がすべて残る。
とくに「承認は成功・通知は 8 通中 3 通だけ成功」という状態を
**誰も検出できない**のが致命的で、PRD の GOAL-003 (申請・承認の通知を自動化し手間を削減する) が
「通知が来ないので結局電話で確認する」に退化する。

### 案 B: `waitUntil` で投げっぱなしにする (却下)

レスポンスは速くなり、変更も小さい。
だが `waitUntil` は**失敗しても誰にも伝わらず、再試行もされない**。
Worker が異常終了すれば送信中のものは消える。
レスポンスの速さという 2 番目の問題だけを解き、1 番目と 3 番目には触れていない。

### 案 C: Outbox + Cron のみ (部分的に採用)

Queues を使わず、`db.batch()` で積んで cron だけで送る。
D1 だけで完結し、バインディングが増えず、動きが一直線で読みやすい。
唯一の弱点は**最大 1 分の遅延**で、仮予約申請の通知が 1 分遅れることの実害は小さい。

これは案 D の真部分集合なので、**Phase 1 として必ず通過する**。
つまり Queues が使えない・使いたくない状況になっても、この時点で「確実に送る」は達成されている。

### 案 D: Outbox + Queues + Cron (採用)

案 C に「積んだ直後にキューへ投げる」近道を足したもの。

- **遅延が秒オーダーになる。** メッセージ通知 (EVT-008) のように
  会話のテンポに関わるものが 1 分遅れないで済む。
- **信頼性の担保は案 C と同一。** キューが落ちても cron が拾うので、
  Queues の可用性がそのままシステムの可用性にならない。
- **足すコードが小さい。** producer 側は `waitUntil` が 1 行、
  consumer 側は cron と同じ usecase を呼ぶだけ。**送信処理は 1 本しか存在しない。**
- **毎分の空ポーリングが減る。** 通知が無い時間帯でも cron は走るが、
  実際の送信はキュー経由で先に終わっている。

### 案 E: Cloudflare Workflows (却下)

ステップ単位で永続化され、リトライと待機が標準で備わる。
「宛先ごとの送信を 1 ステップにする」と素直に書ける。

しかし、

- **dual write 問題は解けない。** インスタンスの生成も外部への書き込みなので、
  結局 outbox か同等の仕組みが要る。**足すのではなく置き換える**選択肢になっていない。
- メール 1 通に対して状態機械は重い。無料プランではステップあたり CPU 10 ms・同時 100 インスタンス。
- チームにとって新しい概念が 2 つ (Workflows と Outbox) 同時に増える。

Google Calendar 連携のような**多段で外部 API を叩く処理**が出てきたときに、
改めて検討する価値はある。今回は見送る。

## トレードオフ

| 犠牲・リスク                                   | 対策                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Repository が `MailDraft[]` を受け取る形に歪む | D1 に interactive transaction が無い以上、原子性を得る唯一の手段。JSDoc に理由を明記し、他の回避策を取らせない   |
| 同じメールが二重に届くことがある               | at-least-once として明示的に受け入れる (決定 6)。`Message-ID` を行 ID から作り、同一メールと判別できるようにする |
| 通知の文面と宛先が D1 に平文で残る             | `sent` の行は一定期間で削除する (Phase 3)。もともと当人に送った内容であり、新たな情報は増えない                  |
| 文面を直しても未送信のメールには反映されない   | 想定どおりの挙動として受け入れる。積んだ時点の文面で送るほうが、後から読み返したときに再現できる                 |
| cron が毎分走る (月 43,200 回)                 | 無料枠 (10 万リクエスト/日) の範囲内。送信が無ければクエリ 1 本で終わる                                          |
| 状態が 4 つに増え、追うべきものが増える        | 状態は `mail_outbox` の 1 テーブルに閉じる。DLQ を置かず、調査先を 1 か所に保つ                                  |
| ローカルで cron と queue が自動で走らない      | `scheduled` は usecase を呼ぶだけにし、同じ usecase を開発専用ルートから叩けるようにする (実装ガイド参照)        |
| 1 通ごとに SMTP 接続を張り直す                 | 有料テナンシーのレートに対して十分小さい。遅延が問題になったら `sendMany` を足して接続を使い回す (Phase 3)       |

## 実装ガイド

### 1. ポートと型 — `app/domain/mail/mail-outbox.ts`

```ts
import type { ResultAsync } from "neverthrow";
import type { BaseError } from "~/domain/error";
import type { MailSendError } from "./mail-sender";

/** outbox の行がとりうる状態 */
export const MailOutboxStatus = {
  /** 送信待ち。next_attempt_at を過ぎたら送ってよい */
  Pending: "pending",
  /** 取り出し済み。誰かが今まさに送っている */
  Sending: "sending",
  /** 送信済み。終端 */
  Sent: "sent",
  /** 諦めた。終端。再送するなら手動で pending に戻す */
  Dead: "dead",
} as const;
export type MailOutboxStatus = (typeof MailOutboxStatus)[keyof typeof MailOutboxStatus];

/**
 * これから送るメール 1 通。業務処理の中で組み立て、業務データと同じ batch で積む。
 *
 * 差出人 (from) は持たない。送信時に環境変数から解決するため、
 * 差出人を変えても積まれたままのメールに影響しない。
 */
export interface MailDraft {
  /**
   * 同じメールを二度積まないための鍵。
   * 「イベント種別 : 対象の ID : 宛先」から決まる文字列にすること。
   * 例: "reservation:approved:clx0123:cly4567"
   *
   * ここに時刻や乱数を混ぜてはいけない。混ぜた瞬間に UNIQUE が意味を失い、
   * 操作をやり直しただけで同じ通知が 2 通飛ぶ。
   */
  readonly idempotencyKey: string;
  readonly to: { readonly address: string; readonly name?: string };
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/** outbox から取り出した、送信権を握っているメール 1 通 */
export interface MailOutboxEntry extends MailDraft {
  readonly id: string;
  /** 何回目の送信か (この取り出しを含む) */
  readonly attemptCount: number;
}

export const MailOutboxErrorCode = {
  DatabaseError: "DATABASE_ERROR",
} as const;
export type MailOutboxErrorCode = (typeof MailOutboxErrorCode)[keyof typeof MailOutboxErrorCode];

export interface MailOutboxError extends BaseError {
  readonly code: MailOutboxErrorCode;
}

export interface MailOutbox {
  /**
   * 送信待ちの行を取り出し、同時に status を 'sending' にする。
   *
   * UPDATE … RETURNING の 1 文で行うため、cron と queue consumer が同時に走っても
   * 同じ行を 2 回取り出すことはない。
   */
  claimDue(args: {
    readonly limit: number;
    readonly now: Date;
  }): ResultAsync<readonly MailOutboxEntry[], MailOutboxError>;

  /*
   * NOTE: id を指定して取り出す claimByIds は **Phase 2 で足す**。
   * Queues 経由の即時配送でしか使わないので、Phase 1 では書かない。
   *
   *   claimByIds(args: {
   *     readonly ids: readonly string[];
   *     readonly now: Date;
   *   }): ResultAsync<readonly MailOutboxEntry[], MailOutboxError>;
   */

  markSent(id: string): ResultAsync<void, MailOutboxError>;

  /**
   * 一過性の失敗。next_attempt_at を先送りして 'pending' に戻す。
   *
   * 次にいつ送るかは**呼ぶ側が決めて渡す**。backoff は再送の方針そのものなので
   * usecase の持ち物であり、infra に既定値を置くと同じ規則が 2 か所に増える。
   */
  markRetryable(args: {
    readonly id: string;
    readonly error: MailSendError;
    readonly nextAttemptAt: Date;
  }): ResultAsync<void, MailOutboxError>;

  /** 恒久的な失敗。'dead' にして以後は送らない */
  markDead(args: {
    readonly id: string;
    readonly error: MailSendError;
  }): ResultAsync<void, MailOutboxError>;
}
```

### 2. 取り出し — `app/infra/mail/d1-mail-outbox.ts` の要点

取り出しは **1 文の UPDATE … RETURNING** で行う。
`SELECT` してから `UPDATE` すると、cron と consumer が同じ行を二重に掴む。
ADR-001 の `noApprovedOverlap` と同じ考え方で、**競合の判定を SQL の側に寄せる**。

```ts
/** 送信中のまま放置されたとみなすまでの時間。Worker が途中で落ちた行を救う */
const STUCK_AFTER_MS = 5 * 60 * 1000;

const claimDue = ({ limit, now }: { limit: number; now: Date }) =>
  ResultAsync.fromPromise(
    db
      .update(mailOutboxTable)
      .set({
        status: MailOutboxStatus.Sending,
        attemptCount: sql`${mailOutboxTable.attemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        inArray(
          mailOutboxTable.id,
          db
            .select({ id: mailOutboxTable.id })
            .from(mailOutboxTable)
            .where(
              or(
                // 送信時刻が来たもの
                and(
                  eq(mailOutboxTable.status, MailOutboxStatus.Pending),
                  lte(mailOutboxTable.nextAttemptAt, now),
                ),
                // 掴まれたまま放置されたもの (Worker の異常終了で取り残された行)
                and(
                  eq(mailOutboxTable.status, MailOutboxStatus.Sending),
                  lte(mailOutboxTable.updatedAt, new Date(now.getTime() - STUCK_AFTER_MS)),
                ),
              ),
            )
            .orderBy(asc(mailOutboxTable.nextAttemptAt))
            .limit(limit),
        ),
      )
      .returning(),
    toMailOutboxError,
  ).map((rows) => rows.map(toMailOutboxEntry));
```

放置された行を拾い直すと、**SMTP が受理した直後に落ちた場合は重複が発生する**。
決定 6 のとおり、これは許容する。逆にこの回収をしないと、
Worker が一度落ちただけで行が永久に `sending` のまま残り、通知が消える。

### 3. 送信 — `app/usecases/mail/flush-mail-outbox.server.ts`

cron も queue consumer もこの usecase を呼ぶ。**送信処理はこの 1 本だけにする。**

```ts
export interface FlushMailOutboxDeps {
  readonly mailOutbox: MailOutbox;
  readonly mailSender: MailSender;
  readonly from: { readonly address: string; readonly name?: string };
}

/** 1 回の実行で送る上限。Queues の max_batch_size と揃えておく */
export const FLUSH_LIMIT = 10;

/** 何回失敗したら諦めるか */
export const MAX_ATTEMPTS = 5;

/** 次に送ってよい時刻までの待ち時間。30 秒から始めて倍々、上限 1 時間 */
export const nextAttemptDelayMs = (attemptCount: number): number =>
  Math.min(30_000 * 2 ** (attemptCount - 1), 60 * 60 * 1000);
```

1 件ごとの流れは次のとおり。

1. `createMailMessage` で `from` を補って `MailMessage` を組み立てる
   (ここで失敗するのはプログラムの誤りなので `dead` にする)
2. `mailSender.send(message)` を呼ぶ
3. 成功 → `markSent`
4. 失敗かつ `isRetryable(error)` かつ `attemptCount < MAX_ATTEMPTS` → `markRetryable`
5. それ以外 → `markDead`

**1 通の失敗で残りを止めない。** 1 件ずつ独立に結果を書き、最後にまとめて件数をログに出す。

### 4. ハンドラ — `workers/app.ts`

下は Phase 2 まで入れた最終形。**Phase 1 で足すのは `scheduled` だけ**で、
`queue` と `MailQueueMessage` は Queues を入れるときに足す。

```ts
import { createRequestHandler } from "react-router";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Queues に載せるメッセージ。行そのものではなく ID だけを運ぶ */
export type MailQueueMessage = { readonly outboxIds: readonly string[] };

export default {
  async fetch(request) {
    return requestHandler(request);
  },

  /** 毎分の取りこぼし回収。キュー経由で送れなかったものと、再試行待ちのものを拾う */
  async scheduled() {
    await flushMailOutbox();
  },

  /**
   * 積んだ直後の即時配送。
   *
   * SMTP の失敗はここでは再試行せず (outbox の next_attempt_at に一本化する)、
   * かならず ack する。ack しないのは、この関数自体が例外で落ちたときだけでよい。
   */
  async queue(batch) {
    const outboxIds = batch.messages.flatMap((message) => message.body.outboxIds);
    await flushMailOutbox(outboxIds);
    batch.ackAll();
  },
} satisfies ExportedHandler<Env, MailQueueMessage>;
```

producer 側 (action) は `cloudflare:workers` の `waitUntil` を使う。
Workers では await しないまま放置した Promise はレスポンス後に打ち切られるため、
**`waitUntil` に渡さないと投入自体が握りつぶされることがある**。

```ts
import { env, waitUntil } from "cloudflare:workers";

// 予約の更新と outbox への追加が成功したあとで呼ぶ。
// ここが失敗しても通知は消えない (cron が拾う) ので、エラーは握りつぶしてよい。
waitUntil(env.MAIL_QUEUE.send({ outboxIds }).catch(() => {}));
```

### 5. ローカルでの確かめ方

`react-router dev` では cron も queue も自動では走らない。
`scheduled` を「usecase を呼ぶだけ」にしてあるので、
同じ usecase を開発専用ルートから叩けるようにしておく。

```ts
// app/routes/dev/flush-mail.tsx など。APP_ENV が local のときだけ有効にすること
export const action = async () => {
  if (env.APP_ENV !== "local") throw new Response(null, { status: 404 });
  // flushMailOutbox() を呼ぶ
};
```

本番とプレビューで 404 を返すのは必須。ここが開いていると、
外部から送信処理を好きなだけ起動できてしまう。

## Cloudflare / OCI での注意

- **`db.batch()` は 1 往復で atomic。** 予約の UPDATE と 8 通分の INSERT を 1 つの配列に入れる。
  ループで個別に await すると、原子性も往復回数も失う。
- **`queues` は環境に継承されない。** トップレベル・production・preview の 3 か所に書く。
  `wrangler types` は `--env` 無しで走るので、
  トップレベルに書き忘れると `Env` に `MAIL_QUEUE` が現れない (`vars` と同じ罠)。
- **`triggers` は継承される。** トップレベルに 1 度書けばよい。
  結果としてプレビューでも毎分 cron が走るが、送信先は Discord なので実害は無い。
- **Queues のメッセージには行 ID だけを載せる。** 本文を載せると 128 KB の上限に近づき、
  「キューの中身」と「DB の中身」という 2 つの真実ができる。
- **`max_concurrency` を絞る。** OCI の `421 Too many connections` を避けるため。
  現状は 1 通ごとに接続を張り直すので、同時実行数がそのまま同時接続数になる。
- **`Message-ID` を指定しなければ worker-mailer が毎回ランダムに振る。** 再送が別メール扱いになる。
- **抑制リストは手で解除するまで戻らない。** `254` で `dead` になった宛先は、
  OCI コンソールで抑制リストから削除しない限り、何をしても届かない。
  `dead` の行を定期的に見る運用 (Phase 3) とセットで意味を持つ。

## 適用範囲

**この ADR は既存の OTP 送信の作り (同期送信) を変えない。**
決定 7 に書いた再試行とエラー表示だけを足す。

導入は 3 段階に分ける。**Phase 1 の時点で「確実に送る」は達成される**ので、
Phase 2 以降は遅延と運用性の改善であり、急がなくてよい。

1. **Phase 1 — Outbox + Cron (案 C)**
   `mail_outbox` のマイグレーション、`MailOutbox` ポートと D1 実装、
   `flush-mail-outbox` usecase、`scheduled` ハンドラ、
   `ReservationRepository` を `MailDraft[]` を受け取る形に変更。
   最初の通知は承認通知 (EVT-005) 1 本だけで試す。
2. **Phase 2 — Queues を足す (案 D)**
   `queues` バインディングと `queue` ハンドラ、producer 側の `waitUntil`、
   `MailOutbox` への `claimByIds` の追加。
   ドメイン層と usecase のそれ以外は変更しない。
3. **Phase 3 — 運用**
   `dead` の行をプレビューと同じ要領で Discord に通知、
   管理画面からの手動再送、`sent` の行の定期削除、
   遅延が問題になった場合の `MailSender.sendMany` (接続の使い回し) の追加。

新しい通知を足すときの手順は「`MailDraft` を組み立てて Repository に渡す」だけで、
送信・再試行・失敗の記録に手を入れる必要は無い。

## 参考

- [Cloudflare Queues — Pricing](https://developers.cloudflare.com/queues/platform/pricing/) / [Limits](https://developers.cloudflare.com/queues/platform/limits/) / [Configure Queues](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Cloudflare Wrangler — Configuration (継承されるキーの一覧)](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workflows — Limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [OCI Email Delivery — Overview (制限と抑制リスト)](https://docs.oracle.com/en-us/iaas/Content/Email/Concepts/overview.htm)
- [OCI Email Delivery — Troubleshooting (SMTP 応答コードの一覧)](https://docs.oracle.com/en-us/iaas/Content/Email/Concepts/troubleshooting.htm)
