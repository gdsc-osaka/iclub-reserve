---
type: rdra-context
id: "BIZ-004"
name: "facility-management"
display_name: "施設管理"

value:
  goals: ["GOAL-001", "GOAL-002"]
  requirements:
    - id: "REQ-022"
      description: "施設・設備を新規登録できる（名称・写真・説明・有効/無効・Google Calendar ID）。"
      traces_to: ["GOAL-001"]
    - id: "REQ-023"
      description: "施設・設備の情報を編集できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-024"
      description: "施設・設備を無効化できる。無効化前に将来の予約（仮予約・承認済み）がすべて終了状態（取り消し済み・却下済み・キャンセル済み）であることが必要。現在進行中の予約は除く。"
      traces_to: ["GOAL-002"]
    - id: "REQ-025"
      description: "施設・設備の一覧を確認できる。"
      traces_to: ["GOAL-001"]

environment:
  business_usecases:
    - id: "BUC-015"
      name: "施設・設備の登録・編集"
      actors: ["ACTOR-001"]
      description: "事務局が施設・設備の名称・写真・説明・有効/無効を登録・編集する。"
      traces_to: ["REQ-022", "REQ-023", "REQ-025"]
    - id: "BUC-016"
      name: "施設・設備の無効化"
      actors: ["ACTOR-001"]
      description: "事務局が施設・設備を無効化する。将来の予約が残っている場合はシステムがエラーを表示する。"
      traces_to: ["REQ-024"]

boundary:
  usecases:
    - id: "UC-015"
      name: "施設・設備を登録・編集する"
      actors: ["ACTOR-001"]
      screens: ["SCR-009"]
      events: []
      traces_to: ["BUC-015"]
      description: "施設・設備の名称・写真・説明・有効/無効を登録または編集する。"
    - id: "UC-016"
      name: "施設・設備を無効化する"
      actors: ["ACTOR-001"]
      screens: ["SCR-009"]
      events: []
      traces_to: ["BUC-016"]
      description: "施設・設備を無効化する。将来の予約が残っている場合はシステムがエラーを表示し無効化を拒否する。"

  screens:
    - id: "SCR-009"
      name: "施設管理画面"
      description: "事務局が施設・設備の登録・編集・無効化・一覧確認を行う画面。施設ごとのGoogle Calendar IDの設定も本画面で行う。カレンダー購読URLの確認・一覧はSCR-010で提供する。"
      information: ["INFO-002"]

  events: []

system:
  information: ["INFO-002"]
  states: []
  conditions:
    - id: "COND-003"
      name: "施設無効化の前提条件"
      description: "無効化対象施設の将来の予約（仮予約・承認済み）がすべて終了状態（取り消し済み・却下済み・キャンセル済み）であること。ただし start_at が現在時刻以前かつ end_at が現在時刻以降の承認済み予約（現在使用中）は対象外とする。"
      traces_to: ["UC-016"]
  variations: []
---

# BIZ-004: 施設管理

事務局による施設・設備の登録・編集・有効化/無効化を担うコンテキスト。

## 施設・設備一覧（初期データ）

| 名称                           | 種別 |
| ------------------------------ | ---- |
| 吹田：C棟2階占有 イベント予約  | 部屋 |
| 吹田：3Dプリンター 積層タイプ  | 設備 |
| 吹田：3Dプリンター 積層タイプ2 | 設備 |
| 吹田：3Dプリンター 光造形機    | 設備 |
| 吹田：レーザーカッター         | 設備 |
| 吹田：CAD用パソコン            | 設備 |
| 豊中試作室                     | 部屋 |
| 豊中試作室：3Dプリンター       | 設備 |

> 注: 「種別」はINFO-002の属性として持たず、施設名称に含める運用とする。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]

    subgraph biz4["BIZ-004: 施設管理"]
        buc15["BUC-015: 施設・設備の登録・編集"]
        buc16["BUC-016: 施設・設備の無効化"]
    end

    actor1 --> buc15
    actor1 --> buc16
```

## 業務フロー

### BUC-016: 施設・設備の無効化

```mermaid
sequenceDiagram
    actor 事務局
    participant システム

    事務局->>システム: 施設管理画面で対象施設を選択
    事務局->>システム: 無効化を実行
    alt 将来の予約が残っている
        システム-->>事務局: エラー表示（将来の予約を先に処理するよう促す）
    else 将来の予約がない
        システム-->>事務局: 無効化完了
    end
```
