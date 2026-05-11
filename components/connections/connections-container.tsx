"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { AccountCard } from "@/components/connections/account-card";
import type { LinkedinAccount } from "@/server/queries/connections";
import type { ConnectionActionState } from "@/server/actions/connections";
import { cn } from "@/lib/utils";

export function ConnectionsContainer({ accounts }: { accounts: LinkedinAccount[] }) {
  const [toast, setToast] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // 安全モードを先頭に
  const sorted = [...accounts].sort((a, b) => {
    const score = (acc: LinkedinAccount) =>
      acc.status === "safe_mode" ? 0 : acc.status === "warming" ? 1 : acc.status === "active" ? 2 : 3;
    return score(a) - score(b);
  });

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sorted.map((a) => (
          <AccountCard
            key={a.id}
            account={a}
            onResult={(s: ConnectionActionState) =>
              setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" })
            }
          />
        ))}
      </div>

      {toast && (
        <div
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4"
        >
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-[var(--shadow-popover)] bg-white",
              toast.kind === "success"
                ? "border-[#A7F3D0] text-[var(--color-success-700)]"
                : "border-[#FECACA] text-[var(--color-danger-700)]"
            )}
          >
            {toast.kind === "success" ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <AlertCircle className="size-4" aria-hidden />
            )}
            {toast.text}
          </div>
        </div>
      )}
    </>
  );
}
