import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { InvitationIntent } from "./invitation-intent";
import { InvitationRejectDialog } from "./invitation-reject-dialog";

/**
 * 招待の承諾画面（SCR-016 / SCR-020）で共通利用するカードコンポーネント。
 */
export function InvitationResponseCard({
  title,
  description,
  formError,
  acceptLabel,
  rejectDescription,
  children,
}: Readonly<{
  title: string;
  description: string;
  formError?: string | null;
  acceptLabel: string;
  rejectDescription: string;
  children: ReactNode;
}>) {
  const navigation = useNavigation();
  const isAccepting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === InvitationIntent.Accept;

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 md:py-16">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {formError && (
            <Alert variant="destructive">
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">{children}</div>
        </CardContent>

        <CardFooter className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <InvitationRejectDialog
            description={rejectDescription}
            trigger={
              <Button type="button" variant="outline" className="w-full sm:w-auto">
                辞退する
              </Button>
            }
          />

          <Form method="post" className="w-full sm:w-auto">
            <input type="hidden" name="intent" value={InvitationIntent.Accept} />
            <Button type="submit" disabled={isAccepting} className="w-full sm:w-auto">
              {isAccepting ? "処理中…" : acceptLabel}
            </Button>
          </Form>
        </CardFooter>
      </Card>
    </main>
  );
}
