import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Form } from "react-router";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { TERMS_OF_SERVICE } from "~/domain/authn/terms-of-service";

/**
 * この段階のカードの見出し。
 *
 * ほかの段階（`NAME_STEP_TITLE` など）と同じく、見出しはその段階のファイルが持つ。
 */
export const TERMS_STEP_TITLE = "利用規約への同意";
export const TERMS_STEP_DESCRIPTION =
  "i-Club の施設を予約するには、施設の使用規約への同意が必要です。内容をご確認ください。";

/** この段階のフォームを、ルートのアクションが見分けるための値 */
export const ACCEPT_TERMS_INTENT = "accept-terms";

/**
 * 利用規約に同意する段階（REQ-033）。
 *
 * 規約の本文は i-Club のホームページにある PDF なので、リンクで開いてもらう。
 * 同意の印を付けるまでは「同意して次へ」を押せない。
 *
 * お名前やパスキーの段階と違い、同意の記録はブラウザから Better Auth を呼ばずに、
 * この画面のアクションへフォームを送って行う。同意した日時と版はサーバーが決めて書き込む
 * 列で、ブラウザからは書き換えられないようにしてあるため（`terms_version`）。
 */
export function TermsStep({ pending }: Readonly<{ pending: boolean }>) {
  const [agreed, setAgreed] = useState(false);

  return (
    <Form method="post" className="space-y-5">
      <input type="hidden" name="intent" value={ACCEPT_TERMS_INTENT} />
      {/* 読んだ版を送り、画面を開いたまま改定された場合に、読んでいない版へ同意したことにしない */}
      <input type="hidden" name="termsVersion" value={TERMS_OF_SERVICE.version} />

      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>
          施設の使用目的・使用時間、使用後の清掃と原状回復、事故や損害の責任などを定めています。
        </p>
        <a
          href={TERMS_OF_SERVICE.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
        >
          {TERMS_OF_SERVICE.title}（PDF）
          <ExternalLink className="size-3.5" aria-hidden />
          <span className="sr-only">（新しいタブで開きます）</span>
        </a>
      </div>

      <div className="flex items-start gap-3">
        {/* 印を付けると、Radix の Checkbox がフォームへ agreed=on を送る */}
        <Checkbox
          id="agreed"
          name="agreed"
          checked={agreed}
          onCheckedChange={(checked) => setAgreed(checked === true)}
          disabled={pending}
          className="mt-0.5"
        />
        <Label htmlFor="agreed" className="leading-snug">
          「{TERMS_OF_SERVICE.title}」に同意します
        </Label>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending || !agreed}>
        {pending ? "送信中…" : "同意して次へ"}
      </Button>
    </Form>
  );
}
