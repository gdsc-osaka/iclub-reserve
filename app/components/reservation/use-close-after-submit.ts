import { useEffect, useRef } from "react";

/**
 * 送信が終わったら、ダイアログを自分で閉じるためのフック。
 *
 * 開閉は open の state だけで決まるので、閉じる処理を書かないと送信後も開いたままになる。
 * 成功したときは予約の状態が変わって出せる操作も変わり、このダイアログごと画面から
 * 消えるので気付きにくい。問題になるのは失敗したときで、予約の状態は変わらないため
 * 同じダイアログが開いたまま残り、一覧の上に出したエラーがその背後に隠れて読めない。
 *
 * 「送信中になった」ことを覚えておき、それが終わった瞬間に閉じる。
 * 成功・失敗のどちらでも閉じてよい（結果は画面側に反映される）。
 */
export function useCloseAfterSubmit(isSubmitting: boolean, onClose: () => void) {
  const hasSubmittedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (hasSubmittedRef.current) {
      hasSubmittedRef.current = false;
      onCloseRef.current();
    }
  }, [isSubmitting]);
}
