import { env } from "cloudflare:workers";
import type { LoaderFunctionArgs } from "react-router";

import { isFacilityPhotoName } from "~/domain/facility/facility-photo";
import { createR2FacilityPhotoStorage } from "~/infra/facility/r2-facility-photo-storage";
import { requireRequestUser } from "~/lib/auth/auth-session.server";

/**
 * 施設・設備写真の配信リソースルート（ADR-005）。
 *
 * 【設計上の配慮（ADR-005）】
 * 1. ログイン必須:
 *    `requireRequestUser` でログインセッションを確認する。未ログインのアクセスは拒否する。
 * 2. 形式検証（isFacilityPhotoName）:
 *    写真名が `^[a-z0-9]+\.(jpg|png|webp)$` に合致しない場合は R2 を引かずに 404 を返す。
 *    `../` 等によるパストラバーサルや他プレフィックス下のファイル読み出しを防ぐ。
 * 3. キャッシュ制御:
 *    - `private`: ログインユーザー限定のコンテンツであり、途中の共有キャッシュ（CDN）に残さない。
 *    - `immutable`, `max-age=31536000`: 写真の差し替え時は常に新しい写真名（CUID2）が発行されるため、
 *      同一 URL で内容が書き換わることはない。ブラウザに最長キャッシュさせ、再取得を防ぐ。
 * 4. ユースケースを挟まない理由:
 *    写真の取得・ストリーミングは純粋なストレージ読み取りであり、業務ルールの判定や不変条件の保護を
 *    伴うドメイン操作ではないため、ユースケース層を介さずアダプタを直接呼び出してよい。
 * 5. 汎用 `/media/*` ルートを作らない理由:
 *    画像の種類によって公開範囲や認可ルールが異なる（例: 団体のロゴは COND-011 による存在秘匿が
 *    必要な場合がある）。種類ごとにルートを分けることで、将来にわたって安全なアクセス制御を維持する。
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  requireRequestUser(context);

  const photoName = params.photoName;
  if (!photoName || !isFacilityPhotoName(photoName)) {
    throw new Response("Not Found", { status: 404 });
  }

  const storage = createR2FacilityPhotoStorage(env.MEDIA);
  const result = await storage.get(photoName);

  if (result.isErr() || result.value === null) {
    throw new Response("Not Found", { status: 404 });
  }

  return new Response(result.value.body, {
    status: 200,
    headers: {
      "Content-Type": result.value.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      ETag: result.value.etag,
    },
  });
}
