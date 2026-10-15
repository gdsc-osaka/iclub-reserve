/*
 * i-Club 予約システムの Service Worker。方針は ADR-011（docs/adr/011-pwa.md）を参照。
 *
 * することは 1 つだけ: 電波が無くて画面を開けないとき、「つながっていません」の画面
 * （public/offline.html）を代わりに出す。
 *
 * 画面（HTML）・画面のデータ（.data）・認証の API・画像などは、一切キャッシュしない。
 * どれもログインしている人ごと・権限ごとに中身が変わり、予約の状態も事務局の操作で変わる。
 * 手元に写しを残すと、古い状態を見せたり、ログアウトした後や同じ端末を使う別の人に
 * 前の人の画面を見せたりしてしまう。
 *
 * この Service Worker は一度入ると利用者の端末に残り続ける。壊れた版を出すと
 * サーバー側を直しても治らないので、処理を増やすときは ADR-011 を読み直すこと。
 */

/**
 * オフラインの画面の写しを入れておく箱の名前。
 * offline.html を変えたら、末尾の版を上げる。上げると、新しい版を入れたときに古い箱を消す。
 */
const CACHE_NAME = "offline-v1";

/** 電波が無いときに出す画面。 */
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // ブラウザの HTTP キャッシュではなく、サーバーから最新のものを取り込む
      const response = await fetch(OFFLINE_URL, { cache: "reload" });
      if (!response.ok) {
        // 取り込めなければこの版を入れない（前の版がそのまま使われ続ける）
        throw new Error(`${OFFLINE_URL} を取り込めませんでした: ${response.status}`);
      }

      /*
       * 中身だけを詰め直してから入れる。
       * Workers の静的ファイルは /offline.html を /offline へ転送するので、受け取った応答は
       * 「転送を経た応答」になっている。それを画面の代わりにそのまま返すと、
       * ブラウザが受け付けずに読み込みが失敗する（net::ERR_FAILED）。
       */
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        OFFLINE_URL,
        new Response(await response.blob(), { headers: response.headers }),
      );
    })(),
  );
  // 新しい版を、開いているタブが閉じられるのを待たずに使い始める
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 前の版の箱を消す
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)),
      );

      // Service Worker が起き上がるのを待たずに、画面の取得を先に始めさせる。
      // 画面を開くたびに Service Worker を通るので、その分の待ち時間を消すため。
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  /*
   * 手を出すのは、画面そのものを開く GET だけ。
   * それ以外（画面内の移動で取る .data・フォームの送信・認証の API・画像など）は
   * 何もせずに返し、ブラウザにふつうに取りに行かせる。
   */
  if (request.mode !== "navigate" || request.method !== "GET") {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        // 先に始めておいた取得（navigation preload）があればそれを使う
        const preloaded = await event.preloadResponse;
        if (preloaded) {
          return preloaded;
        }
        return await fetch(request);
      } catch {
        // サーバーに届かなかった（電波が無いなど）ときだけ、オフラインの画面を出す。
        // サーバーが 500 などを返したときはここに来ず、その応答がそのまま出る。
        const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE_NAME });
        return offline ?? Response.error();
      }
    })(),
  );
});
