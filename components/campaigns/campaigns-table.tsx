"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  MoreHorizontal,
  Pause,
  Play,
  Copy,
  Archive,
  AlertTriangle,
  Pencil,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
// React 19 でも useFormStatus は react-dom 経由
import { Checkbox } from "@/components/ui/checkbox";
import { Dropdown, DropdownItem, DropdownDivider } from "@/components/ui/dropdown";
import { CampaignStatusChip } from "@/components/campaigns/campaign-status-chip";
import { fmtNumber, fmtPercent, fmtRelative } from "@/lib/formatters";
import type { CampaignListItem } from "@/server/queries/campaigns";
import {
  bulkPauseCampaigns,
  bulkResumeCampaigns,
  bulkArchiveCampaigns,
  INITIAL_BULK_STATE,
  type BulkActionState,
} from "@/server/actions/campaigns";
import { cn } from "@/lib/utils";

interface Props {
  rows: CampaignListItem[];
}

export function CampaignsTable({ rows }: Props) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [toast, setToast] = React.useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);

  // rows が変わった (フィルタ / ページ遷移 / revalidate) ら、表示中に存在しない ID を選択から除外
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

  // 自動消滅
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = !allSelected && rows.some((r) => selected.has(r.id));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="card-solid overflow-hidden">
      {/* desktop header */}
      <div
        role="row"
        className="hidden md:grid grid-cols-[36px_minmax(220px,2.1fr)_120px_90px_90px_90px_140px_40px] gap-2 items-center px-4 py-2.5 border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-500 [color:var(--color-ink-500)]"
      >
        <div role="columnheader" className="grid place-content-center">
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={toggleAll}
            label="すべて選択"
          />
        </div>
        <div role="columnheader">名前</div>
        <div role="columnheader">状態 / HITL</div>
        <div role="columnheader" className="text-right">送信</div>
        <div role="columnheader" className="text-right">返信</div>
        <div role="columnheader" className="text-right">CVR</div>
        <div role="columnheader">担当 / 最終</div>
        <div role="columnheader" />
      </div>

      <ul role="rowgroup" className="divide-y divide-[var(--color-ink-100)]">
        {rows.map((row) => {
          const checked = selected.has(row.id);
          return (
            <li
              key={row.id}
              role="row"
              className="group relative grid grid-cols-1 md:grid-cols-[36px_minmax(220px,2.1fr)_120px_90px_90px_90px_140px_40px] gap-2 items-center px-4 py-3 hover:bg-[var(--color-brand-50)]/60 transition"
            >
              <div className="hidden md:grid place-content-center">
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleOne(row.id)}
                  label={`${row.name} を選択`}
                />
              </div>
              <div className="min-w-0 flex flex-col gap-1">
                <Link
                  href={`/campaigns/${row.id}`}
                  className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] hover:text-[var(--color-brand-700)] truncate inline-flex items-center gap-2"
                >
                  <span className="truncate">{row.name}</span>
                  {row.anomaly && (
                    <span
                      role="img"
                      aria-label="停滞: 実行中ですが直近 24 時間アクションがありません"
                      title="実行中ですが直近 24h アクションがありません"
                      className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border border-[#FDE68A] rounded-full px-1.5 py-0.5"
                    >
                      <AlertTriangle className="size-2.5" aria-hidden />
                      停滞
                    </span>
                  )}
                </Link>
                {/* モバイル要約 */}
                <div className="md:hidden flex items-center flex-wrap gap-2 text-[11px] text-ink-500 [color:var(--color-ink-500)]">
                  <CampaignStatusChip status={row.status} />
                  <span>{row.ownerName ?? "—"}</span>
                  <span className="tabular font-mono">
                    送信 {fmtNumber(row.sent)} · 返信 {fmtNumber(row.replied)} ·{" "}
                    {fmtPercent(row.cvr)}
                  </span>
                </div>
              </div>
              <div className="hidden md:flex items-center gap-2">
                <CampaignStatusChip status={row.status} />
              </div>
              <div className="hidden md:block text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                {fmtNumber(row.sent)}
              </div>
              <div className="hidden md:block text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                {fmtNumber(row.replied)}
              </div>
              <div className="hidden md:block text-right tabular font-mono text-[13px] text-[var(--color-brand-700)]">
                {fmtPercent(row.cvr)}
              </div>
              <div className="hidden md:block text-[12px] text-ink-500 [color:var(--color-ink-500)]">
                <div className="truncate">{row.ownerName ?? "—"}</div>
                <div className="text-[10px] tabular font-mono">
                  {row.lastActivityAt ? fmtRelative(row.lastActivityAt) : "未開始"}
                </div>
              </div>
              <div className="hidden md:flex justify-end relative z-10">
                <RowActions row={row} />
              </div>
            </li>
          );
        })}
      </ul>

      <BulkBar
        ids={Array.from(selected)}
        totalRows={rows.length}
        onCancel={() => setSelected(new Set())}
        onResult={(state) => {
          if (state.message) {
            setToast({ kind: state.ok ? "success" : "error", text: state.message });
          }
          if (state.ok && state.resetSelection) setSelected(new Set());
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

function RowActions({ row }: { row: CampaignListItem }) {
  const PrimaryIcon = row.status === "paused" ? Play : Pause;
  return (
    <Dropdown
      align="end"
      triggerAriaLabel={`${row.name} の操作`}
      triggerClassName="size-8 grid place-content-center rounded-full border border-transparent text-ink-500 hover:bg-white hover:border-[var(--color-ink-200)] hover:text-ink-900 transition opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      trigger={<MoreHorizontal className="size-4" aria-hidden />}
    >
      {(close) => (
        <>
          <DropdownItem
            icon={PrimaryIcon}
            onSelect={() => {
              close();
              alert(
                `${row.status === "paused" ? "再開" : "一時停止"}: ${row.name} (Phase2 で個別アクション実装予定)`
              );
            }}
          >
            {row.status === "paused" ? "再開する" : "一時停止"}
          </DropdownItem>
          <DropdownItem icon={Copy} onSelect={() => close()} disabled>
            複製する (Phase2)
          </DropdownItem>
          <DropdownItem icon={Pencil} onSelect={() => close()} disabled>
            編集申請 (Phase2)
          </DropdownItem>
          <DropdownDivider />
          <DropdownItem icon={Archive} destructive onSelect={() => close()} disabled>
            アーカイブ (Phase2)
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}

interface BulkBarProps {
  ids: string[];
  totalRows: number;
  onCancel: () => void;
  onResult: (state: BulkActionState) => void;
}

function BulkBar({ ids, totalRows, onCancel, onResult }: BulkBarProps) {
  if (ids.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="一括アクション"
      className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 pointer-events-none"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[var(--color-brand-200)] bg-white/95 backdrop-blur-md shadow-[var(--shadow-popover)] px-3 py-2">
        <span className="text-[12px] tabular font-mono text-ink-700 [color:var(--color-ink-700)]">
          {ids.length} / {totalRows} 件選択中
        </span>
        <span className="h-4 w-px bg-[var(--color-ink-200)]" aria-hidden />
        <BulkActionForm
          action={bulkPauseCampaigns}
          ids={ids}
          icon={Pause}
          label="一時停止"
          onResult={onResult}
        />
        <BulkActionForm
          action={bulkResumeCampaigns}
          ids={ids}
          icon={Play}
          label="再開"
          onResult={onResult}
        />
        <BulkActionForm
          action={bulkArchiveCampaigns}
          ids={ids}
          icon={Archive}
          label="アーカイブ"
          confirmMessage={(n) => `${n} 件をアーカイブします。よろしいですか？`}
          destructive
          onResult={onResult}
        />
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

interface BulkActionFormProps {
  action: (prev: BulkActionState | undefined, formData: FormData) => Promise<BulkActionState>;
  ids: string[];
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  confirmMessage?: (n: number) => string;
  destructive?: boolean;
  onResult: (state: BulkActionState) => void;
}

function BulkActionForm({
  action,
  ids,
  icon: Icon,
  label,
  confirmMessage,
  destructive,
  onResult,
}: BulkActionFormProps) {
  const [state, formAction] = useActionState<BulkActionState, FormData>(action, INITIAL_BULK_STATE);
  const reportedRef = React.useRef<BulkActionState | null>(null);

  React.useEffect(() => {
    // 同じ参照のメッセージを二重通知しない
    if (state === INITIAL_BULK_STATE) return;
    if (reportedRef.current === state) return;
    reportedRef.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage(ids.length))) {
          e.preventDefault();
        }
      }}
      className="inline-flex"
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <BulkSubmit icon={Icon} label={label} destructive={destructive} />
    </form>
  );
}

function BulkSubmit({
  icon: Icon,
  label,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-medium transition",
        destructive
          ? "text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)]"
          : "text-[var(--color-brand-700)] hover:bg-[var(--color-brand-50)]",
        pending && "opacity-60 pointer-events-none"
      )}
    >
      {pending ? (
        <span
          aria-hidden
          className="size-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
        />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}
