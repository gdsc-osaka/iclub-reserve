# ADR-008: Google Calendar との予定同期を Transactional Outbox で実現する

## ステータス

提案

## コンテキスト

予約システム（iclub-reserve）では、施設・設備ごとに専用の Google カレンダーを用意して一般公開し、承認済み予約を自動的にカレンダーへ登録・更新・削除する要件がある（BIZ-005 / REQ-026〜028）。

Google カレンダーは購読 URL（iCal 形式）を通じて学内外に広く公開されるため、開示する情報は「施設名」と「予約日時」に限定し、団体名や人数・備考などは一切含めない（COND-008 の 3 段目）。

このカレンダー連携を実装するにあたり、以下の課題と制約がある。

1. **Dual Write の問題**:
   予約の承認・キャンセル・日時変更・施設変更などの業務トランザクションと、外部の Google Calendar API への書き込みは不可分（atomic）に行えない。同期呼び出しでカレンダーに書き込もうとすると、Google 側の障害や一時的なレート制限で予約操作そのものが巻き戻るか、あるいは「DB の予約は承認されたがカレンダーに予定が無い」という不整合が恒久化する。
2. **Cloudflare Workers の制約**:
   Google 公式の SDK（`googleapis` や `google-auth-library`）は Node.js 固有のモジュールに依存しており、Cloudflare Workers では動作しない。標準の Web API（`fetch` および `crypto.subtle`）で OAuth 2.0 JWT Bearer 認証と Calendar REST API の呼び出しを自前で実装する必要がある。
3. **リソース上限（Subrequests / D1 / Cron Triggers）**:
   Workers の 1 回の実行（Cron Trigger / Request）におけるサブリクエスト数には上限がある（Free プランで 50 件、Paid プランで 10,000 件）。D1 への問い合わせにも 1 回の実行あたりの上限（Free 50 件、Paid 1,000 件）があり、**D1 の問い合わせはサブリクエストの上限にも数えられる**。毎分の Cron はメールの回収と同じ実行の中で動くため、1 回で扱う同期タスクの量に明確な上限を設ける必要がある。また Cron Trigger の数はアカウント全体で Free 5 個、Paid 250 個までである（2026-10 時点の Cloudflare のドキュメント）。
4. **反映遅延と冪等性の要求**:
   利用者が購読する Google カレンダーや iCal クライアントは、もともと数十分〜数時間のキャッシュや同期間隔を持っており、秒単位の即時反映は求められていない（最大 1 分程度の遅延は実用上完全に許容される）。一方で、予約の変更やキャンセルが連続して行われたり、リトライが走った場合でも、最終的に「DB の最新の予約状態」にカレンダーが正しく収束（自己修復・冪等）しなければならない（COND-024）。

先行する通知メール実装（ADR-002）では、D1 上の `mail_outbox` テーブルと `db.batch()` を組み合わせた Transactional Outbox パターンを採用して高い信頼性を達成している。本設計もこの成功パターンに倣い、カレンダー連携用の Outbox を設計する。

## 決定

**カレンダー同期タスクを D1 の `calendar_sync_task` テーブルに Transactional Outbox として置き、予約や施設の書き込みと同じ `db.batch()` で積む。反映は毎分の Cron Trigger のみが行い、キューや `waitUntil` は使用しない。**

### 1. 全体像

```text
[action] 予約の承認・変更・キャンセル / 施設の名称・カレンダーID変更
   │
   └─ db.batch([ 予約/施設の更新, calendar_sync_task への INSERT ])  ← 不可分の真実

[cron 毎分 (* * * * *)]
   │
   ├─ status='pending' かつ next_attempt_at <= now のタスク（と、processing のまま 5 分以上放置されたタスク）を上限件数（5件）取得
   ├─ reservation_id ごとにタスクを束ね、処理時点の DB の予約・施設状態を取得
   ├─ toDesiredCalendarEvent で「あるべき予定」を判定
   │    ├─ 承認済み＋カレンダーIDあり → upsertEvent（PUT / 404時POST）
   │    ├─ それ以外（キャンセル・仮予約・ID未設定） → deleteEvent（DELETE）
   │    └─ 施設変更時 → 変更前施設のカレンダーからも deleteEvent
   └─ 成功したタスクは DELETE、失敗したタスクは backoff を計算して next_attempt_at を更新（6回失敗で dead）

[日次バッチ (日本時間 4:00)]
   │
   └─ 施設ごとに Google カレンダーの予定一覧を取得し、DB の承認済み予約と突き合わせ
        └─ 登録漏れ・余分な予定・食い違いを発見した予約のタスクを calendar_sync_task に積む
```

### 2. キューも `waitUntil` も使わない理由

メール送信（ADR-002）では、メッセージ送信のテンポを落とさないために Cloudflare Queues による即時配送（近道）を併用した。しかしカレンダー連携では **Queues も `waitUntil` も一切使わず、毎分の Cron のみ** で同期を行う。

- **カレンダー購読の特性**:
  iCal の URL で購読するカレンダーアプリの多くは、数時間おきにしか読み直さない。Google カレンダーに直接追加した人には早く反映されるが、それでも予約の操作から 1 分以内に見たい情報ではない。即時反映の価値は小さい。
- **並行競合の防止**:
  同じ予約に対して短時間に「承認 → 直後に日時変更」などの操作が行われた場合、`waitUntil` やキューで即時実行すると別々の Worker が並行して Google API を叩き、順番の反転や競合が発生しやすい。Cron の 1 箇所でのみ処理すれば、同じ予約へのタスクを「その時点の最新状態」に束ねて 1 回で同期できる。
- **インフラ構成の簡素化**:
  新しい Queue やバインディングを増やさず、Cloudflare リソースの消費を最小限に抑えられる。

### 3. 同期タスクテーブル（`calendar_sync_task`）

`app/db/schema/calendar.ts` に配置する。

```ts
export const calendarSyncTaskTable = sqliteTable(
  "calendar_sync_task",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reservationId: text("reservation_id").notNull(),
    previousFacilityId: text("previous_facility_id"),
    status: text("status")
      .$type<CalendarSyncStatus>()
      .notNull()
      .$default(() => CalendarSyncStatus.Pending),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("calendar_sync_task_due_idx").on(table.status, table.nextAttemptAt)],
);
```

- **ID は自動採番の integer**:
  施設の変更時や日次の突き合わせ時に `INSERT INTO calendar_sync_task (...) SELECT ...` で一括投入するため、SQL 側で採番できる autoIncrement とする。
- **外部キーを張らない**:
  `reservation_id` および `previous_facility_id` には外部キー制約を設けない。日次の突き合わせで「DB 上に存在しない予約の予定がカレンダーに残っていた場合」の掃除タスクを積む可能性があるため。
- **成功行は削除（DELETE）する**:
  メールと異なり、同期は「その時点の最新状態に合わせる」ため、過去の同期履歴を行として保持する意味が無い。テーブル肥大化を防ぐため成功した行は速やかに削除する。
- **`(status, next_attempt_at)` に複合インデックス**:
  毎分の Cron が発行する WHERE 句を全表走査にしないための必須インデックス。

### 4. 予定の ID と目印（extendedProperties）

- **予定 ID（決定論的生成）**:
  Google Calendar の予定 ID には base32hex（小文字 `0-9`, `a-v`）かつ 5〜1024 文字という制約がある（RFC 2938 準拠）。予約 ID（cuid2）は `w-z` を含みうるため、予約 ID の UTF-8 バイト列を 16 進表記（小文字 `0-9`, `a-f`）にし、先頭に `"iclub"`（すべて base32hex 内）を付与した文字列とする：
  `toCalendarEventId(reservationId) = "iclub" + hex(reservationId)`
  これにより、予約テーブルに予定 ID を持たずとも常に同じ ID を導出できる。予定から予約を引くときは、ID を逆変換せず `extendedProperties` の予約 ID を使う（ID と目印の両方が合う予定だけをシステムの予定とみなすため）。
- **環境と予約の目印**:
  Google 側の予定の `extendedProperties.private` に以下を記録する。
  - `iclubReserveReservationId`: 予約 ID
  - `iclubReserveEnv`: `APP_ENV` の値（`local` / `preview` / `production`）
    プレビュー環境と本番環境で同じカレンダー ID が誤って設定された場合でも、日次突き合わせが別環境の予定を「余分な予定」として誤削除することを防ぐ。
    人が手動で登録した予定や複製した予定にはこの目印が無いため、日次突き合わせでも一切手を触れない（COND-024 (4)）。

### 5. Google Calendar クライアントの振る舞い（API 仕様の確認結果に基づく）

公式ドキュメントおよび仕様調査に基づき、以下の振る舞いを実装する。

- **認証**:
  Service Account の秘密鍵（PKCS#8 PEM）を用い、WebCrypto（`crypto.subtle`）で RS256 JWT を署名。OAuth 2.0 JWT Bearer フロー（`https://oauth2.googleapis.com/token`）でアクセストークンを取得。スコープは `https://www.googleapis.com/auth/calendar.events` に絞る。トークンはモジュールスコープに保持し、有効期限の 60 秒前まで使い回す。401 が返った場合はトークンを破棄して 1 回だけ再取得・再試行する。
- **upsertEvent**:
  まず `events.update`（PUT）を `status: "confirmed"` 付きで呼び出す。404 Not Found であれば `events.insert`（POST、ID 指定）を呼び、insert が 409 Conflict を返した場合（同じ ID の予定が先にできていた）は、もう一度 update する。
  削除した予定は `status: "cancelled"` として一定期間残り、その間は同じ ID で insert すると 409 になる（Google のエラーの手引きは、409 のときは update を使うよう案内している）。最初に update から試すのは、削除済みの予定を `status: "confirmed"` で上書きして生き返らせるためである。
  削除済みの予定に update が 200 を返して生き返ることは、公式のドキュメントでは確かめられなかったため、PR 2 で本物のカレンダー（Service Account 自身のカレンダー）に対して「登録 → 更新 → 削除 → 再登録」を流して確かめた（2026-10-08）。結果は次のとおりで、上の手順で足りている。
  - 初回: update（PUT）が 404 → insert（POST、ID 指定）が 200
  - 2 回目: update が 200（タイトル・時刻が変わる）
  - 削除: DELETE が 204。直後に同じ ID を GET すると 200 で `status: "cancelled"` が返り、`listManagedEvents`（`showDeleted=false`）には出てこない
  - もう一度の削除: DELETE が 410（成功として扱う）
  - 削除後の再登録: update が 200 を返し、`status: "confirmed"` に戻って `listManagedEvents` にも出てくる。insert と 409 の経路は通らなかった
  - **完全に消えた後（`cancelled` の行が Google から消えた後）の ID の扱いは確かめられていない。** そのときも update が 404 を返して insert に進む想定で、手順は変わらない。
- **deleteEvent**:
  DELETE を呼び出す。404 Not Found および 410 Gone（すでに削除済み）は成功として扱う。
- **listManagedEvents**:
  `privateExtendedProperty=iclubReserveEnv=<appEnv>`、`timeMin=endAfter`、`singleEvents=true`、`showDeleted=false` でページネーションをたどって全件取得。`iclubReserveReservationId` が欠落している予定、および予定 ID が `toCalendarEventId(reservationId)` と一致しない予定は除外する。
- **checkWriteAccess**:
  `events.list` を `maxResults=1` で呼び出し、レスポンスのルートにある `accessRole` を確認する。`writer` または `owner` であれば `writable`、それ以外（`reader` や `writerWithoutPrivateAccess` など）とレート制限ではない 403 は `not_writable`、404 は `not_found` を返す。`writerWithoutPrivateAccess` を書き込めるとみなさないのは、共有の手順（「予定の変更」の権限）で付くのが `writer` だからで、手順と違う共有を通さないため。確認用のダミー予定を登録・削除しないため、一般公開カレンダーに一瞬でも不要な予定が露出しない。

### 6. リトライと失敗の扱い

- **エラー分類**:
  - 再試行可能（RateLimited / Unavailable）: 403 の特定 reason（`rateLimitExceeded` / `userRateLimitExceeded` / `quotaExceeded` / `dailyLimitExceeded`）、429、5xx、ネットワーク断・タイムアウト。
  - 再試行不可（AuthFailed / Forbidden / NotFound / Rejected）: 認証エラー、権限不足（403 のその他）、カレンダー不在（404）、不正リクエスト。
- **バックオフ**:
  一過性の失敗は `next_attempt_at = now + min(30 秒 × 2^attempt_count, 1 時間)` で先送りする。
  `attempt_count` が 5 回を超えた（6 回目の試行）場合は `status='dead'` に落として処理を中断する。再試行不可のエラーは即座に `status='dead'` とする。
  `dead` の行は手動調査用に残し、最終的な不整合は翌朝の日次突き合わせで修復される。

### 7. 実行量の上限（Workers 制限の遵守）

Free プランの上限（サブリクエスト 50 件。D1 の問い合わせもここに数える）に収まるよう、**1 回の Cron で処理する同期タスクの上限を 5 件（予約 5 件分）** とする。

| 内訳                             | 1 回の Cron あたり                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Google への呼び出し（予約 1 件） | 最悪 4 回（update → insert → update と、変更前の施設のカレンダーからの削除）           |
| Google への呼び出し（5 件）      | 最悪 20 回                                                                             |
| access token の取得              | 最大 1 回（isolate ごとに保持して使い回す）                                            |
| D1 の問い合わせ                  | 6 回前後（取り出し・予約と施設の読み込み・変更前の施設の読み込み・成功と失敗の後始末） |
| 合計                             | 30 回弱                                                                                |

残りの 20 回強を、同じ実行の中で動くメールの回収に残す。毎分 5 件なので 1 時間に 300 件まで反映でき、施設の名称の変更で数十件をまとめて積んでも数分で片付く。Paid プランに移ったら上限を上げてよい。

### 8. 今後の PR での実装方針

- **PR 2（予約 1 件の同期）**:
  予約の状態遷移（承認・キャンセル・差し戻し）および内容変更の各ユースケースで、`toCalendarSyncDraft` を用いて同期タスクを `db.batch()` に積む。毎分の cron（`workers/app.ts` の `scheduled`）から呼び出される `processCalendarSyncTasksUseCase` を実装する。
- **PR 3（施設の変更）**:
  施設編集画面で Google Calendar ID を変更した際、保存前に `checkWriteAccess` で書き込み権限を検証（COND-025）。保存時は施設の更新と同じ batch で、範囲内（`calendarSyncRangeStart`）の承認済み予約のタスクを `INSERT ... SELECT` で積む。
- **PR 4（日次の突き合わせ）**:
  毎朝 4:00（JST）の Cron（`0 19 * * *`）で、施設ごとに `listManagedEvents` と DB 内の承認済み予約を突き合わせ、差異がある予約のタスクを `calendar_sync_task` に積む。実際の反映は毎分の Cron に委ねる。Cron Trigger は本番とプレビューの Worker でそれぞれ 2 個（毎分と日次）になり、アカウント全体で 4 個と Free プランの上限（5 個）に収まる。
- **PR 5（カレンダー購読画面）**:
  ログインユーザー向けにカレンダー購読 URL（Google Calendar 追加ボタン / iCal URL）を一覧表示する画面（SCR-010 / UC-018）を実装する。

## 運用手順（Google カレンダーと Service Account の準備）

カレンダー連携を有効化する際のインフラ・Google Cloud の設定手順：

1. **Google Cloud プロジェクトの準備**:
   - Google Cloud Console でプロジェクトを作成（または既存プロジェクトを選択）。
   - 「Google Calendar API」を有効化する。
2. **Service Account の作成と鍵の発行**:
   - 「IAM と管理」>「サービス アカウント」からサービスアカウントを作成（例: `iclub-calendar-sync@<project-id>.iam.gserviceaccount.com`）。
   - 「キー」タブから「鍵を追加」>「新しい鍵を作成」>「JSON」を選択してダウンロード。
   - JSON ファイル内の `client_email` と `private_key` を確認。
3. **Cloudflare 環境へのシークレット登録**:
   - ローカル開発: `.dev.vars` に `GOOGLE_SERVICE_ACCOUNT_EMAIL` と `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` を設定。
   - プレビュー環境:
     `pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL --env preview`
     `pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY --env preview`
   - 本番環境:
     `pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL --env production`
     `pnpm exec wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY --env production`
4. **施設のカレンダー作成と共有設定（事務局の作業）**:
   - 事務局の共有 Google アカウントで施設ごとのカレンダーを作成し、一般公開する。
   - 各カレンダーの設定画面で、上記 Service Account のメールアドレス（`GOOGLE_SERVICE_ACCOUNT_EMAIL`）に対して「予定の変更権限（writer）」を付与して共有する。
   - 施設管理画面（SCR-009）にカレンダー ID を入力して保存する（システムが書き込み権限を自動検証する）。

## 結果

日次の突き合わせの 1 回の実行では、Google への呼び出しが「施設の数 × ページ数」（1 ページ 250 件）、ほかに access token の取得 1 回と D1 の問い合わせ 3 回（施設・予約の読み込みとタスクの書き込み）になる。Free プランのサブリクエスト上限 50 件のもとでは、各施設の予定が 1 ページに収まる限り 40 施設前後まで耐えられる。上限を超えると、後ろの施設の読み込みに加えてタスクの書き込みも失敗するので、施設がこの数に近づいたら Paid プランに移すか、突き合わせを何回かに分ける。

## トレードオフ

| 項目                                   | トレードオフ                                                         | 対策                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 最大 1 分の反映遅延                    | 操作直後にカレンダーを見てもまだ反映されていない場合がある           | iCal 購読側の更新頻度はもともと数時間単位であり、1 分の遅延は実害なし。キュー不要による簡潔性と安定性を優先。            |
| 外部 SDK の不使用                      | Google 公式 SDK のバージョンアップに自動追従できない                 | 標準の WebCrypto と REST API のみで記述することで、Workers エッジランタイムでの完全な動作と軽量性を保証。                |
| 1 回のバッチ件数制限（5件）            | 大量の予約変更が発生した際、すべて反映されるまで数分〜十数分を要する | 毎分 5 件ずつ確実に消費され、日次突き合わせでも修復されるため、システムダウンや制限超過を確実に回避できる。              |
| 削除済み予定の復活（409 ハンドリング） | insert 失敗時に update を再試行するためリクエスト数が 1 回増える     | Google Calendar の仕様（削除後も ID が保持される）に合わせた必須の処理。通常は update から試行するため滅多に発生しない。 |

## 適用範囲

本 ADR は Google Calendar 連携（BIZ-005）の全般に適用される。
通知メール（ADR-002）や他の Transactional Outbox テーブルの仕様には影響を与えない。
