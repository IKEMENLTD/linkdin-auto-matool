import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS_META, type CampaignStatus } from "@/lib/campaign-status";

export function CampaignStatusChip({ status }: { status: CampaignStatus }) {
  const meta = CAMPAIGN_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} aria-label={meta.ja}>
      <Icon
        className={`size-3 ${status === "running" ? "pulse-soft" : ""}`}
        aria-hidden
      />
      {meta.ja}
    </Badge>
  );
}
