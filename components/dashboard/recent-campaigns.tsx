import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ShieldAlert, Pause, CircleDot, CheckCircle2 } from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";

export type CampaignRow = {
  id: string;
  name: string;
  status: "running" | "draft" | "paused" | "completed" | "safe_mode";
  sent: number;
  replied: number;
  cvr: number;
  owner: string;
};

const STATUS_META: Record<
  CampaignRow["status"],
  {
    label: string;
    tone: "info" | "neutral" | "warning" | "success" | "danger" | "brand";
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  }
> = {
  running: { label: "実行中", tone: "brand", icon: CircleDot },
  draft: { label: "下書き", tone: "neutral", icon: CircleDot },
  paused: { label: "一時停止", tone: "warning", icon: Pause },
  completed: { label: "完了", tone: "success", icon: CheckCircle2 },
  safe_mode: { label: "安全モード", tone: "danger", icon: ShieldAlert },
};

export function RecentCampaigns({ rows }: { rows: CampaignRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>直近のキャンペーン</CardTitle>
        <Link
          href="/campaigns"
          className="text-[12px] text-[var(--color-brand-700)] hover:text-[var(--color-brand-900)] inline-flex items-center gap-1"
        >
          すべて見る <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      <CardBody className="p-0">
        <div className="hidden md:grid grid-cols-[1.4fr_120px_90px_90px_90px_120px_32px] gap-2 px-5 py-2 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-400 [color:var(--color-ink-400)] border-y border-[var(--color-ink-100)]">
          <div>名前</div>
          <div>状態</div>
          <div className="text-right">送信</div>
          <div className="text-right">返信</div>
          <div className="text-right">CVR</div>
          <div>担当</div>
          <div />
        </div>
        {rows.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-ink-400 [color:var(--color-ink-400)]">
            キャンペーンがまだありません
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-ink-100)]">
            {rows.map((row) => {
              const meta = STATUS_META[row.status];
              const Icon = meta.icon;
              return (
                <li key={row.id}>
                  <Link
                    href={`/campaigns/${row.id}`}
                    className="grid grid-cols-1 md:grid-cols-[1.4fr_120px_90px_90px_90px_120px_32px] gap-2 items-center px-5 py-3 hover:bg-[var(--color-brand-50)]/60 transition"
                  >
                    <div className="font-medium text-[13px] text-ink-900 [color:var(--color-ink-900)] truncate">
                      {row.name}
                    </div>
                    <div>
                      <Badge tone={meta.tone}>
                        <Icon className="size-3" aria-hidden />
                        {meta.label}
                      </Badge>
                    </div>
                    <div className="text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                      {fmtNumber(row.sent)}
                    </div>
                    <div className="text-right tabular font-mono text-[13px] text-ink-700 [color:var(--color-ink-700)]">
                      {fmtNumber(row.replied)}
                    </div>
                    <div className="text-right tabular font-mono text-[13px] text-[var(--color-brand-700)]">
                      {fmtPercent(row.cvr)}
                    </div>
                    <div className="text-[12px] text-ink-500 [color:var(--color-ink-500)] truncate">
                      {row.owner}
                    </div>
                    <ChevronRight
                      className="size-4 text-ink-300 [color:var(--color-ink-300)] justify-self-end hidden md:block"
                      aria-hidden
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
