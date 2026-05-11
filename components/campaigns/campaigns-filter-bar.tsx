"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, Bookmark } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dropdown, DropdownItem, DropdownDivider } from "@/components/ui/dropdown";
import { CAMPAIGN_STATUS_OPTIONS } from "@/lib/campaign-status";

const OWNER_OPTIONS = [
  { value: "", label: "すべての担当" },
  { value: "me", label: "自分の担当" },
];

interface SavedView {
  id: string;
  label: string;
  query: string;
}

const STARTER_VIEWS: SavedView[] = [
  { id: "running-only", label: "実行中のみ", query: "?status=running" },
  { id: "my-running", label: "自分の実行中", query: "?status=running&owner=me" },
  { id: "needs-review", label: "要レビュー (HITL)", query: "?status=running&hitl=REVIEW_REQUIRED" },
  { id: "safe-mode", label: "安全モード", query: "?status=safe_mode" },
];

export function CampaignsFilterBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const qFromUrl = sp.get("q") ?? "";
  const [q, setQ] = React.useState(qFromUrl);

  // URL の q が外部要因で変わったら (保存ビュー、フィルタクリア等) ローカル state も追従
  React.useEffect(() => {
    setQ(qFromUrl);
  }, [qFromUrl]);

  const apply = React.useCallback(
    (next: Partial<Record<string, string>>) => {
      const params = new URLSearchParams(sp.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === "" || value === undefined) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      params.delete("page"); // フィルタ変更時は 1 ページ目へ
      router.push(params.size ? `/campaigns?${params.toString()}` : "/campaigns");
    },
    [sp, router]
  );

  // q debounce (ローカル変更のみが対象、URL→state の同期は上の effect で済んでいる)
  React.useEffect(() => {
    if (q === qFromUrl) return;
    const handle = setTimeout(() => apply({ q }), 350);
    return () => clearTimeout(handle);
  }, [q, qFromUrl, apply]);

  const hasFilter =
    (sp.get("status") ?? "") !== "" ||
    (sp.get("owner") ?? "") !== "" ||
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
          placeholder="キャンペーンを検索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="キャンペーンを検索"
          className="h-9 pl-9 pr-8 w-[260px] text-[13px] rounded-full"
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
        value={sp.get("status") ?? ""}
        onChange={(e) => apply({ status: e.target.value })}
        options={CAMPAIGN_STATUS_OPTIONS}
      />

      <Select
        aria-label="担当でフィルタ"
        value={sp.get("owner") ?? ""}
        onChange={(e) => apply({ owner: e.target.value })}
        options={OWNER_OPTIONS}
      />

      {hasFilter && (
        <button
          type="button"
          onClick={() => router.push("/campaigns")}
          className="text-[12px] text-ink-500 [color:var(--color-ink-500)] hover:text-ink-900 underline-offset-4 hover:underline"
        >
          フィルタをクリア
        </button>
      )}

      <div className="ml-auto">
        <Dropdown
          align="end"
          triggerAriaLabel="保存ビューを開く"
          triggerClassName="h-9 px-3 rounded-full border border-[var(--color-ink-200)] bg-white text-[12px] text-ink-700 [color:var(--color-ink-700)] hover:border-[var(--color-brand-300)] transition"
          trigger={
            <>
              <Bookmark className="size-3.5 text-[var(--color-brand-600)] mr-1.5" aria-hidden />
              保存ビュー
            </>
          }
        >
          {(close) => (
            <>
              {STARTER_VIEWS.map((v) => (
                <DropdownItem
                  key={v.id}
                  onSelect={() => {
                    close();
                    router.push(`/campaigns${v.query}`);
                  }}
                >
                  {v.label}
                </DropdownItem>
              ))}
              <DropdownDivider />
              <DropdownItem disabled onSelect={() => close()}>
                現在のフィルタを保存 (Phase2)
              </DropdownItem>
            </>
          )}
        </Dropdown>
      </div>
    </div>
  );
}
