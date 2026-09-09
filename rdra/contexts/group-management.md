---
type: rdra-context
id: "BIZ-003"
name: "group-management"
display_name: "団体管理"

value:
  goals: ["GOAL-001"]
  requirements:
    - id: "REQ-016"
      description: "団体アカウントを新規作成できる。作成には事務局の承認を要さず、作成者が初期の管理者になる。ただし作成直後は承認待ち（pending）であり、事務局が有効化するまで予約を申請できない。"
      traces_to: ["GOAL-001"]
    - id: "REQ-017"
      description: "管理者または事務局がメールアドレスへ招待を送り、招待された人が承諾することでメンバーになる。招待は取り消せる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-018"
      description: "管理者または事務局がメンバーを管理者に昇格・降格できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-019"
      description: "管理者または事務局がメンバーを削除できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-020"
      description: "管理者または事務局が団体情報（名称等）を編集できる。"
      traces_to: ["GOAL-001"]
    - id: "REQ-021"
      description: "事務局が団体を有効化・無効化できる。承認待ちの団体を有効化することで利用が始まり、無効化すると新たな予約を申請できなくなる。団体は削除せず、無効化で運用する。"
      traces_to: ["GOAL-001"]

environment:
  business_usecases:
    - id: "BUC-010"
      name: "団体の新規作成"
      actors: ["ACTOR-002"]
      description: "ユーザーが団体名を入力して団体を作成する。作成者が初期の管理者になる。作成直後は承認待ちの状態となる。"
      traces_to: ["REQ-016"]
    - id: "BUC-011"
      name: "メンバーの招待・削除"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "管理者または事務局がメールアドレスへ招待を送る、招待を取り消す、またはメンバーを削除する。"
      traces_to: ["REQ-017", "REQ-019"]
    - id: "BUC-012"
      name: "管理者の昇格・降格"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "管理者または事務局がメンバーを管理者に昇格、または管理者をメンバーに降格する。"
      traces_to: ["REQ-018"]
    - id: "BUC-013"
      name: "団体情報の編集"
      actors: ["ACTOR-001", "ACTOR-002"]
      description: "管理者または事務局が団体名等の基本情報を編集する。"
      traces_to: ["REQ-020"]
    - id: "BUC-014"
      name: "事務局による団体の有効化・無効化"
      actors: ["ACTOR-001"]
      description: "事務局が承認待ちの団体を有効化する、または有効な団体を無効化する。"
      traces_to: ["REQ-021"]
    - id: "BUC-023"
      name: "招待の承諾"
      actors: ["ACTOR-002"]
      description: "招待を受け取ったユーザーが招待を承諾し、その団体のメンバーになる。"
      traces_to: ["REQ-017"]

boundary:
  usecases:
    - id: "UC-010"
      name: "団体を新規作成する"
      actors: ["ACTOR-002"]
      screens: ["SCR-006"]
      events: []
      traces_to: ["BUC-010"]
      description: "団体名を入力して団体を作成する。作成者が初期の管理者になる。作成された団体は承認待ち（pending）で始まる（STATE-002）。"
    - id: "UC-011"
      name: "メンバーを招待・削除する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: ["EVT-014"]
      traces_to: ["BUC-011"]
      description: "メールアドレスと役割を指定して招待を送る、送った招待を取り消す、または既存のメンバーを削除する。指定できる役割はCOND-007に従う。"
    - id: "UC-012"
      name: "管理者を昇格・降格する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-012"]
      description: "メンバーを管理者に昇格、または管理者をメンバーに降格する。指定できる役割はCOND-007に従う。"
    - id: "UC-013"
      name: "団体情報を編集する"
      actors: ["ACTOR-001", "ACTOR-002"]
      screens: ["SCR-007"]
      events: []
      traces_to: ["BUC-013"]
      description: "団体名等の基本情報を編集して保存する。"
    - id: "UC-014"
      name: "団体を有効化・無効化する"
      actors: ["ACTOR-001"]
      screens: ["SCR-008"]
      events: []
      traces_to: ["BUC-014"]
      description: "事務局が団体を有効化または無効化する（STATE-002）。団体の削除は行わない。"
    - id: "UC-022"
      name: "招待を承諾する"
      actors: ["ACTOR-002"]
      screens: ["SCR-016"]
      events: []
      traces_to: ["BUC-023"]
      description: "招待メールから届いたリンクを開き、招待を承諾してその団体のメンバーになる。期限を過ぎた招待は承諾できない。"

  screens:
    - id: "SCR-006"
      name: "団体作成フォーム"
      description: "団体名を入力して新しい団体を作成するフォーム。作成者が初期の管理者になる。作成後は承認待ちである旨と、事務局の有効化までは予約を申請できない旨を表示する。"
      information: ["INFO-003"]
    - id: "SCR-007"
      name: "団体管理画面"
      description: "団体情報の編集、メンバーの招待・削除・管理者への昇格/降格を行う画面。メンバー一覧にメールアドレスも表示し、承諾待ちの招待も一覧に含めて取り消せるようにする。閲覧・操作は管理者と事務局のみ可能。"
      information: ["INFO-003", "INFO-005", "INFO-006", "INFO-007"]
    - id: "SCR-008"
      name: "団体一覧画面"
      description: "一般ユーザーは自分の所属団体のみ表示。事務局は全団体を状態（承認待ち・有効・無効）付きで表示し、有効化・無効化の操作もできる。団体を選択するとSCR-007に遷移する。"
      information: ["INFO-003"]
    - id: "SCR-016"
      name: "招待の承諾画面"
      description: "招待メールのリンクから開く画面。招待元の団体名と与えられる役割を表示し、承諾または辞退を選ぶ。ログインしていない場合はSCR-012へ案内する。"
      information: ["INFO-003", "INFO-007"]

  events:
    - id: "EVT-014"
      name: "招待通知"
      trigger: "UC-011: 招待の送信時"
      description: "招待先のメールアドレスへ、団体名・役割・承諾用リンク・有効期限を含むメールを送信する。"

system:
  information: ["INFO-003", "INFO-005", "INFO-006", "INFO-007"]
  states: ["STATE-002"]
  conditions:
    - id: "COND-006"
      name: "承認待ち団体の利用制限"
      description: "団体の状態（INFO-003.status）がpendingまたはdisabledである間は、その団体で予約を申請できない。予約を申請できるのはenabledの団体のみ。既存の予約の閲覧は状態にかかわらず可能。"
      traces_to: ["UC-010", "UC-014"]
    - id: "COND-007"
      name: "メンバーロールの単一性"
      description: "1つのメンバーシップが持つ役割は常に1つだけ（INFO-005.role）。複数の役割を同時に指定する要求、およびVAR-001に無い役割を指定する要求は、処理する前に拒否する。"
      traces_to: ["UC-011", "UC-012"]
  variations:
    - id: "VAR-001"
      name: "メンバーロール"
      values: ["admin（管理者）", "member（メンバー）"]
      description: "団体内のメンバーロール（INFO-005.role の enum 値）。admin（管理者）はメンバー管理・団体情報編集が可能。member（メンバー）は予約申請・閲覧のみ可能。1人のメンバーが持てる役割は1つだけ（COND-007）。"
      traces_to: ["UC-011", "UC-012"]
---

# BIZ-003: 団体管理

団体アカウントの作成・メンバー管理・管理者管理・団体情報編集・有効化/無効化を担うコンテキスト。

団体は誰でも作成できるが、作成直後は承認待ちであり、事務局が有効化するまで予約を申請できない（COND-006）。これにより「作成の手続きは軽く、利用の可否は事務局が制御する」という運用になる。

また、団体は削除せず無効化で運用する。予約が紐づく団体を消すと過去の利用記録をたどれなくなるためである。

## ビジネスコンテキスト図

```mermaid
graph LR
    actor1["ACTOR-001: 事務局"]
    actor2["ACTOR-002: 団体（管理者）"]

    subgraph biz3["BIZ-003: 団体管理"]
        buc10["BUC-010: 団体の新規作成"]
        buc11["BUC-011: メンバーの招待・削除"]
        buc12["BUC-012: 管理者の昇格・降格"]
        buc13["BUC-013: 団体情報の編集"]
        buc14["BUC-014: 事務局による団体の有効化・無効化"]
        buc23["BUC-023: 招待の承諾"]
    end

    actor2 --> buc10
    actor2 --> buc11
    actor2 --> buc12
    actor2 --> buc13
    actor2 --> buc23
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
    actor 事務局

    ユーザー->>システム: 団体名を入力して作成（SCR-006）
    システム->>システム: 作成者を管理者として登録
    システム->>システム: 団体を承認待ち（pending）にする（STATE-002）
    システム-->>ユーザー: 作成完了。事務局の有効化までは予約を申請できない旨を表示
    事務局->>システム: 団体を有効化（UC-014）
    システム-->>ユーザー: 予約の申請が可能になる（COND-006）
```

### BUC-011 / BUC-023: メンバーの招待と承諾

```mermaid
sequenceDiagram
    actor 管理者
    participant システム
    actor 招待された人

    管理者->>システム: メールアドレスと役割を指定して招待（SCR-007）
    システム->>システム: 役割の妥当性を確認（COND-007）
    システム-->>招待された人: 招待メールを送信（EVT-014）
    招待された人->>システム: リンクを開いて内容を確認（SCR-016）
    alt 承諾する
        招待された人->>システム: 承諾を実行
        システム-->>管理者: メンバーとして一覧に表示
    else 期限切れ・辞退
        システム-->>招待された人: 承諾できない旨を表示
    end
```
