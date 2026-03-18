---
type: rdra-state-models
models:
  - id: "STATE-001"
    entity: "INFO-001"
    name: "予約ステータス"
    description: "予約エントリのライフサイクル。仮予約から承認済みへ遷移し、取り消し・却下・キャンセルで終了する。"
    states:
      - name: "仮予約"
        description: "団体が申請し、事務局の承認待ちの状態。"
      - name: "承認済み"
        description: "事務局が承認し、施設利用が確定した状態。"
      - name: "取り消し済み"
        description: "承認前に団体自身が取り消した状態。rejection_reasonは任意。"
      - name: "却下済み"
        description: "承認前に事務局が却下した状態。rejection_reasonは必須（COND-002）。"
      - name: "キャンセル済み"
        description: "承認後に団体がキャンセルした状態（cancelled）。rejection_reasonは任意。"
      - name: "事務局キャンセル済み"
        description: "承認後に事務局がキャンセルした状態（cancelled_by_staff）。rejection_reasonは必須（COND-002）。"
    transitions:
      - from: "[*]"
        to: "仮予約"
        trigger: "UC-002"
        condition: "同一施設・同一時間帯に承認済み予約が存在しないこと（COND-001）"
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
