"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  MinusCircle,
  X,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { StateChip } from "@/components/ui/state-chip";
import { fmtNumber, fmtRelative } from "@/lib/formatters";
import type { LeadListItem } from "@/server/queries/leads";
import {
  bulkDisqualifyLeads,
  INITIAL_LEAD_BULK_STATE,
  type LeadBulkState,
} from "@/server/actions/leads";
import { cn } from "@/lib/utils";

interface Props {
  rows: LeadListItem[];
}

export function LeadsTable({ rows }: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [toast, setToast] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const ids = new Set(rows.map((r) => r.id));
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [rows]);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.id));

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="card-solid overflow-hidden">
      <div
        role="row"
        className="hidden md:grid grid-cols-[36px_minmax(220px,1.6fr)_120px_70px_minmax(140px,1.4fr)_130px_28px] gap-2 items-center px-4 py-2.5 border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-500 [color:var(--color-ink-500)]"
      >
        <div role="columnheader" className="grid place-content-center">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            label="すべて選択"
          />
        </div>
        <div role="columnheader">名前 / 会社</div>
        <div role="columnheader">状態</div>
        <div role="columnheader" className="text-right">スコア</div>
        <div role="columnheader">キャンペーン / 担当</div>
        <div role="columnheader">最終アクション</div>
        <div role="columnheader" />
      </div>
      <ul role="rowgroup" className="divide-y divide-[var(--color-ink-100)]">
        {rows.map((row) => {
          const checked = selected.has(row.id);
          return (
            <li
              key={row.id}
              role="row"
              className="group relative grid grid-cols-1 md:grid-cols-[36px_minmax(220px,1.6fr)_120px_70px_minmax(140px,1.4fr)_130px_28px] gap-2 items-center px-4 py-3 hover:bg-[var(--color-brand-50)]/60 transition"
            >
              <div className="hidden md:grid place-content-center">
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleOne(row.id)}
                  label={`${row.name} を選択`}
                />
              </div>
              <div className="min-w-0">
                <Link
                  href={`/leads?lead=${row.id}`}
                  scroll={false}
                  className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] hover:text-[var(--color-brand-700)] truncate inline-flex items-center gap-1"
                >
                  {row.name}
                </Link>
                <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
                  {[row.headline, row.company].filter(Boolean).join(" · ") || "—"}
                </div>
                <div className="md:hidden mt-1 flex items-center flex-wrap gap-2">
                  <StateChip state={row.state} />
                  <span className="text-[11px] tabular font-mono text-ink-500 [color:var(--color-ink-500)]">
                    {row.score}
                  </span>
                  <span className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
                    {row.campaignName ?? "—"}
                  </span>
                </div>
              </div>
              <div className="hidden md:flex items-center">
                <StateChip state={row.state} />
              </div>
              <div className="hidden md:block text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                {row.score}
              </div>
              <div className="hidden md:block min-w-0">
                <Link
                  href={`/campaigns/${row.campaignId}`}
                  className="text-[12px] text-ink-700 [color:var(--color-ink-700)] hover:text-[var(--color-brand-700)] truncate block"
                >
                  {row.campaignName ?? "—"}
                </Link>
                <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate">
                  {row.ownerName ?? "—"}
                </div>
              </div>
              <div className="hidden md:block text-[12px] text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
                {row.lastActionAt ? fmtRelative(row.lastActionAt) : "未開始"}
              </div>
              <ChevronRight
                className="hidden md:block size-4 text-ink-300 [color:var(--color-ink-300)] justify-self-end"
                aria-hidden
              />
            </li>
          );
        })}
      </ul>

      <BulkBar
        ids={Array.from(selected)}
        totalRows={rows.length}
        onCancel={() => setSelected(new Set())}
        onResult={(s) => {
          if (s.message) setToast({ kind: s.ok ? "success" : "error", text: s.message });
          if (s.ok && s.resetSelection) setSelected(new Set());
        }}
      />

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 px-4"
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
    </div>
  );
}

function BulkBar({
  ids,
  totalRows,
  onCancel,
  onResult,
}: {
  ids: string[];
  totalRows: number;
  onCancel: () => void;
  onResult: (s: LeadBulkState) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="一括アクション"
      className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-brand-200)] bg-white/95 backdrop-blur-md shadow-[var(--shadow-popover)] px-3 py-2">
        <span className="text-[12px] tabular font-mono text-ink-700 [color:var(--color-ink-700)]">
          {fmtNumber(ids.length)} / {fmtNumber(totalRows)} 件選択中
        </span>
        <span className="h-4 w-px bg-[var(--color-ink-200)]" aria-hidden />
        <DisqualifyForm ids={ids} onResult={onResult} />
        <button
          type="button"
          onClick={onCancel}
          aria-label="選択を解除"
          className="size-7 grid place-content-center rounded-full text-ink-500 hover:bg-[var(--color-ink-100)]"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function DisqualifyForm({
  ids,
  onResult,
}: {
  ids: string[];
  onResult: (s: LeadBulkState) => void;
}) {
  const [state, formAction] = useActionState<LeadBulkState, FormData>(
    bulkDisqualifyLeads,
    INITIAL_LEAD_BULK_STATE
  );
  const reportedRef = React.useRef<LeadBulkState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reportedRef.current === state) return;
    reportedRef.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`${ids.length} 件を除外します。よろしいですか？`)) {
          e.preventDefault();
        }
      }}
      className="inline-flex"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <DisqualifySubmit />
    </form>
  );
}

function DisqualifySubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium text-[var(--color-warning-700)] hover:bg-[var(--color-warning-50)] transition",
        pending && "opacity-60 pointer-events-none"
      )}
    >
      {pending ? (
        <span aria-hidden className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin" />
      ) : (
        <MinusCircle className="size-3.5" aria-hidden />
      )}
      除外する
    </button>
  );
}
