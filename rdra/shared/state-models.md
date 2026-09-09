---
type: rdra-state-models
models:
  - id: "STATE-001"
    entity: "INFO-001"
    name: "予約ステータス"
    description: "予約エントリのライフサイクル。仮予約から承認済みへ遷移し、取り消し・却下・キャンセルで終了する。"
    states:
      - name: "仮予約"
        status_value: "provisional"
        description: "団体が申請し、事務局の承認待ちの状態。"
      - name: "承認済み"
        status_value: "approved"
        description: "事務局が承認し、施設利用が確定した状態。"
      - name: "取り消し済み"
        status_value: "withdrawn"
        description: "承認前に団体自身が取り消した状態。status_reasonは任意。"
      - name: "却下済み"
        status_value: "rejected"
        description: "承認前に事務局が却下した状態。status_reasonは必須（COND-002）。"
      - name: "キャンセル済み"
        status_value: "cancelled"
        description: "承認後に団体がキャンセルした状態。status_reasonは任意。"
      - name: "事務局キャンセル済み"
        status_value: "cancelled_by_staff"
        description: "承認後に事務局がキャンセルした状態。status_reasonは必須（COND-002）。"
    transitions:
      - from: "[*]"
        to: "仮予約"
        trigger: "UC-002"
        condition: "同一施設・同一時間帯に承認済み予約が存在しないこと（COND-001）。かつ申請元の団体が有効（enabled）であること（COND-006）"
      - from: "[*]"
        to: "承認済み"
        trigger: "UC-008（事務局直接作成）"
        condition: "COND-001: 同一施設・同一時間帯に承認済み予約が存在しないこと。仮予約ステータスを経由せず即時承認済みになる。"
      - from: "仮予約"
        to: "承認済み"
        trigger: "UC-006"
        condition: "COND-001: 同一施設・同一時間帯に承認済み予約が存在しないこと"
      - from: "仮予約"
        to: "取り消し済み"
        trigger: "UC-003（団体による取り消し）"
        condition: null
      - from: "仮予約"
        to: "却下済み"
        trigger: "UC-006（事務局による却下）"
        condition: "COND-002: 却下理由の入力が必須"
      - from: "承認済み"
        to: "キャンセル済み"
        trigger: "UC-004（団体によるキャンセル）"
        condition: null
      - from: "承認済み"
        to: "事務局キャンセル済み"
        trigger: "UC-007（事務局によるキャンセル）"
        condition: "COND-002: キャンセル理由の入力が必須"
      - from: "承認済み"
        to: "仮予約"
        trigger: "UC-005（施設・日時の変更）"
        condition: "COND-005 / COND-001: 施設・日時変更時のみ。変更後の時間帯に承認済み予約が存在しないこと"
    traces_to: ["UC-002", "UC-003", "UC-004", "UC-005", "UC-006", "UC-007", "UC-008"]

  - id: "STATE-002"
    entity: "INFO-003"
    name: "団体ステータス"
    description: "団体アカウントのライフサイクル。作成直後は承認待ちで、事務局が有効化して初めて予約を申請できる。削除はせず、無効化で終える。"
    states:
      - name: "承認待ち"
        status_value: "pending"
        description: "作成された直後の状態。事務局の有効化を待っている。予約は申請できない（COND-006）。"
      - name: "有効"
        status_value: "enabled"
        description: "事務局が有効化した状態。予約を申請できる。"
      - name: "無効"
        status_value: "disabled"
        description: "事務局が無効化した状態。予約を申請できない。既存の予約と過去の利用記録は残る。"
    transitions:
      - from: "[*]"
        to: "承認待ち"
        trigger: "UC-010（団体の新規作成）"
        condition: "作成者が初期の管理者になる（REQ-016）"
      - from: "承認待ち"
        to: "有効"
        trigger: "UC-014（事務局が有効化）"
        condition: "事務局のみ実行できる（COND-009）"
      - from: "承認待ち"
        to: "無効"
        trigger: "UC-014（事務局が承認せず無効化）"
        condition: "事務局のみ実行できる（COND-009）"
      - from: "有効"
        to: "無効"
        trigger: "UC-014（事務局が無効化）"
        condition: "事務局のみ実行できる（COND-009）"
      - from: "無効"
        to: "有効"
        trigger: "UC-014（事務局が再度有効化）"
        condition: "事務局のみ実行できる（COND-009）"
    traces_to: ["UC-010", "UC-014"]
---

# 状態モデル（横断）

## STATE-001: 予約ステータス

```mermaid
stateDiagram-v2
    [*] --> 仮予約 : 申請 [UC-002]
    [*] --> 承認済み : 事務局直接作成 [UC-008]
    仮予約 --> 承認済み : 事務局が承認 [UC-006]
    仮予約 --> 取り消し済み : 団体が取り消し [UC-003]
    仮予約 --> 却下済み : 事務局が却下（理由必須）[UC-006]
    承認済み --> キャンセル済み : 団体がキャンセル [UC-004]
    承認済み --> 事務局キャンセル済み : 事務局がキャンセル（理由必須）[UC-007]
    承認済み --> 仮予約 : 施設・日時を変更 [UC-005]
    取り消し済み --> [*]
    却下済み --> [*]
    キャンセル済み --> [*]
    事務局キャンセル済み --> [*]
```

## STATE-002: 団体ステータス

```mermaid
stateDiagram-v2
    [*] --> 承認待ち : 団体を作成 [UC-010]
    承認待ち --> 有効 : 事務局が有効化 [UC-014]
    承認待ち --> 無効 : 事務局が無効化 [UC-014]
    有効 --> 無効 : 事務局が無効化 [UC-014]
    無効 --> 有効 : 事務局が再度有効化 [UC-014]
```

予約を申請できるのは「有効」の団体だけである（COND-006）。団体を削除する遷移は用意しない。予約が紐づく団体を消すと、過去に誰がいつ利用したかをたどれなくなるためである（GOAL-001）。
