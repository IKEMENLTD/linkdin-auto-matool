"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Mail, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  signInWithMagicLink,
  type SignInState,
} from "@/server/actions/auth";
import { INITIAL_SIGN_IN_STATE } from "@/lib/action-state";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" loading={pending}>
      {pending ? "送信中…" : "マジックリンクを送る"}
      {!pending && <ArrowRight className="size-4" aria-hidden />}
    </Button>
  );
}

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<SignInState, FormData>(
    signInWithMagicLink,
    INITIAL_SIGN_IN_STATE
  );

  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <label className="block">
        <span className="text-[12px] font-medium text-ink-700 [color:var(--color-ink-700)]">
          業務用メールアドレス
        </span>
        <div className="mt-1.5 relative">
          <Mail
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400 [color:var(--color-ink-400)]"
            aria-hidden
          />
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.co.jp"
            defaultValue={state.email ?? ""}
            aria-invalid={state.field === "email" ? true : undefined}
            aria-describedby={state.message ? "signin-message" : undefined}
            className="block w-full h-11 pl-9 pr-3 rounded-xl border border-[var(--color-ink-200)] bg-white text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-[var(--color-brand-500)] transition"
          />
        </div>
      </label>

      {state.message && (
        <div
          id="signin-message"
          role={state.ok ? "status" : "alert"}
          className={
            state.ok
              ? "flex items-start gap-2 text-[12px] rounded-xl border border-[#A7F3D0] bg-[var(--color-success-50)] text-[var(--color-success-700)] px-3 py-2"
              : "flex items-start gap-2 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2"
          }
        >
          {state.ok ? (
            <CheckCircle2 className="size-4 mt-0.5 shrink-0" aria-hidden />
          ) : (
            <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden />
          )}
          <span>{state.message}</span>
        </div>
      )}

      <SubmitButton />

      <p className="text-[11px] text-ink-500 [color:var(--color-ink-500)] leading-relaxed">
        送信ボタンを押すと、
        <a href="/legal/usage-policy" className="text-[var(--color-brand-700)] hover:underline">
          利用上の注意
        </a>
        および
        <a href="/legal/dpa" className="text-[var(--color-brand-700)] hover:underline">
          DPA
        </a>
        に同意したものとみなします。
      </p>
    </form>
  );
}
