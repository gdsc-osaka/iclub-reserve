# RDRA 成果物レビューレポート

- **レビュー対象**: X:/GitHub/iclub-reserve/rdra/ 全成果物
- **レビュー日**: 2026-03-17
- **レビュアー**: Claude Code (claude-sonnet-4-6)

---

## 1. エグゼクティブサマリー

全体的にRDRAの構造に則った記述がなされており、アクター・ゴール・コンテキスト・ユースケース・情報モデル・状態モデルの各層が網羅されている。前回レポートで指摘した問題の多くが解消されているが、コンテキストファイルと traceability.yaml 間の traces_to の不整合が新たに3箇所発見された。

- **重大度 高（要修正）**: 0件
- **重大度 中（修正推奨）**: 4件 — BUC-001/BUC-006/BUC-009 の traces_to 不整合、BUC-017 の UC カバレッジ計上誤り、SCR-003/SCR-005 の二重定義、BUC-019 のコンテキスト図未記載
- **重大度 低（確認・検討推奨）**: 2件 — INFO-006 の updated_at 欠落、UC-008 による直接承認済み作成の状態遷移表現

---

## 2. レビュー対象ファイル一覧

| ファイル | 種別 |
|---|---|
| rdra/overview.md | 全体概観（アクター・ゴール・コンテキスト定義） |
| rdra/traceability.yaml | トレーサビリティマトリクス |
| rdra/contexts/reservation-application.md | BIZ-001: 予約申請 |
| rdra/contexts/reservation-approval.md | BIZ-002: 予約承認 |
| rdra/contexts/group-management.md | BIZ-003: 団体管理 |
| rdra/contexts/facility-management.md | BIZ-004: 施設管理 |
| rdra/contexts/calendar-integration.md | BIZ-005: カレンダー連携 |
| rdra/shared/information-model.md | 情報モデル（横断） |
| rdra/shared/state-models.md | 状態モデル（横断） |

---

## 3. 指摘事項一覧

### 3.1 重大度: 中（修正推奨）

#### [M-001] `BUC-001`・`BUC-006`・`BUC-009` の traces_to がコンテキストファイルと traceability.yaml で乖離している

- **場所**:
  - `rdra/contexts/reservation-application.md`（BUC-001, 44行目）
  - `rdra/contexts/reservation-approval.md`（BUC-006, 35行目; BUC-009, 50行目）
  - `rdra/traceability.yaml`（BUC-001: 222行目, BUC-006: 251行目, BUC-009: 269行目）
- **内容**: コンテキストファイルの BUC 定義と traceability.yaml の BUC 定義の間で、以下の要求へのトレースが乖離している。

  | BUC | コンテキストファイル traces_to | traceability.yaml traces_to | 差異 |
  |---|---|---|---|
  | BUC-001 | `["REQ-001", "REQ-002"]` | `["REQ-001", "REQ-002", "REQ-003"]` | REQ-003 がコンテキスト側に欠落 |
  | BUC-006 | `["REQ-010", "REQ-011"]` | `["REQ-010", "REQ-011", "REQ-013"]` | REQ-013 がコンテキスト側に欠落 |
  | BUC-009 | `["REQ-015"]` | `["REQ-009", "REQ-015"]` | REQ-009 がコンテキスト側に欠落 |

  traceability.yaml 側の定義は正しく（前回指摘の M-002 を反映している）、コンテキストファイル側の更新が追いついていない状態。
- **影響**: コンテキストファイルが単体で真実の情報源として機能しない。コンテキストファイルを参照した開発者が要求カバレッジを誤解する可能性がある。traceability.yaml とコンテキストファイルの二重管理に起因する典型的な不整合。
- **推奨対応**:
  - `reservation-application.md` の BUC-001 の `traces_to` に `REQ-003` を追加する。
  - `reservation-approval.md` の BUC-006 の `traces_to` に `REQ-013` を追加する。
  - `reservation-approval.md` の BUC-009 の `traces_to` に `REQ-009` を追加する。

---

#### [M-002] `BUC-017` に対応する UC が存在しないが `bucs_with_ucs: 19` がそれを計上している

- **場所**: `rdra/traceability.yaml`（coverage セクション, 441〜449行目）、`rdra/contexts/calendar-integration.md`（BUC-017）
- **内容**: `BUC-017`（Google Calendarへの自動反映）には、システムが自動実行するという設計上の理由により対応する UC（ユースケース）が存在しない。BIZ-005 の `boundary.usecases` には `UC-018`（カレンダー購読URLを確認する）のみが定義されており、これは `BUC-019` に対応する。

  `traceability.yaml` の `coverage.bucs_with_ucs: 19` は全19 BUC すべてに UC が対応していることを示しているが、BUC-017 には対応する UC がなく、実際に UC を持つ BUC は18個（BUC-017 を除く）であるため、`bucs_with_ucs` の値は `18` が正しい。

- **影響**: coverage 数値の信頼性が損なわれる。BUC-017 が UC カバレッジに計上されているかどうかの根拠が成果物から読み取れない。
- **推奨対応**: `coverage.bucs_with_ucs` を `18` に修正する。あわせて BUC-017 の traceability.yaml エントリにコメントで「UC なし（システム自動実行のため）」と明記し、カバレッジ除外の意図を文書化する。

---

#### [M-003] `SCR-003` と `SCR-005` が BIZ-001 と BIZ-002 の両方に独立して定義されている

- **場所**:
  - `rdra/contexts/reservation-application.md`（SCR-003: 125〜128行目, SCR-005: 129〜132行目）
  - `rdra/contexts/reservation-approval.md`（SCR-003: 86〜88行目, SCR-005: 90〜92行目）
- **内容**: `SCR-003`（予約一覧・管理画面）と `SCR-005`（予約詳細・メッセージ画面）が、BIZ-001 と BIZ-002 の `boundary.screens` にそれぞれ独立して定義されている。内容は実質的に同一（description が同一）であり、重複定義になっている。

  定義内容の比較:
  - SCR-003 (BIZ-001): `information: ["INFO-001", "INFO-002", "INFO-003"]`
  - SCR-003 (BIZ-002): `information: ["INFO-001", "INFO-002", "INFO-003"]`（同一）
  - SCR-005 (BIZ-001): `information: ["INFO-001", "INFO-004"]`
  - SCR-005 (BIZ-002): `information: ["INFO-001", "INFO-004"]`（同一）

- **影響**: 画面仕様を変更する際に片方のファイルのみ更新される見落としが発生しやすい。どちらのコンテキストが画面の所有者かが不明確で、RDRAの境界概念が曖昧になる。
- **推奨対応**: SCR-003 と SCR-005 を `rdra/shared/` ディレクトリに昇格させて横断共有するか、どちらか一方（SCR-003・SCR-005 は両コンテキストで使用されるが、承認フローの結果を表示する主用途は BIZ-002 のため BIZ-002）を正式定義とし、もう一方からは参照のみとする（コメントで参照元を明示）。

---

#### [M-004] `BUC-019`（カレンダー購読URLの公開）が BIZ-005 のビジネスコンテキスト図に未記載

- **場所**: `rdra/contexts/calendar-integration.md`（78〜90行目のビジネスコンテキスト図）
- **内容**: `BUC-019`（カレンダー購読URLの公開）が BIZ-005 の `environment.business_usecases` に定義されているが、ビジネスコンテキスト図（Mermaid グラフ）には BUC-017 のみが描かれており、BUC-019 が図に含まれていない。

  現在の図:
  ```
  subgraph biz5["BIZ-005: カレンダー連携"]
      buc17["BUC-017: Google Calendarへの自動反映"]
  end
  ```

  図と YAML 定義の乖離が生じており、BUC-019（および対応するアクター ACTOR-001, ACTOR-002）が視覚的に把握できない。
- **影響**: 図を参照した開発者・ステークホルダーが BUC-019 の存在と BIZ-005 への帰属を見落とす可能性がある。
- **推奨対応**: ビジネスコンテキスト図に BUC-019 ノードを追加し、ACTOR-001 と ACTOR-002 を図に加えてそれぞれ BUC-019 に接続する。

---

### 3.2 重大度: 低（確認・検討推奨）

#### [L-001] `INFO-006`（ユーザー）に `updated_at` 属性が欠落している

- **場所**: `rdra/shared/information-model.md`（INFO-006, 217〜248行目）、ER 図（265〜270行目）
- **内容**: INFO-001（予約）・INFO-002（施設/設備）・INFO-003（団体）はすべて `created_at` と `updated_at` を持つが、INFO-006（ユーザー）は `created_at` のみで `updated_at` が定義されていない。ユーザー情報（氏名など）は更新されうるため、`updated_at` の欠落は設計上の漏れの可能性がある。ER 図の INFO-006 定義にも `updated_at` が含まれていない。
- **影響**: ユーザー情報の最終更新日時を追跡できない。監査ログやデータ同期が必要になった場合に後から追加することになり、スキーマ変更が発生する。
- **推奨対応**: INFO-006 の attributes に `updated_at`（datetime, required: true）を追加し、ER 図にも反映することを検討する。更新が想定されない設計（例: ユーザー情報は外部認証システムが管理）であれば、その旨を description に明記する。

---

#### [L-002] `UC-008`（事務局による直接作成）の STATE-001 における遷移経路が不明確

- **場所**: `rdra/shared/state-models.md`（遷移定義, 18〜21行目）、`rdra/contexts/reservation-approval.md`（UC-008 description, 74行目）
- **内容**: state-models.md では `[*] → 仮予約: trigger: "UC-002 / UC-008"` および `仮予約 → 承認済み: trigger: "UC-006 / UC-008"` と定義されており、事務局による直接作成（UC-008）は「仮予約を経由して即座に承認済みへ遷移する」という2段階の遷移として表現されている。

  一方、UC-008 の description（reservation-approval.md 74行目）では「事務局が承認フローを経ずに予約を直接操作する。直接作成→EVT-009（Calendar登録）」と記述されており、承認フローを経ないことが強調されている。仮予約を経由するモデルか、承認済みへ直接遷移するモデルかで、実装上の挙動が異なる。

  また、STATE-001 の Mermaid 図（53〜64行目）では `[*] --> 仮予約 : 申請 [UC-002 / UC-008]` として UC-008 が UC-002 と同じ遷移に記載されており、直接承認済みへの遷移パスが図に存在しない。
- **影響**: 実装者が UC-008 の直接作成について「仮予約レコードを作成して即座に承認済みにする」のか「最初から承認済みレコードを作成する」のかを判断できない。実装方針によってデータモデルおよびビジネスロジックが変わる。
- **推奨対応**: UC-008 による直接作成の遷移を明確化する。「仮予約を経由して即座に承認」の場合は State 図に `仮予約 --[即座に承認]--> 承認済み [UC-008]` のような遷移を追加し、UC-008 の description にもその旨を記載する。「直接承認済みを作成」の場合は State 図に `[*] --> 承認済み : 直接作成 [UC-008]` の遷移パスを追加する。

---

## 4. トレーサビリティ検証サマリー

| トレーサビリティ経路 | 状態 | 備考 |
|---|---|---|
| GOAL → コンテキスト (overview.md) | OK | 全5ゴールが各コンテキストに対応 |
| コンテキスト → REQ | OK | 全30要求が各コンテキストに定義済み |
| REQ → BUC (traceability.yaml) | OK | 全30要求が BUC に紐づいている |
| REQ → BUC (コンテキストファイル) | 要修正 | BUC-001/BUC-006/BUC-009 の traces_to が traceability.yaml と乖離（M-001） |
| BUC → UC | 要確認 | BUC-017 のみ UC なし（設計意図による）。bucs_with_ucs カウントが実態と乖離（M-002） |
| UC → SCR | 概ねOK | SCR-003/SCR-005 が BIZ-001・BIZ-002 に二重定義（M-003） |
| UC → EVT | OK | UC-008 の events: [EVT-009, EVT-010, EVT-011] に修正済み |
| EVT → Google Calendar操作 | OK | EVT-011 の Mermaid 図での条件分岐も明確化済み |
| UC → INFO (traces_to) | OK | 全エンティティが適切な UC・SCR に紐づいている |
| STATE-001 → UC (traces_to) | 概ねOK | UC-008 直接作成の遷移経路が不明確（L-002） |
| COND → UC | OK | COND-001 の二重定義が解消（BIZ-001 はコメントのみ参照） |
| coverage カウント | 要修正 | bucs_with_ucs が 19 だが正しくは 18（M-002） |
| コンテキスト図の完全性 | 要修正 | BUC-019 が BIZ-005 の Mermaid 図に未記載（M-004） |

---

## 5. 前回レポートからの変化（差分）

前回レビュー（同日付版）で指摘された以下の問題は、現在の成果物では修正済みと確認した。

| 旧指摘ID | 内容 | 状態 |
|---|---|---|
| 旧H-001 | BUC-018 の連番不整合・total_bucs が 17 | 修正済み（BUC-019 追加含め total_bucs: 19 に更新） |
| 旧M-001 | UC-008 の events リストに EVT-009・EVT-011 が欠落 | 修正済み（events: ["EVT-009", "EVT-010", "EVT-011"]） |
| 旧M-002 | REQ-003・REQ-009・REQ-013 に BUC トレース欠落 | traceability.yaml では修正済み（コンテキストファイル側は M-001 として残存） |
| 旧M-003 | EVT-011 Mermaid 図で UC-005 の条件分岐が不明確 | 修正済み（UC-005 は EVT-010 のみトリガーし EVT-011 はトリガーしないと EVT-011 description で明記） |
| 旧L-001 | COND-001 が BIZ-001・BIZ-002 の両方に重複定義 | 修正済み（BIZ-001 はコメント参照のみ、BIZ-002 が正式定義） |
| 旧L-002 | BUC-017 の UC なし構造が coverage と乖離 | 部分修正（BUC-019/UC-018 が追加されカバレッジ改善。ただし BUC-017 自体は依然 UC なしで bucs_with_ucs のカウントが不正確: M-002） |
| 旧L-003 | SCR-001・SCR-002 の所有コンテキスト不明確 | 修正済み（SCR-001・SCR-002 は BIZ-001 が所有。ただし SCR-003・SCR-005 の二重定義が新たに発生: M-003） |

---

## 6. 総評

成果物全体の品質は前回から着実に向上しており、前回の重大度「高」指摘がすべて解消されている。RDRAの階層構造（ゴール → コンテキスト → 要件 → 業務UC → ユースケース → 画面/イベント → 情報モデル → 状態モデル）も一貫して維持されている。

今回の新規指摘は、traceability.yaml の修正がコンテキストファイルに反映されていないことによる「二重管理の不整合」が主因である。成果物が traceability.yaml とコンテキストファイルの2箇所で BUC の traces_to を管理しているため、一方を更新した際に他方が追従しない問題が繰り返し発生するリスクがある。根本的には「コンテキストファイルを真実の情報源とし、traceability.yaml はそこから自動生成または参照する」という方針に整理することが望ましい。

現在の優先修正事項は以下の順で対応することを推奨する。

1. **コンテキストファイルの traces_to 補完（M-001）** — traceability.yaml との乖離を解消し、コンテキストファイル単体での完全性を回復する。
2. **BUC-019 をビジネスコンテキスト図に追加（M-004）** — 図と YAML の不整合を最小工数で解消できる。
3. **bucs_with_ucs の修正（M-002）** — カバレッジ数値の正確性を確保する。
4. **SCR-003・SCR-005 の二重定義解消（M-003）** — 画面仕様の管理一元化により将来の保守コストを削減する。
