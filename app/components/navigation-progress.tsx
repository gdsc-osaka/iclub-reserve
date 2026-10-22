import { cn } from "cn";
import { useEffect, useState } from "react";
import { useNavigation } from "react-router";

/**
 * バーの状態。
 * - `hidden`: 出していない
 * - `running`: 遷移の途中。少しずつ伸ばしている
 * - `done`: 遷移が終わった。100% まで伸ばし、薄くしながら消している
 */
type Phase = "hidden" | "running" | "done";

/**
 * 遷移が始まってからバーを出すまでの待ち時間（ミリ秒）。
 * これより早く終わる遷移でバーを出すと、一瞬だけ光ってちらついて見えるので出さない。
 */
const SHOW_DELAY_MS = 150;

/**
 * `done` にしてから `hidden` に戻すまでの時間（ミリ秒）。
 * 下の className で決めている「100% まで伸ばす（200ms）」と
 * 「薄くする（150ms 待ってから 300ms）」が終わるのを待つ長さにしておく。
 */
const FINISH_MS = 500;

/**
 * 画面を移るあいだ、画面の上端に出す細いローディングのバー。
 *
 * root（`app/root.tsx`）の `App` に 1 つだけ置けば、すべての画面で出る。
 * root にローダーがあるので、画面内の遷移は必ず「読み込み中（loading）」を通るため。
 *
 * 本当の進み具合（あと何 % か）はブラウザから分からないので、
 * 遷移の段階ごとに目安の幅まで伸ばして、進んでいるように見せている。
 * - 送信中（submitting）: 1/3 まで
 * - 読み込み中（loading）: 4/5 まで、ゆっくり
 * - 終わった（idle に戻った）: 100% まで伸ばして消す
 *
 * `useFetcher` での操作（既読にする・メッセージを送るなど）では出ない。
 * fetcher は画面を移らず、`useNavigation()` の state を変えないため。
 */
export function NavigationProgress() {
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";
  const [phase, setPhase] = useState<Phase>("hidden");

  /*
   * 遷移が始まったら、少し待ってからバーを出す。
   * 待っているあいだに遷移が終われば、下の後片付け（clearTimeout）でタイマーごと取り消すので、
   * 早く終わる遷移ではバーが出ない。
   */
  useEffect(() => {
    if (isNavigating) {
      // 前の遷移のバーがまだ消えかけていたら、いったん消してから出し直す。
      // そのままだと 100% の位置から 4/5 へ、バーが後ろ向きに縮んで見える
      setPhase((current) => (current === "done" ? "hidden" : current));
      const timer = setTimeout(() => setPhase("running"), SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }

    // 遷移が終わった。バーを出していたときだけ、最後まで伸ばして消す
    setPhase((current) => (current === "running" ? "done" : current));
  }, [isNavigating]);

  // 消し終わるのを待ってから、出していない状態に戻す
  useEffect(() => {
    if (phase !== "done") {
      return;
    }
    const timer = setTimeout(() => setPhase("hidden"), FINISH_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div
      /*
       * 進み具合が分からないので aria-valuenow は付けない
       * （付けないと「どれだけ進んだか分からない」進捗バーとして読み上げられる）。
       * 読み込みが終わったあと（done）は、消えかけていても読み込み中ではないので隠す。
       */
      role="progressbar"
      aria-label="読み込み中"
      aria-hidden={phase !== "running"}
      className={cn(
        // pointer-events-none: 上端のボタンやリンクを押すのを邪魔しない
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5",
        "transition-opacity duration-300 motion-reduce:transition-none",
        phase === "running" ? "opacity-100" : "opacity-0",
        // 終わったときは、先に 100% まで伸ばしてから薄くし始める
        phase === "done" && "delay-150",
      )}
    >
      <div
        className={cn(
          "h-full bg-primary transition-[width] ease-out motion-reduce:transition-none",
          phase === "hidden" && "w-0 transition-none",
          // 目安の幅までゆっくり伸ばす。ease-out なので、はじめは速く、だんだん遅くなる
          phase === "running" && "duration-5000",
          phase === "running" && (navigation.state === "submitting" ? "w-1/3" : "w-4/5"),
          phase === "done" && "w-full duration-200",
        )}
      />
    </div>
  );
}
