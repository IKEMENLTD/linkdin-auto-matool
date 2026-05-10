import { cn } from "@/lib/utils";

export function Logo({ className, size = 32 }: { className?: string; size?: number }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="LinkdInside"
        role="img"
      >
        <defs>
          <linearGradient id="lg-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#7DD3FC" />
            <stop offset="0.5" stopColor="#0EA5E9" />
            <stop offset="1" stopColor="#0D9488" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg-grad)" />
        <path
          d="M11 11.5v9M11 11.5a1.5 1.5 0 1 1 0-.001zM16 14.5v6M21 14.5c-2.2 0-3 1.5-3 3v3M21 14.5v6"
          stroke="white"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="11" cy="9.2" r="1.4" fill="white" />
      </svg>
      <span className="font-display font-bold tracking-tight text-[15px] text-ink-900 [color:var(--color-ink-900)]">
        Linkd<span className="text-[var(--color-brand-600)]">Inside</span>
      </span>
    </div>
  );
}
