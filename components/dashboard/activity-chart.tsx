import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtNumber } from "@/lib/formatters";

export type DailyPoint = {
  date: string; // ISO
  sent: number;
  replied: number;
  meeting: number;
};

interface Props {
  data: DailyPoint[];
}

export function ActivityChart({ data }: Props) {
  const w = 720;
  const h = 220;
  const padX = 24;
  const padY = 12;
  const bottomLabelH = 22;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2 - bottomLabelH;

  const maxY = Math.max(...data.map((d) => Math.max(d.sent, d.replied * 4, d.meeting * 8)), 1);

  const xFor = (i: number) => padX + (innerW * i) / Math.max(data.length - 1, 1);
  const yFor = (v: number) => padY + innerH - (v / maxY) * innerH;

  const linePath = (key: keyof Omit<DailyPoint, "date">) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d[key])}`).join(" ");

  const areaPath = (key: keyof Omit<DailyPoint, "date">) =>
    `${linePath(key)} L ${xFor(data.length - 1)} ${padY + innerH} L ${xFor(0)} ${padY + innerH} Z`;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>日次活動量</CardTitle>
          <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] mt-0.5">
            送信 / 返信 / 商談化
          </div>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <Legend swatch="bg-[var(--color-brand-500)]" label="送信" />
          <Legend swatch="bg-[var(--color-mint-500)]" label="返信" />
          <Legend swatch="bg-[var(--color-deep)]" label="商談化" />
        </div>
      </CardHeader>
      <CardBody>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" role="img" aria-label="日次活動量チャート">
          <defs>
            <linearGradient id="grad-sent" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#0EA5E9" stopOpacity="0.32" />
              <stop offset="1" stopColor="#0EA5E9" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="grad-replied" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#14B8A6" stopOpacity="0.28" />
              <stop offset="1" stopColor="#14B8A6" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* horizontal grid */}
          {[0.25, 0.5, 0.75, 1].map((p, i) => (
            <line
              key={i}
              x1={padX}
              x2={padX + innerW}
              y1={padY + innerH - innerH * p}
              y2={padY + innerH - innerH * p}
              className="grid-line"
            />
          ))}

          {/* areas */}
          <path d={areaPath("sent")} fill="url(#grad-sent)" />
          <path d={areaPath("replied")} fill="url(#grad-replied)" />

          {/* lines */}
          <path d={linePath("sent")} fill="none" stroke="#0EA5E9" strokeWidth="2" />
          <path d={linePath("replied")} fill="none" stroke="#14B8A6" strokeWidth="2" />
          <path
            d={linePath("meeting")}
            fill="none"
            stroke="#0B1E3F"
            strokeWidth="1.6"
            strokeDasharray="3 3"
          />

          {/* x labels */}
          {data.map((d, i) => {
            if (i % Math.max(1, Math.floor(data.length / 7)) !== 0) return null;
            const date = new Date(d.date);
            return (
              <text
                key={d.date}
                x={xFor(i)}
                y={padY + innerH + 16}
                textAnchor="middle"
                className="font-mono"
                fontSize="9"
                fill="#94A3B8"
              >
                {date.getMonth() + 1}/{date.getDate()}
              </text>
            );
          })}
        </svg>

        <div className="mt-3 flex items-center justify-between text-[11px] text-ink-500 [color:var(--color-ink-500)]">
          <span className="tabular font-mono">{data.length} 日間</span>
          <span className="tabular font-mono">最大 {fmtNumber(maxY)}</span>
        </div>
      </CardBody>
    </Card>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-600 [color:var(--color-ink-600)]">
      <span className={`size-2 rounded-full ${swatch}`} aria-hidden />
      {label}
    </span>
  );
}
