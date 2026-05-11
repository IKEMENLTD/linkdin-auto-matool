"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { LEAD_STATE_OPTIONS } from "@/server/queries/leads";

interface Props {
  campaigns: { id: string; name: string }[];
}

const SCORE_OPTIONS = [
  { value: "0", label: "すべてのスコア" },
  { value: "50", label: "50 以上" },
  { value: "70", label: "70 以上" },
  { value: "85", label: "85 以上" },
];

export function LeadsFilterBar({ campaigns }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const qFromUrl = sp.get("q") ?? "";
  const [q, setQ] = React.useState(qFromUrl);

  React.useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  const apply = React.useCallback(
    (next: Partial<Record<string, string>>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === "" || v === undefined) params.delete(k);
        else params.set(k, v);
      }
      params.delete("page");
      router.push(params.size ? `/leads?${params.toString()}` : "/leads");
    },
    [sp, router]
  );

  React.useEffect(() => {
    if (q === qFromUrl) return;
    const h = setTimeout(() => apply({ q }), 350);
    return () => clearTimeout(h);
  }, [q, qFromUrl, apply]);

  const hasFilter =
    (sp.get("state") ?? "") !== "" ||
    (sp.get("campaign") ?? "") !== "" ||
    (sp.get("scoreMin") ?? "") !== "" ||
    (sp.get("q") ?? "") !== "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-ink-400 [color:var(--color-ink-400)]"
          aria-hidden
        />
        <Input
          type="search"
          placeholder="名前 / 会社 / 役職で検索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="リードを検索"
          className="h-9 pl-9 pr-8 w-[280px] text-[13px] rounded-full"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            aria-label="検索をクリア"
            className="absolute right-2 top-1/2 -translate-y-1/2 size-6 grid place-content-center rounded-full text-ink-400 hover:text-ink-700"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      <Select
        aria-label="状態でフィルタ"
        value={sp.get("state") ?? ""}
        onChange={(e) => apply({ state: e.target.value })}
        options={LEAD_STATE_OPTIONS}
      />

      <Select
        aria-label="キャンペーンでフィルタ"
        value={sp.get("campaign") ?? ""}
        onChange={(e) => apply({ campaign: e.target.value })}
        options={[
          { value: "", label: "すべてのキャンペーン" },
          ...campaigns.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />

      <Select
        aria-label="スコアでフィルタ"
        value={sp.get("scoreMin") ?? "0"}
        onChange={(e) => apply({ scoreMin: e.target.value === "0" ? "" : e.target.value })}
        options={SCORE_OPTIONS}
      />

      {hasFilter && (
        <button
          type="button"
          onClick={() => router.push("/leads")}
          className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
        >
          フィルタをクリア
        </button>
      )}
    </div>
  );
}
