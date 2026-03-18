import { useState } from "react";
import type { EmailPreview } from "~/lib/email";

interface Props {
  emails: EmailPreview[];
}

/**
 * デモ用: 送信されるはずのメールを画面上に表示するモーダル。
 * RESEND_API_KEY が未設定の場合にアクション結果として渡される。
 */
export function EmailPreviewModal({ emails }: Props) {
  const [open, setOpen] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);

  if (!open || emails.length === 0) return null;

  const email = emails[activeIdx];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* ヘッダー */}
        <div className="flex items-center justify-between bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 text-lg">✉️</span>
            <span className="font-semibold text-amber-800 text-sm">
              デモ: メール送信プレビュー
            </span>
            {emails.length > 1 && (
              <span className="text-xs bg-amber-200 text-amber-700 px-1.5 py-0.5 rounded-full">
                {emails.length} 件
              </span>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-amber-500 hover:text-amber-700 text-lg leading-none"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {/* 複数メールのタブ */}
        {emails.length > 1 && (
          <div className="flex border-b border-gray-200 bg-gray-50">
            {emails.map((e, i) => (
              <button
                key={i}
                onClick={() => setActiveIdx(i)}
                className={`px-3 py-2 text-xs border-b-2 transition-colors ${
                  i === activeIdx
                    ? "border-blue-500 text-blue-600 font-medium"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {i + 1}. {e.to.split("@")[0]}@…
              </button>
            ))}
          </div>
        )}

        {/* メール内容 */}
        <div className="p-4 space-y-3">
          <dl className="text-sm space-y-1">
            <div className="flex gap-2">
              <dt className="text-gray-400 w-12 shrink-0">宛先</dt>
              <dd className="font-medium text-gray-800">{email.to}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-gray-400 w-12 shrink-0">件名</dt>
              <dd className="font-medium text-gray-800">{email.subject}</dd>
            </div>
          </dl>
          <div className="border-t border-gray-100 pt-3">
            <div
              className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded p-3 max-h-52 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: email.body }}
            />
          </div>
        </div>

        <div className="px-4 pb-4 flex justify-end">
          <button
            onClick={() => setOpen(false)}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded hover:bg-gray-700 transition-colors"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
