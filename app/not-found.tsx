import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="hydro-canvas min-h-screen flex items-center justify-center px-6">
      <div className="max-w-[480px] w-full text-center">
        <div className="inline-flex items-center justify-center size-14 rounded-2xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] mb-5">
          <Compass className="size-7" aria-hidden />
        </div>
        <h1 className="font-display text-[36px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)] mb-2 leading-none">
          404
        </h1>
        <p className="text-[14px] text-ink-600 [color:var(--color-ink-600)] mb-6 leading-relaxed">
          お探しのページは見つかりませんでした。リンクが古い可能性があります。
        </p>
        <Link href="/dashboard" className="inline-block">
          <Button>ダッシュボードへ戻る</Button>
        </Link>
      </div>
    </div>
  );
}
