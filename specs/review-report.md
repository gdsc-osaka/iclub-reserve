---
generated_at: "2026-03-17"
reviewer: "rdra-reviewer-agent"
target: "rdra/"
scope: "all"
---

## レビュー結果サマリ

| 観点 | 検出数 | 重要度高 | 重要度中 | 重要度低 |
|------|--------|---------|---------|---------|
| 網羅性 | 3 | 1 | 1 | 1 |
| トレーサビリティ | 6 | 4 | 1 | 1 |
| 曖昧性 | 4 | 0 | 3 | 1 |
| 整合性 | 6 | 3 | 2 | 1 |

> SDD文書（specs/prd.md, specs/spec.md 等）が存在しないため、RDRA成果物内のみをレビュー対象とした。

---

## 詳細

### 網羅性

#### [COMP-001] traceability.yaml の `bucs_with_ucs` 値と notes の記述が矛盾している

- **重要度**: 高
- **対象**: `rdra/traceability.yaml` coverage.bucs_with_ucs（行489）および notes（行493）
- **問題**: `bucs_with_ucs: 20` と定義されているにもかかわらず、notes には「bucs_with_ucs=19」と記載されており矛盾している。total_bucs=21 でUCを持たないのが BUC-017（Google Calendar自動反映）の1件のみであれば bucs_with_ucs=20 が正しく、notes の「19」は誤りである。この誤りはカバレッジ指標の信頼性を損なう。
- **推奨**: notes の記述を「BUC-017（Google Calendar自動反映）はシステム内部処理のためUCを持たない（total_bucs=21, bucs_with_ucs=20）」に修正する。

#### [COMP-002] EVT・COND・SCR・STATE・INFO・VAR 要素が traceability.yaml に未登録

- **重要度**: 中
- **対象**: `rdra/traceability.yaml` elements セクション全体
- **問題**: traceability.yaml には GOAL / REQ / BUC / UC の4層のみが登録されており、EVT（イベント）・COND（条件）・SCR（画面）・STATE（状態）・VAR（バリエーション）・INFO（情報）要素が登録されていない。これらの要素もすべて traces_to を持っており、カバレッジ計測・孤立要素検出の対象になるはずだが、現状では管理されていない。
- **推奨**: EVT・COND・SCR・STATE・VAR・INFO のエントリを traceability.yaml に追加し、coverage 指標を拡張する。または、現在のスコープ（4層のみ）を意図的な設計として明示的にドキュメント化する。

#### [COMP-003] INFO-001（予約）の traces_to に UC-017 が欠落している

- **重要度**: 低
- **対象**: `rdra/shared/information-model.md` INFO-001 traces_to（行66）
- **問題**: UC-017（仮予約の内容を編集する）は仮予約エンティティ（INFO-001）を直接操作するユースケースだが、INFO-001 の traces_to に UC-017 が含まれていない。UC-001 〜 UC-008 は全て列挙されているが UC-017 のみ脱落している。
- **推奨**: `traces_to` に UC-017 を追加する。

---

### トレーサビリティ

#### [TRACE-001] STATE-001 の Mermaid 図に「事務局直接作成 [UC-008] → 承認済み」遷移が未描画

- **重要度**: 高
- **対象**: `rdra/shared/state-models.md` transitions 定義（行28-29）および Mermaid 図（行62-75）
- **問題**: STATE-001 の transitions には `from: "[*]", to: "承認済み", trigger: "UC-008（事務局直接作成）"` が定義されているが、Mermaid 図には `[*] --> 仮予約 : 申請 [UC-002]` の遷移のみ描画されており、`[*] --> 承認済み : 事務局直接作成 [UC-008]` が欠落している。YAML 定義と図が不一致であり、状態遷移図が不完全な仕様書として機能しない。
- **推奨**: Mermaid 図に `[*] --> 承認済み : 事務局直接作成 [UC-008]` の行を追加する。

#### [TRACE-002] UC-006（承認）が EVT-009（Google Calendar 登録）を参照していない

- **重要度**: 高
- **対象**: `rdra/contexts/reservation-approval.md` UC-006 の `events` フィールド
- **問題**: UC-006 の `events: ["EVT-005", "EVT-006"]` となっており、承認時にトリガーされるべき EVT-009（Google Calendar 登録）が含まれていない。一方 `rdra/contexts/calendar-integration.md` の EVT-009 トリガー定義には「UC-006（承認時）またはUC-008（事務局直接作成時）」と明記されている。UC-006 の定義側から EVT-009 へのリンクが切断されており、実装時にカレンダー連携漏れを招く可能性がある。
- **推奨**: UC-006 の `events` に `"EVT-009"` を追加する。`events: ["EVT-005", "EVT-006", "EVT-009"]`

#### [TRACE-003] UC-007（事務局キャンセル）が EVT-010（Google Calendar 削除）を参照していない

- **重要度**: 高
- **対象**: `rdra/contexts/reservation-approval.md` UC-007 の `events` フィールド
- **問題**: UC-007 の `events: ["EVT-007"]` となっており、事務局が承認済み予約をキャンセルした際に発火すべき EVT-010（Google Calendar 削除）が含まれていない。EVT-010 のトリガー定義（calendar-integration.md）には「UC-007（事務局キャンセル）」が列挙されているが、UC-007 から EVT-010 への逆方向リンクがない。
- **推奨**: UC-007 の `events` に `"EVT-010"` を追加する。`events: ["EVT-007", "EVT-010"]`

#### [TRACE-004] UC-004（団体キャンセル）が EVT-010（Google Calendar 削除）を参照していない

- **重要度**: 高
- **対象**: `rdra/contexts/reservation-application.md` UC-004 の `events` フィールド
- **問題**: UC-004 の `events: ["EVT-003"]` となっており、承認済み予約がキャンセルされた際に必要な EVT-010（Google Calendar 削除）が含まれていない。EVT-010 のトリガー定義には「UC-004（団体キャンセル）」が明記されているが、UC-004 側からの参照がない。
- **推奨**: UC-004 の `events` に `"EVT-010"` を追加する。`events: ["EVT-003", "EVT-010"]`

#### [TRACE-005] BIZ-002 の value.requirements に REQ-009 が含まれていないが BUC-009 が REQ-009 を参照している

- **重要度**: 中
- **対象**: `rdra/contexts/reservation-approval.md` BUC-009 traces_to（行50）と value.requirements リスト（行9-27）
- **問題**: BUC-009（予約へのメッセージ送受信）の traces_to に REQ-009 が含まれているが、REQ-009 は BIZ-001（reservation-application.md）で定義された要求であり、BIZ-002 の value.requirements リストには含まれていない。コンテキスト間の要求共有関係が明示されていないため、BIZ-002 が依存する要求の全体像が不明確になっている。
- **推奨**: BIZ-002 の value.requirements に REQ-009 を追加するか、またはコンテキスト間で共有される要求の参照ルール（例: 「一次定義コンテキストのみに記載する」）を明文化する。

#### [TRACE-006] INFO-006（ユーザー）の traces_to が SCR-011・SCR-012・UC-019・UC-020 を含んでいない

- **重要度**: 低
- **対象**: `rdra/shared/information-model.md` INFO-006 の `traces_to` フィールド
- **問題**: INFO-006 の `traces_to: ["UC-010", "UC-011", "SCR-006", "SCR-007"]` となっているが、SCR-011（アカウント登録フォーム）と SCR-012（ログイン画面）はいずれも `information: ["INFO-006"]` を参照している。また UC-019（アカウントを登録する）・UC-020（ログインする）も INFO-006 を操作対象とするが traces_to に含まれていない。認証コンテキストとの参照が片方向のみになっている。
- **推奨**: INFO-006 の `traces_to` に `"UC-019"`, `"UC-020"`, `"SCR-011"`, `"SCR-012"` を追加する。

---

### 曖昧性

#### [AMB-001] REQ-024 の「現在進行中の予約は除く」の定義が要求レベルでは不明瞭

- **重要度**: 中
- **対象**: `rdra/contexts/facility-management.md` REQ-024 description（行17）
- **問題**: REQ-024 に「現在進行中の予約は除く」と記載されているが、REQ レベルでは「進行中」の定義が示されていない。COND-003 では「start_at が現在時刻以前かつ end_at が現在時刻以降の承認済み予約（現在使用中）は対象外」と詳細に定義されており、実装上は問題ないが、要求と条件の粒度差により要求レベルで誤解が生じるリスクがある。
- **推奨**: REQ-024 の description を「無効化前に将来の予約（仮予約・承認済み）がすべて取り消し・キャンセル済みであることが必要。ただし start_at が現在時刻以前かつ end_at が現在時刻以降の承認済み予約（進行中）は対象外（COND-003）。」に修正し、要求レベルで境界条件を明示する。

#### [AMB-002] group-management.md の「名称等」「連絡先等」による編集可能フィールドの範囲が不明

- **重要度**: 中
- **対象**: `rdra/contexts/group-management.md` REQ-020 description（行23）、BUC-013 description（行49）、UC-013 description（行86）
- **問題**: REQ-020 は「団体情報（名称等）を編集できる」、BUC-013 および UC-013 は「団体名・連絡先等を編集する」と記述しており、「等」による列挙省略が繰り返されている。INFO-003 の属性は `name` と `is_active` のみであり、「等」が示す追加フィールドが存在しない。`is_active` の変更は事務局の無効化操作（UC-014）に対応するため権限設計に影響し、「等」の解釈次第で実装の誤りが生じうる。
- **推奨**: 「等」を排除し、編集可能なフィールドを明示する。例: REQ-020 を「オーナーまたは事務局が団体名を編集できる。連絡先はオーナー全員の大学メールアドレスが自動反映されるため直接編集不可。is_active（有効/無効）の変更は事務局専用（UC-014）。」に修正する。

#### [AMB-003] INFO-002.google_calendar_id が「未設定の場合はカレンダー連携をスキップ」するとき、スキップされるイベントが不明

- **重要度**: 中
- **対象**: `rdra/shared/information-model.md` INFO-002 の `google_calendar_id` 属性説明
- **問題**: 「未設定の場合はカレンダー連携をスキップする」とあるが、EVT-009・EVT-010・EVT-011 のどれがスキップ対象になるかが記述されていない。また EVT-009/010/011 の説明文にも `google_calendar_id` 未設定時の挙動が記述されていない。実装者が正確な挙動を判断できない。
- **推奨**: EVT-009・EVT-010・EVT-011 の各説明に「google_calendar_id が未設定の場合は本イベントの処理をスキップする」を明記する。あるいは COND として「カレンダー連携実行条件（google_calendar_id が設定済みであること）」を定義し、各イベントから参照する。

#### [AMB-004] SCR-001 description の「承認・却下・直接作成等」の「等」による管理操作範囲が不明

- **重要度**: 低
- **対象**: `rdra/contexts/reservation-application.md` SCR-001 description（行119）
- **問題**: 「事務局ログイン時は管理操作（承認・却下・直接作成等）を追加表示する」の「等」が示す操作の全範囲が不明。事務局が SCR-001 から実行できる他の操作（例: キャンセル、変更）が含まれるか否かが判断できない。
- **推奨**: 「等」を排除し、SCR-001 から実行可能な全管理操作を明示する。例: 「事務局ログイン時は管理操作（仮予約の承認・却下、直接予約の作成・変更・削除）を追加表示する」。

---

### 整合性

#### [CONS-001] BIZ-002 の value.goals に GOAL-001 が含まれていないが REQ-013 が GOAL-001 を参照している

- **重要度**: 高
- **対象**: `rdra/contexts/reservation-approval.md` value.goals（行8）と REQ-013（行22）
- **問題**: BIZ-002（予約承認）の value.goals は `["GOAL-002", "GOAL-003", "GOAL-005"]` と定義されているが、同コンテキスト内の REQ-013（全団体の予約をカレンダー・一覧で確認できる）は `traces_to: ["GOAL-001"]` と GOAL-001 を参照している。BIZ-002 のゴールスコープに宣言されていない GOAL-001 に要求がトレースされており、コンテキストの責務範囲の宣言と実際の要求定義が矛盾している。
- **推奨**: BIZ-002 の value.goals に GOAL-001 を追加する（`["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]`）か、または REQ-013 のトレース先を GOAL-002 に変更することを検討する。

#### [CONS-002] SCR-009 と SCR-010 で「個別URL管理」の責務が重複・曖昧になっている

- **重要度**: 高
- **対象**: `rdra/contexts/facility-management.md` SCR-009 description（行56）、`rdra/contexts/calendar-integration.md` SCR-010 description（行49）
- **問題**: SCR-009（施設管理画面）の description には「施設ごとのGoogle Calendar IDの設定も本画面で行う。カレンダー購読URLの確認・一覧はSCR-010で提供する。」と記述されており分離の意図はある。一方 SCR-010 の description には「施設ごとの個別URL管理はSCR-009（施設管理画面）で行う。」と逆参照がある。この相互参照の結果、「SCR-009 で Google Calendar ID を設定する管理作業」と「SCR-009 で購読URLを確認する操作」の境界が不明確であり、開発者が SCR-009 のスコープを誤解するリスクがある。
- **推奨**: SCR-009 の description を「施設名・写真・説明・有効/無効・Google Calendar ID の登録・編集を行う事務局専用の管理画面。施設ごとの購読URLの一般公開は SCR-010 で行う。」と修正し、「個別URL管理」という曖昧な表現を排除する。

#### [CONS-003] 連絡先の定義が BUC-010・SCR-006 と REQ-020 で矛盾している

- **重要度**: 高
- **対象**: `rdra/contexts/group-management.md` BUC-010 description（行34）、SCR-006 description（行98-99）、REQ-020 description（行23）
- **問題**: BUC-010 の description は「連絡先はオーナーの大学メールアドレスが自動設定される」と記述し、SCR-006 も「連絡先は作成者（初期オーナー）の大学メールアドレスが自動設定される」と記述している。一方 REQ-020 には「連絡先はオーナー全員の大学メールアドレスが自動的に使用される」とあり、「作成者1人のメール」か「オーナー全員のメール（複数）」かで定義が揺れている。団体に複数オーナーが存在する場合の連絡先の扱いが不明確であり、実装の誤りを招く。
- **推奨**: 仕様を「連絡先 = 現時点のオーナー全員の大学メールアドレス（動的に反映）」に統一し、BUC-010 の description を「連絡先はオーナー全員の大学メールアドレスが自動的に設定される（初期時点では作成者のみ）」に修正する。SCR-006 も「連絡先は現在のオーナー全員の大学メールアドレスが自動設定される」に修正する。

#### [CONS-004] overview.md のコンテキスト間関係図に BIZ-006 → BIZ-001 の矢印が欠落している

- **重要度**: 中
- **対象**: `rdra/overview.md` コンテキスト間関係図（行103-120）
- **問題**: 関係図では `BIZ-006 --> BIZ-002`、`BIZ-006 --> BIZ-003`、`BIZ-006 --> BIZ-004`、`BIZ-006 --> BIZ-005` の矢印が記載されているが、`BIZ-006 --> BIZ-001` が存在しない。BIZ-001（予約申請）の操作（BUC-001 等）を実行するためにもログイン（BIZ-006）が前提となるため、この矢印の欠落は図の論理的整合性を損なっている。
- **推奨**: Mermaid 図に `BIZ006 --> BIZ001` の矢印を追加する。

#### [CONS-005] BUC-015 description に Google Calendar ID が含まれておらず REQ-022 と不一致

- **重要度**: 中
- **対象**: `rdra/contexts/facility-management.md` REQ-022 description（行12）と BUC-015 description（行27）
- **問題**: REQ-022 に「施設・設備を新規登録できる（名称・写真・説明・有効/無効・Google Calendar ID）」と明記されているが、BUC-015 の description は「施設・設備の名称・写真・説明・有効/無効を登録・編集する」で Google Calendar ID が脱落している。業務ユースケースとして事務局が Google Calendar ID を設定する操作が BUC レベルで見えなくなっている。
- **推奨**: BUC-015 の description を「施設・設備の名称・写真・説明・有効/無効・Google Calendar ID を登録・編集する」に修正する。

#### [CONS-006] INFO-001.rejection_reason の属性名が cancelled_by_staff 時の「キャンセル理由」用途と乖離している

- **重要度**: 低
- **対象**: `rdra/shared/information-model.md` INFO-001 rejection_reason 属性（行40-43）
- **問題**: 属性名が `rejection_reason`（却下理由）であるが、事務局キャンセル時（cancelled_by_staff）の「キャンセル理由」格納にも使用される。属性名から「却下専用フィールド」と誤読され、cancelled_by_staff 時への適用が実装者に見落とされるリスクがある。description には「rejected または cancelled_by_staff の場合は必須（COND-002）」と明記されているため仕様上は問題ないが、名称と用途の乖離がある。
- **推奨**: 属性名を `reason`（理由の汎用フィールド）に変更するか、description の先頭に「却下理由またはキャンセル理由を格納する汎用フィールド（rejected・cancelled_by_staff のどちらにも使用する）。」と明示する。

---

## 付記

- SDD文書（`specs/prd.md`, `specs/spec.md`, `specs/tasks.md`, `specs/adr/`）が存在しないため、RDRA-SDD 間の整合性チェック（観点4の RDRA-SDD 間セクション）および SDD テキストを対象とした曖昧性チェックは実施できなかった。
- EVT・SCR・COND・STATE・INFO・VAR 要素は traceability.yaml に未登録のため、これらの観点でのカバレッジ計測は行われていない（[COMP-002] 参照）。
