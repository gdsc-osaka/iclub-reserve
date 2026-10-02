/**
 * 画面から上げるファイルの見本。
 *
 * ファイルをリポジトリに置く代わりに、中身をここに書いておく。
 * `page.setInputFiles` にそのまま渡せる形にしてある。
 */

/**
 * 1×1 ピクセルの PNG 画像。施設の写真（UC-015）として上げる。
 *
 * アプリは拡張子ではなくファイルの先頭のバイト列で画像の形式を見分けるので、本物の PNG にしてある。
 */
export const tinyPng = {
  name: "e2e-photo.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
} as const;
