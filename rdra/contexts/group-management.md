---
type: rdra-context
id: "BIZ-003"
name: "group-management"
display_name: "団体管理"

value:
  goals: ["GOAL-001"]
  requirements:
    - id: "REQ-016"
      description: "団体アカウントを新規作成できる。作成者が初期オーナーになる。事務局の承認は不要。"
      traces_to: ["GOAL-001"]
    - id: "REQ-017"
      description: "オーナーまたは事務局がメンバーをメールアドレスで直接追加できる（承諾不要）。"
      traces_to: ["GOAL-001"]
    - id: "REQ-018"
      description: "オーナーまたは事務局がメンバーをオーナーに昇格・降格できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-019"
      description: "オーナーまたは事務局がメンバーを削除できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-020"
      description: "オーナーまたは事務局が団体情報（名称等）を編集できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-021"
      description: "事務局が団体を無効化できる。"
      traces_to: ["GOAL-001"]

environment:
  business_usecases:
    - id: "BUC-010"
      name: "団体の新規作成"
      actors: ["ACTOR-002"]
      description: "ユーザーが団体名を入力して団体を作成する。作成者が初期オーナーになる。"
      traces_to: ["REQ-016"]
    - id: "BUC-011"
      name: "メンバーの追加・削除"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "オーナーまたは事務局がメールアドレスでメンバーを直接追加、または削除する。"
      traces_to: ["REQ-017", "REQ-019"]
    - id: "BUC-012"
      name: "オーナーの昇格・降格"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "オーナーまたは事務局がメンバーをオーナーに昇格、またはオーナーをメンバーに降格する。"
      traces_to: ["REQ-018"]
    - id: "BUC-013"
      name: "団体情報の編集"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "オーナーまたは事務局が団体名等の基本情報を編集する。"
      traces_to: ["REQ-020"]
    - id: "BUC-014"
      name: "事務局による団体の無効化"
      actors: ["ACTOR-001"]
      description: "事務局が団体を無効化する。"
      traces_to: ["REQ-021"]

boundary:
  usecases:
    - id: "UC-010"
      name: "団体を新規作成する"
      actors: ["ACTOR-002"]
      screens: ["SCR-006"]
      events: []
      traces_to: ["BUC-010"]
      description: "団体名を入力して団体を作成する。作成者が初期オーナーになる。"
    - id: "UC-011"
      name: "メンバーを追加・削除する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-011"]
      description: "メールアドレスでメンバーを直接追加、または削除する。"
    - id: "UC-012"
      name: "オーナーを昇格・降格する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-012"]
      description: "メンバーをオーナーに昇格、またはオーナーをメンバーに降格する。"
    - id: "UC-013"
      name: "団体情報を編集する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-013"]
      description: "団体名等の基本情報を編集して保存する。"
    - id: "UC-014"
      name: "団体を無効化する"
      actors: ["ACTOR-001"]
      screens: ["SCR-008"]
      events: []
      traces_to: ["BUC-014"]
      description: "事務局が団体を無効化する。"

  screens:
    - id: "SCR-006"
      name: "団体作成フォーム"
      description: "団体名を入力して新しい団体を作成するフォーム。作成者が初期オーナーになる。"
      information: ["INFO-003"]
    - id: "SCR-007"
      name: "団体管理画面"
      description: "団体情報の編集、メンバーの追加・削除・オーナー昇格・降格を行う画面。メンバー一覧にメールアドレスも表示する。閲覧・操作はオーナーと事務局のみ可能。"
      information: ["INFO-003", "INFO-005", "INFO-006"]
    - id: "SCR-008"
      name: "団体一覧画面"
      description: "一般ユーザーは自分の所属団体のみ表示。事務局は全団体を表示・無効化操作も可能。団体を選択するとSCR-007に遷移する。"
      information: ["INFO-003"]

  events: []

system:
  information: ["INFO-003", "INFO-005", "INFO-006"]
  states: []
  conditions: []
  variations:
    - id: "VAR-001"
      name: "メンバーロール"
      values: ["owner（オーナー）", "member（メンバー）"]
      description: "団体内のメンバーロール（INFO-005.role の enum 値）。owner（オーナー）はメンバー管理・団体情報編集が可能。member（メンバー）は予約申請・閲覧のみ可能。"
      traces_to: ["UC-011", "UC-012"]
---

# BIZ-003: 団体管理

団体アカウントの作成・メンバー管理・オーナー管理・団体情報編集・無効化を担うコンテキスト。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体（オーナー）"]

    subgraph biz3["BIZ-003: 団体管理"]
        buc10["BUC-010: 団体の新規作成"]
        buc11["BUC-011: メンバーの追加・削除"]
        buc12["BUC-012: オーナーの昇格・降格"]
        buc13["BUC-013: 団体情報の編集"]
        buc14["BUC-014: 事務局による団体の無効化"]
    end

    actor2 --> buc10
    actor2 --> buc11
    actor2 --> buc12
    actor2 --> buc13
    actor1 --> buc11
    actor1 --> buc12
    actor1 --> buc13
    actor1 --> buc14
```

## 業務フロー

### BUC-010: 団体の新規作成

```mermaid
sequenceDiagram
    actor ユーザー
    participant システム

    ユーザー->>システム: 団体名を入力して作成
    システム->>システム: 作成者をオーナーとして登録
    システム-->>ユーザー: 作成完了
```
