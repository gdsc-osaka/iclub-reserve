import type { ResultAsync } from "neverthrow";
import { errAsync } from "neverthrow";

import type { Facility, FacilityError, FacilityRepository } from "~/domain/facility";
import { FacilityErrorCode } from "~/domain/facility";

/** このユースケースが必要とする依存 */
export interface GetFacilityDeps {
  readonly facilityRepository: FacilityRepository;
}

/** このユースケースへの入力 */
export interface GetFacilityArgs {
  readonly facilityId: string;
}

/**
 * グループ ID を指定して、そのグループの情報を 1 件取得するユースケース。
 *
 * 依存 (リポジトリ) を引数で受け取る形にしているので、
 * テスト時には D1 を使わないダミーのリポジトリに差し替えられる。
 *
 * エラーは throw せず ResultAsync で返すため、
 * 呼び出し側は必ず成功・失敗の両方を処理することになる。
 *
 * NOTE: グループが存在しない場合に GROUP_NOT_FOUND を返すのは
 * リポジトリ側の責務なので、ここでは結果をそのまま伝播させる。
 */
export const getFacilityUseCase = (
  deps: GetFacilityDeps,
  args: GetFacilityArgs,
): ResultAsync<Facility, FacilityError> => {
  const id = args.facilityId.trim();

  // 空文字や空白だけの ID は DB へ問い合わせるまでもないので、ここで打ち切る
  if (id === "") {
    return errAsync({
      code: FacilityErrorCode.FacilityNotFound,
      message: "グループ ID が指定されていません。",
    });
  }

  return deps.facilityRepository.findById(id);
};
