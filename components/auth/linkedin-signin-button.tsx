"use client";

import * as React from "react";
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { createSupabaseBrowser } from "@/lib/supabase/client";

/**
 * "Sign in with LinkedIn" ボタン。
 *
 * Supabase Auth の OAuth provider `linkedin_oidc` を利用する。Client ID / Secret は
 * Supabase ダッシュボード側に登録するため、コードに credentials は持たない。
 *
 * フロー:
 *   1. ボタン押下 → supabase.auth.signInWithOAuth({ provider: "linkedin_oidc", ... })
 *   2. Supabase が LinkedIn OAuth 2.0 / OIDC 認可エンドポイントへリダイレクト
 *      (https://www.linkedin.com/oauth/v2/authorization)
 *   3. ユーザ承認後、Supabase コールバックを経由してアプリの /auth/callback に戻る
 *   4. /auth/callback ハンドラ (app/auth/callback/route.ts) が
 *      `?code=` を `exchangeCodeForSession` でセッションに交換し /dashboard へ
 */

// ===== Boundary validation =====
// `next` は同一 origin の path のみ許可。Open Redirect 防止。
const NextPathSchema = z
  .string()
  .startsWith("/")
  .refine((v) => !v.startsWith("//"), "protocol-relative path is not allowed")
  .max(2048);

function safeNextPath(input: string | undefined): string {
  if (!input) return "/dashboard";
  const parsed = NextPathSchema.safeParse(input);
  return parsed.success ? parsed.data : "/dashboard";
}

function buildRedirectTo(next: string): string {
  // 環境変数 NEXT_PUBLIC_APP_URL を優先。ブラウザ環境では window.location.origin で
  // フォールバック (Preview / Vercel deploy URL での動作担保)。
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const qs = new URLSearchParams({ next }).toString();
  return `${base}/auth/callback?${qs}`;
}

// ===== LinkedIn ロゴ (Simple Icons SVG path) =====
function LinkedInLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path
        fill="currentColor"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.852 3.37-1.852 3.602 0 4.267 2.37 4.267 5.455v6.288zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.778 13.019H3.555V9h3.56v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
      />
    </svg>
  );
}

// ===== Component =====
export interface LinkedinSigninButtonProps {
  next?: string;
  className?: string;
}

export function LinkedinSigninButton({ next, className }: LinkedinSigninButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setLoading(true);
    try {
      const supabase = createSupabaseBrowser();
      const safeNext = safeNextPath(next);
      const redirectTo = buildRedirectTo(safeNext);

      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "linkedin_oidc",
        options: {
          redirectTo,
          // PKCE は Supabase JS デフォルト。OIDC scope は provider 側設定で
          // openid / profile / email が付与される (Supabase ダッシュボードで構成)。
        },
      });

      if (oauthError) {
        // ここでは Supabase からのエラー詳細はユーザに見せず汎用文言。
        // 列挙攻撃 / プロバイダ詳細露出を回避。
        setError("LinkedIn でサインインを開始できませんでした。時間をおいて再度お試しください。");
        setLoading(false);
        return;
      }
      // 成功時は Supabase が自動で window.location を LinkedIn の認可 URL に書き換える。
      // ここでローディング解除はしない (リダイレクトが入るため)。
    } catch {
      setError("予期せぬエラーが発生しました。時間をおいて再度お試しください。");
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        aria-label="LinkedIn でサインイン"
        className={cn(
          // shadcn 互換: rounded-full, h-12 = lg サイズと揃える
          "relative inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-full",
          "h-12 px-6 text-base font-medium",
          "bg-white text-ink-900 [color:var(--color-ink-900)]",
          "border border-[var(--color-ink-200)]",
          "transition-[transform,box-shadow,border-color,background-color] duration-200 ease-[var(--ease-glide)]",
          // LinkedIn blue を hover の差し色として使う (常時着色は避け、白背景を維持)
          "hover:-translate-y-px hover:border-[#0A66C2] hover:bg-[#F3F8FC]",
          "active:translate-y-0",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A66C2] focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        {loading ? (
          <span
            aria-hidden
            className="size-4 rounded-full border-2 border-current border-r-transparent animate-spin"
          />
        ) : (
          <LinkedInLogo className="size-5 text-[#0A66C2]" />
        )}
        <span>{loading ? "リダイレクト中…" : "LinkedIn でサインイン"}</span>
      </button>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2"
        >
          <AlertCircle className="size-4 mt-0.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
