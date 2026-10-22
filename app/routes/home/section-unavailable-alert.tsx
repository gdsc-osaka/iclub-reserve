import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";

/**
 * ダッシュボードの区画を読み込めなかったときの案内。
 *
 * loader は区画ごとに読み、読めなかった区画だけをこの案内にして、ほかの区画はそのまま出す。
 * 問い合わせ先は、事務局の人が見る区画ではシステム管理者、それ以外では事務局にする。
 */
export function SectionUnavailableAlert({
  what,
  forStaff = false,
}: Readonly<{
  /** 読み込めなかったもの（「今後の予約」など） */
  what: string;
  /** 事務局の人が見る区画か */
  forStaff?: boolean;
}>) {
  const contact = forStaff ? "システム管理者" : "事務局";
  return (
    <Alert variant="destructive">
      <AlertTitle>{what}を読み込めませんでした</AlertTitle>
      <AlertDescription>
        時間をおいて、画面を再読み込みしてください。 繰り返し表示される場合は{contact}
        にご連絡ください。
      </AlertDescription>
    </Alert>
  );
}
