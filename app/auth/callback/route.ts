import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Supabase Auth (Magic Link / OAuth) のコールバック。
 * PKCE: code を session に交換し、`next` クエリへ戻す。
 * Open Redirect 対策で next は同一 origin の path のみ許可。
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const nextRaw = url.searchParams.get("next") ?? "/dashboard";

  // 同一 origin の path のみ許可 (// から始まる protocol-relative も拒否)
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/dashboard";

  if (code) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failed = url.clone();
      failed.pathname = "/login";
      failed.search = `?error=${encodeURIComponent("auth_callback_failed")}`;
      return NextResponse.redirect(failed);
    }
  }

  const dest = url.clone();
  dest.pathname = next;
  dest.search = "";
  return NextResponse.redirect(dest);
}
