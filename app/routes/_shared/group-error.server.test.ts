import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupErrorCode, GroupField, type GroupError } from "~/domain/group";

import {
  groupActionErrors,
  groupErrorResponse,
  invitationActionErrors,
  invitationErrorResponse,
} from "./group-error.server";

const context = { where: "groups.detail.test", userId: "usr_01" };

const errorOf = (code: GroupErrorCode, extra: Partial<GroupError> = {}): GroupError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

/** 投げられた応答を取り出す。投げられなければテストを落とす */
const thrownBy = (run: () => unknown) => {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  throw new Error("投げられなかった");
};

beforeEach(() => {
  // ログの中身は個別のテストで確かめる。ここでは出力を黙らせるだけ
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("COND-011: 見られない団体は、無い団体と同じ応答になる", () => {
  it("loader の応答（status と中身）が NotFound と同一になる", () => {
    const notVisible = groupErrorResponse(context, errorOf(GroupErrorCode.NotVisible));
    const notFound = groupErrorResponse(context, errorOf(GroupErrorCode.NotFound));

    expect(notVisible.init?.status).toBe(404);
    expect(notVisible).toEqual(notFound);
  });

  it("action でも NotFound と同一の 404 を投げる", () => {
    const notVisible = thrownBy(() =>
      groupActionErrors(context, errorOf(GroupErrorCode.NotVisible), {
        [GroupField.Name]: "nameError",
      }),
    );
    const notFound = thrownBy(() =>
      groupActionErrors(context, errorOf(GroupErrorCode.NotFound), {
        [GroupField.Name]: "nameError",
      }),
    );

    // action だけ 200 を返すと、応答の違いから団体の有無を推測できてしまう
    expect(notVisible).toEqual(groupErrorResponse(context, errorOf(GroupErrorCode.NotFound)));
    expect(notVisible).toEqual(notFound);
  });

  it("NotVisible に userMessage が付いていても、応答には出ない", () => {
    // 「見られない理由」を誰かが書いてしまっても、秘匿が崩れないこと
    const leaked = groupErrorResponse(
      context,
      errorOf(GroupErrorCode.NotVisible, { userMessage: "この団体に所属していません。" }),
    );

    expect(leaked).toEqual(groupErrorResponse(context, errorOf(GroupErrorCode.NotFound)));
  });

  it("ログには秘匿せず、NotVisible として warn で残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    groupErrorResponse(context, errorOf(GroupErrorCode.NotVisible));

    // 秘匿が要るのは外部への応答で、サーバーのログではない（ADR-004 決定 4）
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        code: "GROUP_NOT_VISIBLE",
        kind: "forbidden",
        userId: "usr_01",
      }),
    );
  });
});

describe("groupErrorResponse", () => {
  it("DB の失敗は 500 で、内部の事情を応答に出さない", () => {
    const response = groupErrorResponse(
      context,
      errorOf(GroupErrorCode.DatabaseError, { message: "D1_ERROR: no such table" }),
    );

    expect(response.init?.status).toBe(500);
    expect(JSON.stringify(response.data)).not.toContain("D1_ERROR");
  });

  it("DB の失敗は error で、元の例外ごとログに残る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connection reset");

    groupErrorResponse(context, errorOf(GroupErrorCode.DatabaseError, { cause }));

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        where: "groups.detail.test",
        code: "DATABASE_ERROR",
        cause: expect.objectContaining({ message: "connection reset", stack: cause.stack }),
      }),
    );
  });
});

describe("groupActionErrors", () => {
  it("入力の誤りは、項目に対応する欄の下に userMessage を出す", () => {
    const errors = groupActionErrors(
      context,
      errorOf(GroupErrorCode.InvalidInput, {
        field: GroupField.Name,
        userMessage: "団体名を入力してください。",
      }),
      { [GroupField.Name]: "nameError" },
    );

    expect(errors).toEqual({ nameError: "団体名を入力してください。", formError: null });
  });

  it("欄の表に載っていない項目の誤りは、フォームの上に出す", () => {
    // 招待フォームの役割は選択肢なので欄の下に出す先が無い。メールアドレス欄の下に出してはいけない
    const errors = groupActionErrors(
      context,
      errorOf(GroupErrorCode.InvalidInput, {
        field: GroupField.MemberRole,
        userMessage: "指定できない役割です。",
      }),
      { [GroupField.InviteeEmail]: "emailError" },
    );

    expect(errors).toEqual({ emailError: null, formError: "指定できない役割です。" });
  });

  it("欄の表を渡さない画面では、すべてフォームの上に出す", () => {
    const errors = groupActionErrors(
      context,
      errorOf(GroupErrorCode.Forbidden, {
        userMessage: "メンバーを削除できるのは管理者と事務局だけです。",
      }),
    );

    expect(errors).toEqual({ formError: "メンバーを削除できるのは管理者と事務局だけです。" });
  });

  it("userMessage が無いときは、表の文言を出す", () => {
    const errors = groupActionErrors(context, errorOf(GroupErrorCode.InvalidInput));

    expect(errors.formError).toBe("入力内容を確認してください。");
  });

  it("DB の失敗は、userMessage を持っていても表の汎用文言を出す", () => {
    // internal の失敗の文言は、内部の事情がにじむ恐れがあるので画面に通さない
    const errors = groupActionErrors(
      context,
      errorOf(GroupErrorCode.DatabaseError, { userMessage: "D1 に接続できませんでした。" }),
    );

    expect(errors.formError).toBe("保存できませんでした。時間をおいて、もう一度お試しください。");
  });

  it.each([
    GroupErrorCode.MemberNotFound,
    GroupErrorCode.InvitationNotFound,
    GroupErrorCode.InvitationNotVisible,
    GroupErrorCode.InvalidTransition,
  ])("%s は画面ごと差し替えず、フォームの上に読み込み直しの案内を出す", (code) => {
    // URL が指す団体はあるので、404 にしてはいけない。フォームで指したものが無くなっただけ
    const errors = groupActionErrors(context, errorOf(code));

    expect(errors.formError).toContain("画面を読み込み直してください。");
  });

  it.each([
    [GroupErrorCode.InvalidInput, "info"],
    [GroupErrorCode.LastAdminRequired, "info"],
    [GroupErrorCode.InvalidTransition, "info"],
    [GroupErrorCode.MemberNotFound, "info"],
    [GroupErrorCode.Forbidden, "warn"],
    [GroupErrorCode.DatabaseError, "error"],
  ] as const)("%s は %s でログに残る（残さないという選択肢は無い）", (code, level) => {
    const spy = vi.spyOn(console, level).mockImplementation(() => {});

    groupActionErrors(context, errorOf(code));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ level, code, userId: "usr_01" }));
  });

  it("404 を投げるときも、ログは 1 回だけ残す", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    thrownBy(() => groupActionErrors(context, errorOf(GroupErrorCode.NotVisible)));

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("COND-011: 宛先が本人ではない招待は、無い招待と同じ応答になる（招待の承諾画面 SCR-016）", () => {
  it("loader の応答（status と中身）が InvitationNotFound と同一になる", () => {
    const notVisible = invitationErrorResponse(
      context,
      errorOf(GroupErrorCode.InvitationNotVisible),
    );
    const notFound = invitationErrorResponse(context, errorOf(GroupErrorCode.InvitationNotFound));

    expect(notVisible.init?.status).toBe(404);
    expect(notVisible).toEqual(notFound);
  });

  it("action でも InvitationNotFound と同一の 404 を投げる", () => {
    const notVisible = thrownBy(() =>
      invitationActionErrors(context, errorOf(GroupErrorCode.InvitationNotVisible)),
    );
    const notFound = thrownBy(() =>
      invitationActionErrors(context, errorOf(GroupErrorCode.InvitationNotFound)),
    );

    // action だけ 200 を返すと、応答の違いから招待の有無を推測できてしまう
    expect(notVisible).toEqual(
      invitationErrorResponse(context, errorOf(GroupErrorCode.InvitationNotFound)),
    );
    expect(notVisible).toEqual(notFound);
  });

  it("InvitationNotVisible に userMessage が付いていても、応答には出ない", () => {
    // 「宛先が違う」と誰かが書いてしまっても、秘匿が崩れないこと
    const leaked = invitationErrorResponse(
      context,
      errorOf(GroupErrorCode.InvitationNotVisible, {
        userMessage: "この招待は別のメールアドレス宛てです。",
      }),
    );

    expect(leaked).toEqual(
      invitationErrorResponse(context, errorOf(GroupErrorCode.InvitationNotFound)),
    );
  });

  it("ログには秘匿せず、InvitationNotVisible として warn で残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    invitationErrorResponse(context, errorOf(GroupErrorCode.InvitationNotVisible));

    // 秘匿が要るのは外部への応答で、サーバーのログではない（ADR-004 決定 4）
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        code: "INVITATION_NOT_VISIBLE",
        kind: "forbidden",
        userId: "usr_01",
      }),
    );
  });

  it("団体の画面（SCR-007）と違い、招待が無いときは画面ごと 404 にする", () => {
    // この画面では招待が URL の指すものなので、読み込み直しの案内を出す先の画面が無い
    const thrown = thrownBy(() =>
      invitationActionErrors(context, errorOf(GroupErrorCode.InvitationNotFound)),
    );

    expect(thrown).toEqual(expect.objectContaining({ init: { status: 404 } }));
  });

  it("DB の失敗は、フォームの上に表の汎用文言を出す", () => {
    const errors = invitationActionErrors(
      context,
      errorOf(GroupErrorCode.DatabaseError, { message: "D1_ERROR: no such table" }),
    );

    expect(errors).toEqual({
      formError: "保存できませんでした。時間をおいて、もう一度お試しください。",
    });
  });
});
