---
type: rdra-context
id: "BIZ-001"
name: "reservation-application"
display_name: "予約申請"

value:
  goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]
  requirements:
    - id: "REQ-001"
      description: "施設・設備ごとの空き状況をカレンダー形式で確認できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-002"
      description: "希望の日時（タイムラインUIで選択）・施設/設備・使用人数・備考を入力して仮予約を申請できる。"
      traces_to: ["GOAL-001", "GOAL-002"]
    - id: "REQ-003"
      description: "自団体の申請済み予約一覧を確認できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-004"
      description: "承認前の仮予約を自分で取り消せる。"
      traces_to: ["GOAL-002"]
    - id: "REQ-005"
      description: "申請結果（承認・却下）をメールで受け取れる。"
      traces_to: ["GOAL-003"]
    - id: "REQ-006"
      description: "承認済み予約を事務局承認なしでキャンセルできる（事務局へ通知あり）。"
      traces_to: ["GOAL-003"]
    - id: "REQ-007"
      description: "承認済み予約の内容を変更できる。使用人数・備考の変更は通知のみ（再承認不要）。施設・日時の変更は仮予約に戻り再承認が必要。"
      traces_to: ["GOAL-003"]
    - id: "REQ-009"
      description: "予約単位で事務局・団体間のメッセージをやり取りできる（相互にメール通知あり）。"
      traces_to: ["GOAL-005"]
    - id: "REQ-029"
      description: "承認前の仮予約の内容（施設/設備・日時・使用人数・備考）を直接編集できる。ステータス変更なし。申請者・事務局へ通知。"
      traces_to: ["GOAL-003"]

environment:
  business_usecases:
    - id: "BUC-001"
      name: "空き確認・仮予約申請"
      actors: ["ACTOR-002"]
      description: "施設・設備の空き状況を確認し、仮予約を申請する。申請時に申請者・団体オーナー全員・事務局へ通知。自団体の予約一覧確認も含む。"
      traces_to: ["REQ-001", "REQ-002", "REQ-003"]
    - id: "BUC-002"
      name: "仮予約の取り消し"
      actors: ["ACTOR-002"]
      description: "承認前の仮予約を取り消す。申請者・団体オーナー全員へ通知。"
      traces_to: ["REQ-004"]
    - id: "BUC-003"
      name: "承認済み予約のキャンセル"
      actors: ["ACTOR-002"]
      description: "承認済み予約をキャンセルする。申請者・団体オーナー全員・事務局へ通知。"
      traces_to: ["REQ-006"]
    - id: "BUC-004"
      name: "承認済み予約の内容変更（使用人数・備考）"
      actors: ["ACTOR-002"]
      description: "承認済み予約の使用人数・備考を変更する。再承認不要。申請者・団体オーナー全員・事務局へ通知。"
      traces_to: ["REQ-007"]
    - id: "BUC-018"
      name: "承認済み予約の施設・日時変更"
      actors: ["ACTOR-002"]
      description: "承認済み予約の施設・日時を変更する。変更後は仮予約に戻り再承認が必要。"
      traces_to: ["REQ-007"]
    - id: "BUC-005"
      name: "仮予約の内容変更"
      actors: ["ACTOR-002"]
      description: "承認前の仮予約を直接編集する。ステータスは仮予約のまま維持。申請者・団体オーナー全員・事務局へ通知。"
      traces_to: ["REQ-029"]

boundary:
  usecases:
    - id: "UC-001"
      name: "空き状況を確認する"
      actors: ["ACTOR-002"]
      screens: ["SCR-001"]
      events: []
      traces_to: ["BUC-001"]
      description: "施設・設備ごとの予約状況をカレンダー形式で確認する。"
    - id: "UC-002"
      name: "仮予約を申請する"
      actors: ["ACTOR-002"]
      screens: ["SCR-002"]
      events: ["EVT-001"]
      traces_to: ["BUC-001"]
      description: "施設/設備・日時・使用人数・備考を入力して仮予約を申請する。申請時に申請者・団体オーナー全員・事務局へメール通知。"
    - id: "UC-003"
      name: "仮予約を取り消す"
      actors: ["ACTOR-002"]
      screens: ["SCR-003"]
      events: ["EVT-002"]
      traces_to: ["BUC-002"]
      description: "自団体の仮予約を取り消す。申請者・団体オーナー全員へメール通知。"
    - id: "UC-017"
      name: "仮予約の内容を編集する"
      actors: ["ACTOR-002"]
      screens: ["SCR-003", "SCR-005"]
      events: ["EVT-012"]
      traces_to: ["BUC-005"]
      description: "承認前の仮予約の施設/設備・日時・使用人数・備考を直接編集する。ステータス変更なし。申請者・団体オーナー全員・事務局へメール通知。"
    - id: "UC-004"
      name: "承認済み予約をキャンセルする"
      actors: ["ACTOR-002"]
      screens: ["SCR-003"]
      events: ["EVT-003", "EVT-010"]
      traces_to: ["BUC-003"]
      description: "承認済み予約をキャンセルする。申請者・団体オーナー全員・事務局へメール通知。"
    - id: "UC-005"
      name: "承認済み予約の内容を変更する"
      actors: ["ACTOR-002"]
      screens: ["SCR-003", "SCR-005"]
      events: ["EVT-004", "EVT-010"]
      traces_to: ["BUC-004", "BUC-018"]
      description: "承認済み予約の内容を変更する。使用人数・備考は非公開のためCalendar更新不要（EVT-004通知のみ）。施設・日時変更時は仮予約に戻り再承認が必要なためEVT-010（Google Calendar削除）。"

  screens:
    - id: "SCR-001"
      name: "空き状況カレンダー画面"
      description: "施設・設備ごとの予約状況をタイムライン表示する共通画面。事務局ログイン時は管理操作（承認・却下・直接作成等）を追加表示する。"
      information: ["INFO-001", "INFO-002"]
    - id: "SCR-002"
      name: "予約申請フォーム"
      description: "施設/設備・日時（タイムラインUI）・使用人数・備考を入力して仮予約を申請するフォーム。"
      information: ["INFO-001", "INFO-002"]
    - id: "SCR-003"
      name: "予約一覧・管理画面"
      description: "団体ログイン時は自団体の予約のみ表示。事務局ログイン時は全団体の予約を表示・管理できる。取り消し・キャンセル・変更操作も本画面から実行する。"
      information: ["INFO-001", "INFO-002", "INFO-003"]
    - id: "SCR-005"
      name: "予約詳細・メッセージ画面"
      description: "予約詳細の確認・変更、および事務局と団体間のメッセージをやり取りする画面。"
      information: ["INFO-001", "INFO-004"]

  events:
    - id: "EVT-001"
      name: "仮予約申請通知"
      trigger: "UC-002: 仮予約申請時"
      description: "申請者・団体オーナー全員・事務局へメール送信する。"
    - id: "EVT-002"
      name: "取り消し完了通知"
      trigger: "UC-003: 取り消し実行時"
      description: "申請者・団体オーナー全員へメール送信する（事務局への通知不要）。"
    - id: "EVT-003"
      name: "キャンセル通知"
      trigger: "UC-004: キャンセル実行時"
      description: "申請者・団体オーナー全員・事務局へメール送信する。"
    - id: "EVT-004"
      name: "承認済み予約変更通知"
      trigger: "UC-005: 承認済み予約の内容変更時"
      description: "申請者・団体オーナー全員・事務局へメール送信する。"
    - id: "EVT-012"
      name: "仮予約変更通知"
      trigger: "UC-017: 仮予約の内容編集時"
      description: "申請者・団体オーナー全員・事務局へメール送信する。"

system:
  information: ["INFO-001", "INFO-002", "INFO-003", "INFO-004"]
  states: ["STATE-001"]
  conditions:
    # COND-001（重複予約不可）はBIZ-002で定義。UC-002・UC-005・UC-006の両方で確認する。
    - id: "COND-005"
      name: "承認済み予約の変更種別による再承認要否"
      description: "UC-005（承認済み予約の内容変更）において、変更フィールドによって処理が分岐する。施設または日時を変更した場合は仮予約に戻し再承認が必要（BUC-018 / EVT-010）。使用人数・備考のみの変更は再承認不要で通知のみ（BUC-004 / EVT-004）。"
      traces_to: ["UC-005"]
  variations: []
---

# BIZ-001: 予約申請

団体による施設・設備の空き確認、仮予約申請・取り消し・キャンセル・変更を担うコンテキスト。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor2["ACTOR-002: 団体"]

    subgraph biz1["BIZ-001: 予約申請"]
        buc1["BUC-001: 空き確認・仮予約申請"]
        buc2["BUC-002: 仮予約の取り消し"]
        buc3["BUC-003: 承認済み予約のキャンセル"]
        buc4["BUC-004: 承認済み予約の内容変更（使用人数・備考）"]
        buc4b["BUC-018: 承認済み予約の施設・日時変更"]
        buc5["BUC-005: 仮予約の内容変更"]
    end

    actor2 --> buc1
    actor2 --> buc2
    actor2 --> buc3
    actor2 --> buc4
    actor2 --> buc4b
    actor2 --> buc5
```

## 業務フロー

### BUC-001: 空き確認・仮予約申請

```mermaid
sequenceDiagram
    actor 団体
    participant システム
    participant 事務局

    団体->>システム: カレンダーで空き状況を確認
    団体->>システム: 施設/設備・日時（タイムラインで選択）・使用人数・備考を入力
    団体->>システム: 仮予約を申請
    システム-->>団体: 申請完了メール送信（EVT-001）
    システム-->>事務局: 仮予約通知メール送信（EVT-001）
```

### BUC-002: 仮予約の取り消し

```mermaid
sequenceDiagram
    actor 団体
    participant システム

    団体->>システム: 自団体の予約一覧から仮予約を選択
    団体->>システム: 取り消しを実行
    システム-->>団体: 取り消し完了メール送信（EVT-002・申請者・団体オーナー全員）
```

### BUC-003: 承認済み予約のキャンセル

```mermaid
sequenceDiagram
    actor 団体
    participant システム
    participant 事務局

    団体->>システム: 自団体の予約一覧から承認済み予約を選択
    団体->>システム: キャンセルを実行
    システム-->>団体: キャンセル完了メール送信（EVT-003）
    システム-->>事務局: キャンセル通知メール送信（EVT-003）
```

### BUC-004: 承認済み予約の内容変更（使用人数・備考）

```mermaid
sequenceDiagram
    actor 団体
    participant システム
    participant 事務局

    団体->>システム: 自団体の予約一覧から承認済み予約を選択
    団体->>システム: 使用人数・備考を変更して保存
    システム-->>団体: 変更完了メール送信（EVT-004）
    システム-->>事務局: 変更通知メール送信（EVT-004）
```

### BUC-018: 承認済み予約の施設・日時変更

```mermaid
sequenceDiagram
    actor 団体
    participant システム
    participant 事務局

    団体->>システム: 自団体の予約一覧から承認済み予約を選択
    団体->>システム: 施設または日時を変更して保存
    システム->>システム: 予約を仮予約ステータスに戻す
    システム->>システム: Google Calendarから既存エントリを削除（EVT-010）
    システム-->>団体: 変更完了・再承認待ちメール送信（EVT-004）
    システム-->>事務局: 変更通知メール送信（EVT-004）
```

### BUC-005: 仮予約の内容変更

```mermaid
sequenceDiagram
    actor 団体
    participant システム
    participant 事務局

    団体->>システム: 自団体の予約一覧から仮予約を選択
    団体->>システム: 施設/設備・日時・使用人数・備考を編集して保存
    システム-->>団体: 変更完了メール送信（EVT-012）
    システム-->>事務局: 変更通知メール送信（EVT-012）
```
