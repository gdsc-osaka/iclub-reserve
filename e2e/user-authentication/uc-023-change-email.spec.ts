import { eq } from "drizzle-orm";
import { session, verification } from "~/db/schema";
import { accountCard } from "../support/account.js";
import { otpIdentifier, readLatestOtp } from "../support/auth.js";
import { createSession, createUser, uniqueSuffix, UserAgents } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { findQueuedMails } from "../support/mail.js";
import { openPage } from "../support/page.js";

/**
 * UC-023 メールアドレスを変更する（`rdra/contexts/user-authentication.md`）
 *
 * 変更は 3 段階のダイアログ（SCR-017）で進む。
 * 1. 新しいアドレスを入れると、今のアドレスに認証コードが届く
 * 2. そのコードを入れると、新しいアドレスに認証コードが届く
 * 3. そのコードを入れると、変更が終わる
 * メールは読めないので、届いたはずの認証コードは DB から読む（`readLatestOtp`）。
 */
test.describe("UC-023 メールアドレスを変更する", { tag: "@UC-023" }, () => {
  test("2 つのアドレスで認証コードを確かめると変わり、前のアドレスへ通知が積まれ、ほかの端末はログアウトされる", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    const newEmail = `e2e-changed-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    // 前提: 同じ人が、ほかの端末でもログインしている
    const otherDevice = await createSession(db, {
      userId: user.id,
      userAgent: UserAgents.androidChrome,
    });
    await signInAs(user.id);

    await openPage(page, "/account");
    await accountCard(page, "メールアドレス").getByRole("button", { name: "変更" }).click();
    const dialog = page.getByRole("alertdialog");

    // 1. 新しいアドレスを入れる
    await dialog.getByLabel("新しいメールアドレス").fill(newEmail);
    await dialog.getByRole("button", { name: "次へ（認証コード送信）" }).click();

    // 2. 今のアドレスに届いた認証コードを入れる
    await expect(dialog.getByText("現在のアドレスでの確認 (2/3)")).toBeVisible();
    const currentCode = await readLatestOtp(db, otpIdentifier.emailVerification(user.email));
    expect(currentCode, "今のアドレスへの認証コードが DB に無い").not.toBeNull();
    await dialog.getByLabel("認証コード").fill(currentCode ?? "");
    await dialog.getByRole("button", { name: "次へ", exact: true }).click();

    // 3. 新しいアドレスに届いた認証コードを入れる
    await expect(dialog.getByText("新しいアドレスでの確認 (3/3)")).toBeVisible();
    const newCode = await readLatestOtp(db, otpIdentifier.changeEmail(user.email, newEmail));
    expect(newCode, "新しいアドレスへの認証コードが DB に無い").not.toBeNull();
    await dialog.getByLabel("認証コード").fill(newCode ?? "");
    await dialog.getByRole("button", { name: "変更を完了する" }).click();

    // 画面には新しいアドレスが出る
    await expect(page.getByText("メールアドレスを変更しました。")).toBeVisible();
    await expect(accountCard(page, "メールアドレス").getByText(newEmail)).toBeVisible();

    // 前のアドレスへ、変更の通知（EVT-016）が積まれている
    const mails = await findQueuedMails(db, user.email);
    expect(
      mails.filter((mail) => mail.subject.includes("メールアドレス変更完了のお知らせ")),
    ).toHaveLength(1);

    // ほかの端末のログインは終わり、変更に使ったこの端末のログインだけが残る（COND-018）
    const sessions = await db.select().from(session).where(eq(session.userId, user.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).not.toBe(otherDevice.id);
  });

  test("阪大以外のアドレスには変えられない", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    await signInAs(user.id);

    await openPage(page, "/account");
    await accountCard(page, "メールアドレス").getByRole("button", { name: "変更" }).click();
    const dialog = page.getByRole("alertdialog");

    await dialog.getByLabel("新しいメールアドレス").fill(`e2e-${uniqueSuffix()}@example.com`);
    await dialog.getByRole("button", { name: "次へ（認証コード送信）" }).click();

    // 使えるアドレスの案内が出て、次の段階へは進まない（COND-004）
    await expect(
      dialog.getByText("@osaka-u.ac.jp のメールアドレスを入力してください。"),
    ).toBeVisible();
    await expect(dialog.getByText("メールアドレスの変更 (1/3)")).toBeVisible();

    // 今のアドレスへも認証コードを送っていない
    const codes = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, otpIdentifier.emailVerification(user.email)));
    expect(codes).toHaveLength(0);
  });
});
