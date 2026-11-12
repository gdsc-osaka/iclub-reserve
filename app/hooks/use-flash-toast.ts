import { useEffect } from "react";
import { toast } from "sonner";

import type { FlashToast } from "~/lib/flash-toast";

/**
 * root の loader から渡された知らせを、トーストで 1 回だけ出す。
 *
 * id を渡すのは、開発中の StrictMode で effect が 2 回動いても、
 * sonner が同じ id のトーストを 1 つにまとめるため。
 */
export const useFlashToast = (flash: FlashToast | null): void => {
  useEffect(() => {
    if (!flash) return;

    toast.success(flash.title, {
      id: flash.id,
      description: flash.description,
    });
  }, [flash]);
};
