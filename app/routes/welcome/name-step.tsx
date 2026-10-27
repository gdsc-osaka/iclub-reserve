import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

/**
 * この段階のカードの見出し。
 *
 * パスキーの段階（`PASSKEY_STEP_TITLE`）と同じく、見出しはその段階のファイルが持つ。
 * 呼び出し元に書き並べると、段階を足したときに直す場所が 2 か所に増える。
 */
export const NAME_STEP_TITLE = "氏名の登録";
export const NAME_STEP_DESCRIPTION =
  "ようこそ。予約の画面などに表示される氏名を登録してください。事務局が利用者を確かめられるよう、ニックネームではなく本名を入力してください。";

/**
 * お名前を入力する段階。
 *
 * 入力中の値は呼び出し元が持つ。登録が終わってから次の段階へ進むかどうかは
 * 呼び出し元しか決められず、状態を分けて持つと食い違うため。
 */
export function NameStep({
  name,
  onNameChange,
  pending,
  onSubmit,
}: Readonly<{
  name: string;
  onNameChange: (name: string) => void;
  pending: boolean;
  onSubmit: () => void;
}>) {
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="name">氏名（本名）</Label>
        <Input
          id="name"
          type="text"
          autoComplete="name"
          placeholder="大阪 太郎"
          required
          autoFocus
          disabled={pending}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending || name.trim() === ""}>
        {pending ? "登録中…" : "登録して次へ"}
      </Button>
    </form>
  );
}
