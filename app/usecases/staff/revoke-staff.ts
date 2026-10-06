import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";
import {
  StaffAction,
  type StaffError,
  StaffErrorCode,
  type StaffMemberRepository,
  wouldRemoveLastStaff,
} from "~/domain/staff";
import { ensureStaffPermission } from "./_shared/staff-authorization";

export interface RevokeStaffDeps {
  readonly staffMemberRepository: StaffMemberRepository;
}

export interface RevokeStaffArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 剥奪する対象のユーザー ID */
  readonly targetUserId: string;
  readonly now: Date;
}

export interface RevokeStaffResult {
  readonly revokedSelf: boolean;
}

/**
 * 事務局権限を剥奪するユースケース（REQ-041 / UC-028 / COND-014）。
 *
 * 【最後の事務局の保護（COND-014）】
 * 事務局が 0 人になる剥奪は拒否する。
 * 事前の countStaff による確認だけでなく、revoke 更新文の条件にも入れて
 * 並行実行による 0 人化を防いでいる。
 *
 * 【自分自身の剥奪】
 * 他に事務局がいれば、自分自身の権限も剥奪できる。
 * その場合、戻り値の revokedSelf を true にして画面側でホームへリダイレクトできるようにする。
 */
export const revokeStaffUseCase = (
  deps: RevokeStaffDeps,
  args: RevokeStaffArgs,
): ResultAsync<RevokeStaffResult, StaffError> =>
  safeTry(async function* () {
    // 1. 認可判定
    yield* ensureStaffPermission({ isStaff: args.isStaff }, StaffAction.Revoke);

    // 2. 対象ユーザー ID の検証
    const targetUserId = args.targetUserId.trim();
    if (targetUserId === "") {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.InvalidInput,
        message: "剥奪対象のユーザー ID が空である。",
        userMessage: "対象のユーザーが指定されていません。",
      });
    }

    // 3. 対象ユーザーが事務局かどうかの確認
    const target = yield* deps.staffMemberRepository.findStaffById(targetUserId);
    if (target === null) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.MemberNotFound,
        message: `対象ユーザー ${targetUserId} は事務局ではない。`,
        // 一覧から選んだ相手なので、ここに来るのは画面を開いた後に剥奪された場合
        userMessage: "対象の方はすでに事務局ではありません。画面を読み込み直してください。",
      });
    }

    // 4. 最後の事務局の保護（事前確認）
    const staffCount = yield* deps.staffMemberRepository.countStaff();
    if (wouldRemoveLastStaff(staffCount)) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.LastStaffRequired,
        message: `事務局が ${staffCount} 人のため剥奪できない。`,
        userMessage:
          "事務局が 0 人になるため、剥奪できません。先に別の人を事務局に招待してください。",
      });
    }

    // 5. 剥奪の実行（条件付き UPDATE）
    const revokedCount = yield* deps.staffMemberRepository.revoke(targetUserId, args.now);
    if (revokedCount === 0) {
      return errAsync<never, StaffError>({
        code: StaffErrorCode.Conflict,
        message: `事務局 ${targetUserId} の剥奪文が 0 件を更新した。競合が発生した可能性がある。`,
        userMessage:
          "ほかの事務局の操作と重なったため、剥奪できませんでした。画面を読み込み直してください。",
      });
    }

    // 6. 自分自身を剥奪したかどうかの判定
    const revokedSelf = targetUserId === args.actorUserId;
    return okAsync({ revokedSelf });
  });
