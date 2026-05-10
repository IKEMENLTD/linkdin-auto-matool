/**
 * リード状態機械 — UI/UX 設計書 §3.3 に準拠。
 * 表示は Lucide アイコン + 色 + 日本語ラベル の三重表現。
 */
import {
  AlertTriangle,
  BadgeAlert,
  CalendarCheck,
  CheckCircle2,
  Clock,
  FileText,
  Hourglass,
  Link2,
  MessageSquare,
  MinusCircle,
  Search,
  Send,
  ShieldAlert,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type LeadState =
  | "DISCOVERED"
  | "ENRICHED"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "PENDING"
  | "CONNECTED"
  | "MESSAGED"
  | "REPLIED"
  | "MEETING"
  | "COMPLETED"
  | "FAILED"
  | "EXPIRED"
  | "SAFE_MODE"
  | "QUARANTINED";

export type StateMeta = {
  state: LeadState;
  ja: string;
  en: string;
  icon: LucideIcon;
  /** Tailwind utility for text/border color */
  tone:
    | "neutral"
    | "info"
    | "info-strong"
    | "positive-soft"
    | "positive"
    | "muted"
    | "warning-soft"
    | "warning"
    | "progress"
    | "success"
    | "success-strong"
    | "danger";
  description: string;
};

export const STATE_META: Record<LeadState, StateMeta> = {
  DISCOVERED:    { state: "DISCOVERED",    ja: "発見",       en: "Discovered",    icon: Search,         tone: "neutral",         description: "検索でヒットしたが未調査" },
  ENRICHED:      { state: "ENRICHED",      ja: "調査済",     en: "Enriched",      icon: FileText,       tone: "info",            description: "プロフィール詳細取得済み" },
  QUALIFIED:     { state: "QUALIFIED",     ja: "適合",       en: "Qualified",     icon: CheckCircle2,   tone: "positive-soft",   description: "AI 判定で ICP 合致" },
  DISQUALIFIED:  { state: "DISQUALIFIED",  ja: "除外",       en: "Disqualified",  icon: MinusCircle,    tone: "muted",           description: "適合しない（理由表示）" },
  PENDING:       { state: "PENDING",       ja: "申請中",     en: "Pending",       icon: Hourglass,      tone: "warning-soft",    description: "コネクト送信済み・承認待ち" },
  CONNECTED:     { state: "CONNECTED",     ja: "接続",       en: "Connected",     icon: Link2,          tone: "info-strong",     description: "1st コネクション" },
  MESSAGED:      { state: "MESSAGED",      ja: "送信済",     en: "Messaged",      icon: Send,           tone: "progress",        description: "初回メッセージ送信済" },
  REPLIED:       { state: "REPLIED",       ja: "返信あり",   en: "Replied",       icon: MessageSquare,  tone: "positive",        description: "返信受信（要レビュー）" },
  MEETING:       { state: "MEETING",       ja: "商談化",     en: "Meeting",       icon: CalendarCheck,  tone: "success",         description: "カレンダー設定済" },
  COMPLETED:     { state: "COMPLETED",     ja: "完了",       en: "Completed",     icon: Trophy,         tone: "success-strong",  description: "CRM 同期完了" },
  FAILED:        { state: "FAILED",        ja: "失敗",       en: "Failed",        icon: AlertTriangle,  tone: "danger",          description: "送信失敗・規約違反疑い" },
  EXPIRED:       { state: "EXPIRED",       ja: "期限切れ",   en: "Expired",       icon: Clock,          tone: "muted",           description: "コネクト申請が承認されず期限到達" },
  SAFE_MODE:     { state: "SAFE_MODE",     ja: "安全モード", en: "Safe Mode",     icon: ShieldAlert,    tone: "danger",          description: "自動停止中" },
  QUARANTINED:   { state: "QUARANTINED",   ja: "隔離",       en: "Quarantined",   icon: BadgeAlert,     tone: "warning",         description: "DLP/規約検査で保留" },
};

export const TONE_CLASS: Record<StateMeta["tone"], string> = {
  neutral:         "text-ink-500 [color:var(--color-ink-500)]",
  info:            "text-info-700 [color:var(--color-info-700)]",
  "info-strong":   "text-brand-700 [color:var(--color-brand-700)]",
  "positive-soft": "text-success-700 [color:var(--color-success-700)]",
  positive:        "text-success-700 [color:var(--color-success-700)]",
  muted:           "text-ink-400 [color:var(--color-ink-400)]",
  "warning-soft":  "text-warning-700 [color:var(--color-warning-700)]",
  warning:         "text-warning-700 [color:var(--color-warning-700)]",
  progress:        "text-brand-700 [color:var(--color-brand-700)]",
  success:         "text-success-700 [color:var(--color-success-700)]",
  "success-strong":"text-success-700 [color:var(--color-success-700)]",
  danger:          "text-danger-700 [color:var(--color-danger-700)]",
};

/** ファネル表示用の主要状態 (DISCOVERED → ... → MEETING) */
export const FUNNEL_ORDER: LeadState[] = [
  "DISCOVERED",
  "ENRICHED",
  "QUALIFIED",
  "CONNECTED",
  "REPLIED",
  "MEETING",
];

/** 短縮ラベル (一覧やファネルでスペース節約用) */
export const STATE_SHORT_LABEL: Record<LeadState, string> = Object.fromEntries(
  Object.entries(STATE_META).map(([k, v]) => [k, v.ja])
) as Record<LeadState, string>;

export const STATE_ORDER: LeadState[] = [
  "DISCOVERED",
  "ENRICHED",
  "QUALIFIED",
  "DISQUALIFIED",
  "PENDING",
  "CONNECTED",
  "MESSAGED",
  "REPLIED",
  "MEETING",
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "QUARANTINED",
  "SAFE_MODE",
];
