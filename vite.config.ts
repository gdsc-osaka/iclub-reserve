import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    !process.env.VITEST && cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    server: {
      deps: {
        /*
         * better-auth は Node の ES モジュール解決では読み込めない依存
         * (@opentelemetry/semantic-conventions のディレクトリ import) を含む。
         * Vite に変換させると Node 形式の解決が使われて読み込めるようになる。
         */
        inline: [/better-auth/],
      },
    },
  },
});
