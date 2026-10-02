import { FacilityPhoto } from "~/components/facility/facility-photo";
import { cn } from "~/lib/utils";
import type { ReservationFormFacility } from "~/query/reservation/reservation-form";

/**
 * 選んでいる施設・設備の写真・名前・説明。PC のフォームの右側の先頭に置く。
 *
 * 施設は左側の Select で選ぶが、写真はこちらに出す。左側はタイムラインを
 * 縦に長く取りたく、写真を入れると夕方の枠が画面の下へ押し出されるため。
 * 右側は入力欄が少なく、下に余白がある。
 */
export function FacilityOverview({
  facility,
  className,
}: Readonly<{ facility: ReservationFormFacility; className?: string }>) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* 名前をすぐ下に書いているので、写真の代わりの文字は空にする */}
      <FacilityPhoto
        photoUrl={facility.photoUrl}
        alt=""
        className="aspect-[2/1] w-full rounded-lg"
      />

      <div className="flex flex-col gap-1">
        <p className="font-medium">{facility.name}</p>

        {facility.description !== null && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{facility.description}</p>
        )}
      </div>
    </div>
  );
}
