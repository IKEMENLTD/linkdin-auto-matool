"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/rate-limit";
import { getSession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

const SignInSchema = z.object({
  email: z
    .string({ required_error: "メールアドレスを入力してください" })
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(254)
    .email("メールアドレスの形式が正しくありません"),
  next: z.string().optional(),
});

import type { SignInState } from "@/lib/action-state";
export type { SignInState };

export async function signInWithMagicLink(
  _prev: SignInState | undefined,
  formData: FormData
): Promise<SignInState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") ?? undefined,
  });

  if (!parsed.success) {
    return {
      ok: false,
      field: "email",
      message: parsed.error.issues[0]?.message ?? "入力に誤りがあります",
      email: String(formData.get("email") ?? ""),
    };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limit = rateLimit(`signin:${ip}:${parsed.data.email}`, 5, 5 * 60_000);
  if (!limit.ok) {
    return {
      ok: false,
      field: "form",
      message: "送信が多すぎます。5 分後にもう一度お試しください。",
      email: parsed.data.email,
    };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const next = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/dashboard";
  const callback = `${baseUrl}/auth/callback?next=${encodeURIComponent(next)}`;

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { emailRedirectTo: callback, shouldCreateUser: true },
  });

  // 認証前 audit は ABAC 的に「メールから org_id を解決する」必要があり、
  // メール突合は §17 で禁止のため、ここでは記録しない。
  // 認証成功後、`/auth/callback` で session が成立した時点で audit に残す (Phase1 後段で実装)。
  if (error) {
    // 列挙攻撃を避けるため、エラー詳細は返さず汎用文言
    return {
      ok: false,
      field: "form",
      message: "メールを送信できませんでした。しばらくしてからもう一度お試しください。",
      email: parsed.data.email,
    };
  }

  return {
    ok: true,
    message: "サインイン用のリンクをメールでお送りしました。受信箱をご確認ください。",
    email: parsed.data.email,
  };
}

// INITIAL_SIGN_IN_STATE は lib/action-state.ts へ移動 (use server は async のみ export 可)

export async function signOut() {
  const session = await getSession();
  const supabase = await createSupabaseServer();
  if (session) {
    try {
      await writeAudit({
        orgId: session.orgId,
        actorUserId: session.userId,
        action: "auth.signout",
        targetType: "user",
        targetId: session.userId,
      });
    } catch {}
  }
  await supabase.auth.signOut();
  redirect("/login");
}
