---
type: rdra-context
id: "BIZ-002"
name: "reservation-approval"
display_name: "予約承認"

value:
  goals: ["GOAL-001", "GOAL-002", "GOAL-003", "GOAL-005"]
  requirements:
    - id: "REQ-010"
      description: "仮予約の一覧を確認できる。"
      traces_to: ["GOAL-002"]
    - id: "REQ-011"
      description: "仮予約を承認・却下できる。却下時は理由の入力が必須。団体へ通知する。"
      traces_to: ["GOAL-002", "GOAL-003"]
    - id: "REQ-012"
      description: "承認済み予約を事務局側からキャンセルできる。キャンセル理由の入力が必須。団体へ通知する。"
      traces_to: ["GOAL-002", "GOAL-003"]
    - id: "REQ-013"
      description: "全団体の予約をカレンダー・一覧で確認できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-014"
      description: "事務局が直接予約を作成・変更・削除できる（承認フロー不要）。"
      traces_to: ["GOAL-002"]
    - id: "REQ-015"
      description: "予約に紐づくメッセージを確認・送信できる。"
      traces_to: ["GOAL-005"]

environment:
  business_usecases:
    - id: "BUC-006"
      name: "仮予約の承認・却下"
      actors: ["ACTOR-001"]
      description: "事務局が仮予約を確認し、承認または却下（理由必須）する。団体へメール通知。全団体の予約一覧確認も含む。"
      traces_to: ["REQ-005", "REQ-010", "REQ-011", "REQ-013"]
    - id: "BUC-007"
      name: "承認済み予約の事務局キャンセル"
      actors: ["ACTOR-001"]
      description: "事務局が承認済み予約をキャンセル（理由必須）する。団体へメール通知。"
      traces_to: ["REQ-012"]
    - id: "BUC-008"
      name: "事務局による予約の直接作成・変更・削除"
      actors: ["ACTOR-001"]
      description: "事務局が承認フローを経ずに予約を直接作成・変更・削除する。"
      traces_to: ["REQ-014"]
    - id: "BUC-009"
      name: "予約へのメッセージ送受信"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "予約単位で事務局と団体がメッセージをやり取りする。送信時に相手方へメール通知。"
      traces_to: ["REQ-009", "REQ-015"]

boundary:
  usecases:
    - id: "UC-006"
      name: "仮予約を承認・却下する"
      actors: ["ACTOR-001"]
      screens: ["SCR-003"]
      events: ["EVT-005", "EVT-006", "EVT-009"]
      traces_to: ["BUC-006"]
      description: "事務局が仮予約を承認または却下する。却下時は理由入力が必須。承認時はEVT-009（Google Calendar登録）を発火。"
    - id: "UC-007"
      name: "承認済み予約をキャンセルする（事務局）"
      actors: ["ACTOR-001"]
      screens: ["SCR-003"]
      events: ["EVT-007", "EVT-010"]
      traces_to: ["BUC-007"]
      description: "事務局が承認済み予約をキャンセルする。理由入力が必須。団体へ通知。"
    - id: "UC-008"
      name: "予約を直接作成・変更・削除する"
      actors: ["ACTOR-001"]
      screens: ["SCR-001", "SCR-002", "SCR-003"]
      events: ["EVT-009", "EVT-010", "EVT-011"]
      traces_to: ["BUC-008"]
      description: "事務局が承認フローを経ずに予約を直接操作する。直接作成した予約は即時「承認済み」ステータスになる（仮予約ステータスを経由しない）。直接作成→EVT-009（Calendar登録）、公開フィールド変更→EVT-011（Calendar更新）、承認済み削除→EVT-010（Calendar削除）。"
    - id: "UC-009"
      name: "予約にメッセージを送受信する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-005"]
      events: ["EVT-008"]
      traces_to: ["BUC-009"]
      description: "予約詳細画面でメッセージを送受信する。送信時に相手方へメール通知。"

  screens:
    # SCR-003・SCR-005 は BIZ-001 で一次定義。本コンテキストでは参照のみ。
    # SCR-003: 予約一覧・管理画面 — 事務局ログイン時は全団体の予約を表示・管理できる
    # SCR-005: 予約詳細・メッセージ画面 — 承認・却下操作と事務局側メッセージ送受信に使用

  events:
    - id: "EVT-005"
      name: "承認通知"
      trigger: "UC-006: 承認実行時"
      description: "申請者・団体オーナー全員へ承認メールを送信する（事務局が操作者のため事務局への通知不要）。"
    - id: "EVT-006"
      name: "却下通知"
      trigger: "UC-006: 却下実行時"
      description: "申請者・団体オーナー全員へ却下理由を含むメールを送信する。"
    - id: "EVT-007"
      name: "事務局キャンセル通知"
      trigger: "UC-007: 事務局キャンセル実行時"
      description: "申請者・団体オーナー全員へキャンセル理由を含むメールを送信する。"
    - id: "EVT-008"
      name: "メッセージ通知"
      trigger: "UC-009: メッセージ送信時"
      description: "団体側送信時→事務局へ通知。事務局送信時→申請者・団体オーナー全員へ通知。"

system:
  information: ["INFO-001", "INFO-002", "INFO-003", "INFO-004"]
  states: ["STATE-001"]
  conditions:
    - id: "COND-001"
      name: "重複予約不可条件"
      description: "同一施設・同一時間帯に承認済みの予約が存在しないこと。申請時（UC-002）・変更時（UC-005/BUC-018）・承認時（UC-006）に確認する。"
      traces_to: ["UC-002", "UC-005", "UC-006"]
    - id: "COND-002"
      name: "却下・キャンセル必須入力"
      description: "事務局による却下（UC-006）および事務局によるキャンセル（UC-007）時は理由の入力が必須。status が rejected または cancelled_by_staff の場合に rejection_reason を必須とする。団体による取り消し（UC-003・withdrawn）・キャンセル（UC-004・cancelled）は任意。"
      traces_to: ["UC-006", "UC-007"]
  variations: []
---

# BIZ-002: 予約承認

事務局による仮予約の承認・却下、直接予約の作成・変更・削除、メッセージ送受信を担うコンテキスト。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体"]

    subgraph biz2["BIZ-002: 予約承認"]
        buc6["BUC-006: 仮予約の承認・却下"]
        buc7["BUC-007: 承認済み予約の事務局キャンセル"]
        buc8["BUC-008: 事務局による予約の直接作成・変更・削除"]
        buc9["BUC-009: 予約へのメッセージ送受信"]
    end

    actor1 --> buc6
    actor1 --> buc7
    actor1 --> buc8
    actor1 --> buc9
    actor2 --> buc9
```

## 業務フロー

### BUC-006: 仮予約の承認・却下

```mermaid
sequenceDiagram
    actor 事務局
    participant システム
    actor 団体

    システム-->>事務局: 仮予約申請通知メール（EVT-001）
    事務局->>システム: 仮予約一覧を確認
    alt 承認
        事務局->>システム: 承認を実行
        システム-->>団体: 承認通知メール送信（EVT-005）
    else 却下
        事務局->>システム: 却下理由を入力して却下（必須）
        システム-->>団体: 却下通知メール送信（EVT-006）
    end
```

### BUC-007: 承認済み予約の事務局キャンセル

```mermaid
sequenceDiagram
    actor 事務局
    participant システム
    actor 団体

    事務局->>システム: 予約一覧から承認済み予約を選択
    事務局->>システム: キャンセル理由を入力してキャンセル（必須）
    システム-->>団体: キャンセル通知メール送信（EVT-007）
```
