import { Logo } from "@/components/brand/logo";
import { SignInForm } from "@/components/auth/sign-in-form";
import { LinkedinSigninButton } from "@/components/auth/linkedin-signin-button";
import { ShieldCheck, Eye } from "lucide-react";

export const metadata = { title: "サインイン" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="hydro-canvas min-h-screen grid lg:grid-cols-2">
      <div className="flex flex-col px-8 lg:px-16 py-10">
        <Logo />

        <main className="flex-1 flex items-center">
          <div className="w-full max-w-[400px]">
            <div className="mb-8">
              <div className="text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)] mb-3">
                Sign in
              </div>
              <h1 className="font-display text-[36px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.05] mb-3">
                安全に、丁寧に、
                <br />
                <span className="text-[var(--color-brand-600)]">送り出す。</span>
              </h1>
              <p className="text-[14px] text-ink-600 [color:var(--color-ink-600)] leading-relaxed">
                日本語 B2B に最適化された LinkedIn 自動営業 SaaS。マジックリンクでサインインしてください。
              </p>
            </div>

            {error === "auth_callback_failed" && (
              <div
                role="alert"
                className="mb-3 text-[12px] rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)] text-[var(--color-danger-700)] px-3 py-2"
              >
                サインインに失敗しました。リンクの有効期限が切れている可能性があります。もう一度お試しください。
              </div>
            )}

            <SignInForm next={next} />

            <div
              className="my-5 flex items-center gap-3 text-[11px] font-medium tracking-[0.18em] uppercase text-ink-400 [color:var(--color-ink-400)]"
              aria-hidden
            >
              <span className="h-px flex-1 bg-[var(--color-ink-200)]" />
              <span>または</span>
              <span className="h-px flex-1 bg-[var(--color-ink-200)]" />
            </div>

            <LinkedinSigninButton next={next} />

            <div className="mt-10 grid grid-cols-2 gap-3 text-[12px]">
              <Trust icon={ShieldCheck} text="SOC 2 / ISMS 対応中" />
              <Trust icon={Eye} text="送信前レビュー必須" />
            </div>
          </div>
        </main>

        <footer className="text-[11px] text-ink-400 [color:var(--color-ink-400)]">
          © {new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Tokyo" }).format(new Date())} IKEMENLTD · LinkdInside
        </footer>
      </div>

      <aside className="hidden lg:block relative overflow-hidden border-l border-[var(--color-ink-100)]">
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(135deg,rgba(186,230,253,0.55),rgba(204,251,241,0.45)_55%,rgba(255,255,255,0.85))]"
        />
        <div
          aria-hidden
          className="absolute -top-24 -right-24 size-[520px] rounded-full bg-[radial-gradient(circle,rgba(45,212,191,0.30),transparent_70%)] blur-2xl"
        />
        <div
          aria-hidden
          className="absolute bottom-0 left-1/4 size-[420px] rounded-full bg-[radial-gradient(circle,rgba(125,211,252,0.40),transparent_70%)] blur-2xl"
        />

        <div className="relative h-full flex flex-col justify-end p-12">
          <blockquote className="font-display text-[28px] font-semibold tracking-tight text-ink-900 [color:var(--color-ink-900)] leading-[1.2] max-w-[360px]">
            「営業の最初の一通を、AI が下書きする。
            <br />
            送り出すのは、人間の判断であり続ける。」
          </blockquote>
          <div className="mt-4 text-[12px] text-ink-600 [color:var(--color-ink-600)]">
            — プロダクト原則 §1.1
          </div>
        </div>
      </aside>
    </div>
  );
}

function Trust({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2 text-ink-600 [color:var(--color-ink-600)]">
      <span className="size-7 rounded-lg border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] grid place-content-center text-[var(--color-brand-700)]">
        <Icon className="size-3.5" aria-hidden />
      </span>
      {text}
    </div>
  );
}
