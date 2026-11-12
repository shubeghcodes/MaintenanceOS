import { Wrench } from "lucide-react";
import { Alert, Card, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { sendMagicLink, signIn } from "./actions";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  inactive: "Your account is inactive. Ask an admin to restore access.",
  link: "That sign-in link is invalid or expired. Request a new one.",
  email: "Enter your email address.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const error = sp.error ? ERRORS[sp.error] ?? sp.error : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <Wrench className="h-5 w-5 text-white" aria-hidden />
          </div>
          <span className="text-xl font-semibold">MaintainOS</span>
        </div>
        <Card className="p-6">
          <h1 className="mb-4 text-lg font-semibold">Sign in</h1>
          {error && <Alert>{error}</Alert>}
          {sp.sent && <Alert tone="good">Check your email for a sign-in link.</Alert>}
          <form action={signIn} className="space-y-4">
            <input type="hidden" name="next" value={sp.next ?? "/"} />
            <Field label="Email">
              <Input name="email" type="email" autoComplete="email" required />
            </Field>
            <Field label="Password" hint="Leave blank and use “Email me a link” if you don’t have one.">
              <Input name="password" type="password" autoComplete="current-password" />
            </Field>
            <div className="flex flex-col gap-2">
              <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
              <SubmitButton variant="secondary" pendingText="Sending…" formAction={sendMagicLink}>
                Email me a link
              </SubmitButton>
            </div>
          </form>
        </Card>
        <p className="mt-4 text-center text-xs text-slate-500">Access is by invitation. Contact your admin.</p>
      </div>
    </div>
  );
}
