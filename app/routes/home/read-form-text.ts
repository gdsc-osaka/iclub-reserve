/**
 * フォームの値を文字列で読む。無いときと、ファイルが送られてきたときは空文字にする。
 * 空文字の ID は、ユースケースが見つからない予約・招待として扱う。
 */
export const readFormText = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
