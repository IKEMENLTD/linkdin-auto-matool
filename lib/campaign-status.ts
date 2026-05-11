import {
  CircleDot,
  CheckCircle2,
  Pause,
  ShieldAlert,
  FilePen,
  type LucideIcon,
} from "lucide-react";

export type CampaignStatus = "draft" | "running" | "paused" | "completed" | "safe_mode";

export type CampaignStatusMeta = {
  status: CampaignStatus;
  ja: string;
  icon: LucideIcon;
  tone: "info" | "brand" | "neutral" | "warning" | "success" | "danger";
};

export const CAMPAIGN_STATUS_META: Record<CampaignStatus, CampaignStatusMeta> = {
  draft:     { status: "draft",     ja: "下書き",     icon: FilePen,        tone: "neutral" },
  running:   { status: "running",   ja: "実行中",     icon: CircleDot,      tone: "brand"   },
  paused:    { status: "paused",    ja: "一時停止",   icon: Pause,          tone: "warning" },
  completed: { status: "completed", ja: "完了",       icon: CheckCircle2,   tone: "success" },
  safe_mode: { status: "safe_mode", ja: "安全モード", icon: ShieldAlert,    tone: "danger"  },
};

export const CAMPAIGN_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "すべての状態" },
  ...Object.values(CAMPAIGN_STATUS_META).map((m) => ({ value: m.status, label: m.ja })),
];
