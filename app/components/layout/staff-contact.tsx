import { useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "~/root";

/**
 * 「事務局（窓口のアドレス）」と、宛先つきで事務局を指す文言。
 *
 * 「事務局にお問い合わせください」とだけ書くと、どこへ連絡すればよいか分からない。
 * アドレスは root の loader が設定（`STAFF_CONTACT_EMAIL`）から渡す。root の loader が読めていない画面
 * （root の ErrorBoundary など）では、アドレスを省いて「事務局」とだけ出す。
 */
export function StaffContact() {
  const data = useRouteLoaderData<typeof rootLoader>("root");
  if (data === undefined) return <>事務局</>;

  return (
    <>
      事務局（
      <a
        href={`mailto:${data.staffContactEmail}`}
        className="font-medium underline underline-offset-4"
      >
        {data.staffContactEmail}
      </a>
      ）
    </>
  );
}
