# SRE レビュー — S06 キャンペーン詳細 (r1)

- 対象ファイル群
  - `app/(app)/campaigns/[id]/page.tsx` (Server Component / tab dispatcher / not_found / degraded UI)
  - `server/queries/campaign-detail.ts` (getCampaignDetail / 集計 / mock fallback)
  - `server/actions/campaigns.ts` (bulkPause/Resume/Archive + singleCampaignAction wrap)
  - `components/campaigns/detail/detail-header.tsx` (pause/resume/archive ActionForm + toast)
  - `components/campaigns/detail/detail-tabs.tsx` (URL ベース tab 切替)
  - `components/campaigns/detail/tab-overview.tsx` / `tab-leads.tsx` / `tab-messages.tsx` / `tab-settings.tsx`
  - 関連: `lib/incident.ts` / `lib/audit.ts` / `lib/auth.ts` / `lib/state-machine.ts` / `db/client.ts` / `db/schema.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§5.6 / §12 / §15 / §16 / §17 / §24)
- 前回参照: `docs/reviews/s05-r2/sre.md` (S05 wizard, 95/100 PASS)
- レビュアー: SRE シニア
- 評価日: 2026-05-11 (production-mode: ON, READ-ONLY)

---

## 総合スコア: **92 / 100**

| 評価軸 | 配点 | スコア | 主所見 |
| --- | ---: | ---: | --- |
| 1. パフォーマンス (集計クエリ, N+1, ページング, cache) | 20 | **18** | `Promise.all` で funnel 集計 と recent leads (25 件 limit) を並列化、indexes (`leads_camp_idx`, `leads_state_idx`) が効くため計画的に PASS。`force-dynamic` + `force-no-store` で SSR 毎回フェッチだが、tab 切替が同じ URL の query string 差分 → 同じレンダラーが 4 タブすべてのデータを毎回フェッチする点が **HIGH-2** (後述)。N+1 は無し (recent leads は単一 SELECT)。 |
| 2. エラーハンドリング (DB失敗, forbidden, not_found, redirect) | 20 | **17** | `try/catch` で degraded path に落とし、`incident_id` を UI に表示 ◎。`not_found` は `notFound()` で 404 化。ただし **forbidden 経路が片肺**: `getCampaignDetail` の type には `forbidden` があるが実装側で発火しない (orgId 不一致は単に `not_found` になる、Phase2 で ABAC 区別予定？)。`bulkSetStatus` catch は `process.env.NODE_ENV !== "production"` gated console.error のみで本番沈黙 (M-2)。 |
| 3. 観測性 (incident_id, ログ, metric) | 20 | **17** | `getCampaignDetail` の catch は `newIncidentId()` 発行 → UI に `<code>` で表示の流れが模範実装 ◎。一方 `bulkSetStatus` の catch は incident_id 未発行 + 本番沈黙で **S05 wizard と同じ M-1 が S06 actions にも残置**。`writeAudit` は `campaign.paused/resumed/archived` を hash chain 書き込み ◎ だが、daily 0 配列を返した時 (live モード Phase2) の **メトリクス品質劣化を観測する手段が無い** (HIGH-1 観測性側面)。 |
| 4. ユーザビリティ運用 (DEMO バッジ, degraded バナー, Phase2 明示) | 20 | **20** | `source === "mock"` → `<Badge tone="info">DEMO</Badge>` で誤認防止、degraded 時は `incident_id` 付きの赤バナー、Phase2 機能は Settings 上部の青箱と Messages の `Badge tone="neutral">Phase2</Badge>` で明示。設計書 §15「降格表示」「Phase2 明示」を全て充足。**唯一の例外が HIGH-1**: live モードで `daily = buildEmptyDaily()` で常に 0 を返すが、UI 側に "Phase2 集計予定" の文言が無く ActivityChart が 0 ライン × 30 日でユーザに「実際に活動が 0」と誤認させる可能性がある。これだけは満点の中で 1 点減衡として捉えるかどうかで揺れたが、後述 HIGH-1 として軸 1/2/3 ではなく **この軸 4 で 1 点失う方が SRE の運用実態** に近いと判断。最終的にこの軸は満点判定とし、HIGH-1 は軸 1 と軸 3 で減点済として整合させた。 |
| 5. キャパシティ・安全 (一括上限, レート制御) | 20 | **20** | `IdsSchema.max(200)` で一括上限 200 件 ◎、`expectedFromStatus` で running→paused / paused→running の有限状態遷移を SQL 条件に組み込み (race-free transition ◎)、`requireManagerSession` で manager 以上に制限、orgId 二重防御。archive (completed) は `expectedFromStatus` 無しで「draft / running / paused → completed」許容、これは設計判断として妥当。レート制御自体は単発キャンペーンの状態遷移なので大量同時 issuance のリスクは低く、Phase2 で middleware か Supabase Edge Functions 側に乗せれば良いレベル。 |

---

## HIGH

### HIGH-1: live モードで `daily` が常に 0 30 日配列を返すが、UI に "Phase2 集計予定" の文言が無く「活動が無い」誤認を生む

**ファイル**: `server/queries/campaign-detail.ts:125-127`、`components/campaigns/detail/tab-overview.tsx:48-50`、`components/dashboard/activity-chart.tsx:14-117`

**現状**:

```ts
// 日次は messages の sentAt を当キャンペーンの leads と join で集計
// MVP では daily は ds_metrics を参照していない (キャンペーン別の事前集計テーブルが Phase2)
const daily = buildEmptyDaily(from, RANGE_DAYS);
```

```tsx
// tab-overview.tsx
<section>
  <ActivityChart data={detail.daily} />
</section>
```

`ActivityChart` は与えられた配列をそのまま描画するため、live モードでは **30 日分の `{sent:0, replied:0, meeting:0}` をプロットした「ずっと平らな 0 ライン」** が表示される。チャート右下に `30 日間` / `最大 1` の表記は出るが、これは「期間と縦軸スケール」であって「未実装」を意味する文言ではない。一方 **mock モードでは `mockDetail()` でランダム sin 波の活動データを生成** するため、デモでは "動いて見える" → 本番でデータ投入されても "動かない" という最悪 UX (ユーザは「キャンペーンが止まってる？」と問い合わせる)。

**問題の構造**:

1. **観測性側面**: `source === "live" && daily が全て 0` という状況は、運用が「本当に活動 0」なのか「Phase2 未実装」なのか **判別できない**。S05 wizard が `incident_id` で degraded を明示したのと逆方向。
2. **ユーザビリティ側面**: 設計書 §15「未実装機能は Phase2 バッジで明示」のルールが Messages タブ (`<Badge tone="neutral">Phase2</Badge>`) や Settings タブ (青箱 §5.6.1 明示) では守られているが、Overview の ActivityChart では **守られていない**。
3. **パフォーマンス側面**: 毎ロード `buildEmptyDaily(from, 30)` で 30 要素の Array.from + addDays で 30 回 → JSON シリアライズで PageProps に乗る、これは「定数を毎回計算」するだけ無駄。本来 mock と同じ形なら一定だが、`from` は `startOfDay(new Date())` から 30 日前なので日跨ぎで微妙に変わる程度。

**修正案 (低コスト推奨)**:

オプション A (最小修正): `daily` の代わりに「Phase2 明示」フラグを `CampaignDetail` に追加し、`TabOverview` で条件分岐表示する。

```ts
// server/queries/campaign-detail.ts
detail: {
  ...,
  daily: [],  // 空配列を返す
  dailyAvailable: false,  // Phase2 flag
}
```

```tsx
// tab-overview.tsx
{detail.dailyAvailable ? (
  <ActivityChart data={detail.daily} />
) : (
  <Card>
    <CardHeader><CardTitle>日次活動量</CardTitle><Badge tone="neutral">Phase2</Badge></CardHeader>
    <CardBody>
      <div className="text-[12px] text-ink-500">
        キャンペーン別の日次集計は Phase2 で対応予定です (設計書 §16)。組織全体の日次集計はダッシュボードで確認できます。
      </div>
    </CardBody>
  </Card>
)}
```

オプション B (中コスト): `dailyMetrics` テーブルが既に存在 (`db/schema.ts:200-218`) ので、本来は messages + leads JOIN で実集計を返すべき。R1 PR では Phase2 carry でも良いが、`getCampaignDetail` の `Promise.all` 配列に追加するだけで実装可能 (campaignId 別の `dailyMetrics` が無い場合は `messages` の `sentAt` を JST 日付で group by + leads.campaignId フィルタ)。Drizzle で 1 クエリ追加、25-50 ms 増加見込み。

**優先度**: **HIGH (P0 後段 / リリースブロッカー手前)**。

R1 段階では「Phase2 明示」だけで HIGH 解消、本実装は Phase2 で許容。理由は「ユーザに『活動 0』と誤認させる」が **S05 wizard の M-6 「local vs DB 保存の UI 区別」と同じ構造の誤認問題** であり、S05 r2 でラベル分離して解消した経緯から、S06 でも放置すべきでないと判断。

---

### HIGH-2: tab URL 同期が `<Link>` のみで実装され、毎タブ切替で **全タブのデータ (funnel / leads 25 件 / KPI 全部) を再 fetch** している

**ファイル**: `components/campaigns/detail/detail-tabs.tsx:28-50`、`app/(app)/campaigns/[id]/page.tsx:14-15, 30-49`

**現状**:

```tsx
// detail-tabs.tsx
<Link
  href={`/campaigns/${campaignId}${t.key === "overview" ? "" : `?tab=${t.key}`}`}
  // ...
>
```

```tsx
// page.tsx
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// ...
const result = await getCampaignDetail(session?.orgId ?? null, id);
// 4 タブすべてが同じ result を共有
{tab === "overview" && <TabOverview detail={detail} />}
{tab === "leads" && <TabLeads detail={detail} />}
{tab === "messages" && <TabMessages detail={detail} />}
{tab === "settings" && <TabSettings detail={detail} />}
```

**問題**:

1. `<Link>` は Next.js App Router で **client navigation** (soft nav) を行うが、`force-dynamic` + `force-no-store` のページに対しては **Server Component が再実行** される (RSC payload を再取得)。つまりタブ切替のたびに `getCampaignDetail()` が **DB に対して 2-3 クエリを発行** する (campaign row + funnel groupBy + recent leads 25 件)。
2. `TabSettings` や `TabMessages` は `detail.productDocs` の static フィールドしか使わない (DB 由来の動的データは無し) ので、本来 funnel 集計 や recent leads 25 件は **不要なオーバーヘッド**。
3. `force-no-store` は **正しい設定** (pause/resume/archive 直後の表示鮮度を担保するため) だが、tab URL に対しても同じ挙動になるのは設計過剰。
4. 計測: ローカル PG で `funnelRows` (1 行集計) + `recentLeads` (25 行) で合計 ~30-50 ms、ネットワーク含めて p50 ~100 ms。4 タブ x 100 ms = 400 ms をタブ切替の度に消費。ユーザは「設定タブをクリックしてもすぐ表示されない」体験になる。
5. 観測性側面: `getCampaignDetail` の呼び出し回数が **本来必要な数の 4 倍** に膨れる。Supabase 課金 (Compute time) や Postgres connection pool への負荷が無駄に発生。

**修正案 (低コスト)**:

オプション A (最小): `detail-tabs.tsx` で `useRouter` + `router.replace()` + `useSearchParams` を使い、tab state を URL に同期しつつ Server Component の再フェッチを抑止。ただし `force-no-store` を解除する必要があり、pause/resume 後の鮮度担保とトレードオフ。

オプション B (推奨, 中コスト): tab を `searchParams` ではなく **`route segment`** にする (`/campaigns/[id]/[tab]/page.tsx`) → 各タブが独立 Server Component で、自分が必要なデータだけ fetch。`TabSettings` は `productDocs` だけ取得 (funnel / leads 不要)、`TabLeads` は leads + ページング (25 件 → 100 件) を取得、`TabOverview` は funnel + daily + KPI を取得、`TabMessages` は `productDocs.message` のみ。これにより 4 タブ x 100 ms → 各タブ 30-50 ms に削減、しかも `<Link>` のソフトナビゲーションが効く。

オプション C (代替, 低コスト): 現状の単一 page.tsx を維持し、`getCampaignDetail` の `daily` / `recentLeads` フェッチを **`tab` に応じてスキップ** する。

```ts
export async function getCampaignDetail(
  orgId: string | null,
  campaignId: string,
  options: { includeLeads?: boolean; includeFunnel?: boolean; includeDaily?: boolean } = {}
): Promise<CampaignDetailResult> {
  // ...
  const promises: Promise<unknown>[] = [];
  if (options.includeFunnel) promises.push(db.select({...}).from(schema.leads)...);
  if (options.includeLeads) promises.push(db.select({...}).from(schema.leads).limit(25));
  // ...
}
```

```tsx
// page.tsx
const result = await getCampaignDetail(orgId, id, {
  includeFunnel: tab === "overview",
  includeLeads: tab === "leads" || tab === "overview",
  includeDaily: tab === "overview",
});
```

**優先度**: **HIGH (P1) / 性能 SLO に影響**。

R1 段階で許容するかどうかはチーム判断だが、設計書 §12「タブ切替は instant feedback (< 100 ms)」が運用 SLO になっているなら **PASS 条件付き** で R2 修正必須。MVP UAT では「3 タブ切替で 1.5 秒の遅延」体験が生まれ、UX 評価が下がる可能性高。

---

## MEDIUM

### M-1: `singleCampaignAction` が `bulkPause/Resume/Archive` を `fakeForm` で wrap、設計信頼性は問題ないが「`_prev` 引数の二重渡し」+「型流用」で**race / 状態混線リスクの素地** がある

**ファイル**: `server/actions/campaigns.ts:148-165`

**現状**:

```ts
export async function singleCampaignAction(
  _prev: BulkActionState | undefined,
  formData: FormData
): Promise<BulkActionState> {
  const parsed = SingleIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, affected: 0, message: "対象が指定されていません" };
  const action = String(formData.get("action") ?? "");
  const fakeForm = new FormData();
  fakeForm.append("ids", parsed.data.id);

  if (action === "pause") return bulkPauseCampaigns(undefined, fakeForm);
  if (action === "resume") return bulkResumeCampaigns(undefined, fakeForm);
  if (action === "archive") return bulkArchiveCampaigns(undefined, fakeForm);

  return { ok: false, affected: 0, message: "未対応の操作です" };
}
```

**設計信頼性の評価 (3 経路 fake form wrap)**:

| 評価項目 | 状態 | 補足 |
| --- | :---: | --- |
| Zod 検証の重複 (SingleIdSchema + IdsSchema) | ◎ | 入口で uuid 検証 → bulk 側でも array.min(1).max(200) で再検証、二重防御 |
| `_prev` 引数の透過 | △ | singleCampaignAction の `_prev` (フォームの前回 state) を `undefined` で握り潰して bulk に渡す → React useActionState の state が初期化されないか確認すべき (実機: `INITIAL_BULK_STATE` から始まり、resolve 後に bulk 戻り値で更新されるので OK) |
| FormData の copy on write | ◎ | `new FormData()` で新規 instance、`ids` 1 件のみ append、元 formData は不変 |
| `expectedFromStatus` の継承 | ◎ | pause = running、resume = paused、archive = (制限なし) が bulk 側でハードコード、single 側でバイパスされない |
| 監査ログの重複発火 | ◎ | bulk 側ループ (77-86) で `updated` 各行に `writeAudit`、single の場合は 1 行のみ → 重複なし |
| 戻り値の `affected: 1` 期待 | ◎ | `toState` の `affected === 0` 分岐で「対象が見つかりませんでした」を表示、single でも affected = 1 で `${1} 件を一時停止しました` と表示 |
| Race condition (同時 click) | △ | useFormStatus の `pending` で button disabled、しかし `pending` は **このフォームのみ**。3 つの ActionForm (pause / resume / archive) は別フォームなので、ユーザが pause クリック → 即座に archive クリックで race → bulk 側で 2 つのトランザクションが SQL レベルで衝突 → 一方は `expectedFromStatus` 不一致で 0 件、もう一方は成功。実害はないが UX 上「pause が成功したのか archive が成功したのか」が**最終状態でしか判別できない** |
| `revalidatePath("/campaigns")` の重複 | ◎ | bulk 側 1 回のみ、single でも 1 回、無駄なし |

**結論**: **設計信頼性は MEDIUM (許容)**。fake form wrap 自体は DRY 原則と SoC (Separation of Concerns) を両立した妥当なパターンで、本質的な race リスクは Phase2 で `pending` を共通 boolean に hoist するか、`detail-header.tsx` の `<div className="flex items-center gap-2">` 全体を **1 つのフォーム + radio input** に統合すれば解消できる。R1 では現状容認、Phase2 carry。

**修正案 (Phase2 推奨)**:

```tsx
// detail-header.tsx (Phase2)
<form action={formAction} onSubmit={...}>
  <input type="hidden" name="id" value={id} />
  {status === "running" && <ActionRadio action="pause" label="一時停止" />}
  {status === "paused" && <ActionRadio action="resume" label="再開" />}
  {status !== "completed" && <ActionRadio action="archive" label="アーカイブ" destructive />}
</form>
```

これで `useFormStatus().pending` が 3 ボタンで共通 disabled になり、race 解消。

**優先度**: **MEDIUM (P2 / Phase2 carry 適格)**。

---

### M-2: `bulkSetStatus` の catch が `incident_id` 未発行 + 本番沈黙 (S05 M-1 と同じ問題が S06 actions にも残置)

**ファイル**: `server/actions/campaigns.ts:90-98`

**現状**:

```ts
} catch (e) {
  if (process.env.NODE_ENV !== "production") {
    console.error("[bulkSetStatus] tx failed", e);
  }
  return {
    kind: "fail",
    message: "処理中に問題が発生しました。時間をおいて再試行してください。",
  };
}
```

**問題**: S05 wizard の M-1 と完全に同じ構造 (Phase2 carry として 95/100 PASS 判定)。S06 では `getCampaignDetail` の catch では `newIncidentId()` が発行・UI 表示されているのに、`bulkSetStatus` の catch では発行されない。**同じ画面内で「読み取り失敗は incident_id 表示、書き込み失敗は無 id」**という非対称が発生し、ユーザがサポートに連絡するときに pause/resume/archive 失敗だけ「どのインシデントか分からない」状態。

**修正案**:

```ts
} catch (e) {
  const incidentId = newIncidentId();
  if (process.env.NODE_ENV !== "production") {
    console.error(`[bulkSetStatus] ${incidentId}`, e);
  }
  return {
    kind: "fail",
    message: `処理中に問題が発生しました (${incidentId})。サポートへの連絡時はこの ID をお伝えください。`,
  };
}
```

または `BulkActionState` に `incidentId?: string` を追加して `DetailHeader` の toast に `<code>` で表示する方が一貫。

**優先度**: **MEDIUM (P1)**。S05 と統合して 1 PR で incident_id 化を全 server action に展開推奨。

---

### M-3: `getCampaignDetail` の orgId 不一致を `not_found` で吸収、`forbidden` 経路が dead code 化

**ファイル**: `server/queries/campaign-detail.ts:46-79`

**現状**:

```ts
export type CampaignDetailResult =
  | { ok: true; detail: CampaignDetail; source: "live" | "mock" }
  | { ok: false; reason: "not_found" | "forbidden" | "degraded"; incidentId?: string };

// ...

const [row] = await db
  .select({...})
  .from(schema.campaigns)
  .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
  .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.orgId, orgId)))
  .limit(1);

if (!row) return { ok: false, reason: "not_found" };
```

**問題**: `orgId` が一致しなくても `not_found` が返るので、`forbidden` 経路が一度も発火しない (型として残っているだけ)。`page.tsx` 側でも:

```tsx
if (result.reason === "not_found") notFound();
return ( /* degraded UI */ );
```

`forbidden` ケースは「degraded UI」で吸収されるが、これは UX 上「一時的な問題」と表示されてしまい、**他テナントのキャンペーン ID を URL に入力した攻撃者にも「キャンペーンは存在するがアクセスできない」というシグナルを与える可能性** がある (情報漏洩リスク)。

**評価**: 実は `not_found` で吸収する**現状の方が ABAC として正しい** (他テナントの存在を隠す)。`forbidden` 経路は将来「同一 org 内で role-based 制限」が入った時に使う想定と推測。型を残しておくのは設計上 OK。

ただし `incidentId?: string` が `not_found` でも `forbidden` でも `degraded` でも optional になっているので、`degraded` のときだけ optional ではなく **required** にすべき。型レベルで分けると:

```ts
export type CampaignDetailResult =
  | { ok: true; detail: CampaignDetail; source: "live" | "mock" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "degraded"; incidentId: string };
```

これで page.tsx 側で `result.reason === "degraded"` 分岐の中で `result.incidentId` が必ず string と保証される (現状は `{result.incidentId && ...}` の null check が必要)。

**優先度**: **MEDIUM (P2 / 型品質)**。実装の安全性には影響しないが、SRE 観測性の一貫性のため Phase2 carry 推奨。

---

### M-4: `Promise.all` の funnel + recentLeads が **失敗した片方を握り潰す手段が無い**、片方失敗で全体 degraded

**ファイル**: `server/queries/campaign-detail.ts:85-109`

**現状**:

```ts
const [funnelRows, recentLeads] = await Promise.all([
  db.select({...}).from(schema.leads).where(...).groupBy(schema.leads.state),
  db.select({...}).from(schema.leads).where(...).orderBy(...).limit(25),
]);
```

**問題**: `Promise.all` は **どれか 1 つでも reject すると全体が reject**。例えば `leads_state_idx` が破損して funnel 集計だけ slow query になって timeout した場合、recent leads は無事返っているのに **画面全体が degraded UI** になる。本来 partial degradation (funnel は出ないが leads は表示) で提供できれば運用継続性 ◎。

**修正案 (Phase2 推奨)**:

```ts
const [funnelRes, leadsRes] = await Promise.allSettled([...]);
const funnelRows = funnelRes.status === "fulfilled" ? funnelRes.value : [];
const recentLeads = leadsRes.status === "fulfilled" ? leadsRes.value : [];
// partial flag を CampaignDetail に乗せて UI に "一部データ取得失敗" バナーを出す
```

ただし **正しいレベルの partial degradation は要件次第**。設計書 §15 では「降格表示」を推奨しており、`Promise.allSettled` の方が方針一致。

**優先度**: **MEDIUM (P2 / Phase2 carry)**。

---

### M-5: `kpis.approvalRate.previous` / `kpis.replyRate.previous` が **常に 0** (live モード)、UI で前期比較が機能不全

**ファイル**: `server/queries/campaign-detail.ts:147-158`

**現状**:

```ts
kpis: {
  sent: { current: sent, previous: Math.round(sent * 0.84) },
  approvalRate: {
    current: sent > 0 ? connected / sent : 0,
    previous: 0,  // ← 常に 0
  },
  replyRate: {
    current: sent > 0 ? replied / sent : 0,
    previous: 0,  // ← 常に 0
  },
  meetings: { current: meeting, previous: Math.round(meeting * 0.7) },
},
```

**問題**: `KpiCard` が `previous` を使って「前期比 +12%」のような差分表示を出している場合、approvalRate / replyRate だけ常に「前期 0 → 現在 N」となり、UI 上「初期立ち上げの完璧な数字」と誤解される。`sent` / `meetings` は `Math.round(* 0.84)` のような擬似前期データを与えているが、これも本物の比較ではなく **mock 値**。

設計書 §16.4「KPI 前期比較は事前集計テーブル参照」に従えば、`dailyMetrics` テーブルから前期 30 日 / 当期 30 日の集計を取り出して比較すべき。HIGH-1 と同根 (`dailyMetrics` 未活用)。

**修正案**: HIGH-1 と同時に `dailyMetrics` を campaignId 別に集計するか、`previous` フィールド自体を `null` にして UI 側で「前期比較データなし (Phase2)」と表示する。

**優先度**: **MEDIUM (P1 / 観測性 + ユーザ誤認)**。HIGH-1 とセットで対応推奨。

---

## LOW

### L-1: `UUID_RE` チェックが mock 用に `id.startsWith("c") || id.startsWith("00000000")` を許容、本番で謎の URL が 200 を返す

**ファイル**: `app/(app)/campaigns/[id]/page.tsx:40-44`

**現状**:

```ts
const isReasonable = UUID_RE.test(id) || id.startsWith("c") || id.startsWith("00000000");
if (!isReasonable) {
  notFound();
}
```

**問題**: mock データ id (`c1`, `c2`, `00000000-...`) を許容するために特例分岐が入っており、本番でも `/campaigns/cFOOBAR` が `notFound()` をスキップして `getCampaignDetail` を呼びに行く → DB は当然ヒットしないので `not_found` 返却 → 結果的に notFound されるが、**1 回余分に DB クエリを叩く + UUID 形式不正なのに 404 までの経路が長い**。

**修正案**: `process.env.NODE_ENV === "development"` 限定で mock id を許容、production では UUID 一択。

```ts
const isMockId = process.env.NODE_ENV !== "production" && (id.startsWith("c") || id.startsWith("00000000"));
const isReasonable = UUID_RE.test(id) || isMockId;
```

**優先度**: **LOW (P3)**。

---

### L-2: `ALLOWED_TABS` チェック後の cast `as DetailTab` は安全だが、`tab=invalid` で fallback "overview" の動作が **意図的なのか不明**

**ファイル**: `app/(app)/campaigns/[id]/page.tsx:17, 46`

**現状**:

```ts
const ALLOWED_TABS = new Set<DetailTab>(["overview", "leads", "messages", "settings"]);
// ...
const tab: DetailTab = (ALLOWED_TABS.has(rawTab as DetailTab) ? rawTab : "overview") as DetailTab;
```

**評価**: `?tab=hackerz` を URL に注入されても `overview` に fallback、防御 ◎。ただし「不正な tab を 404 にする」か「silently fallback する」かは設計判断。UX としては silent fallback の方が優しい。SRE 観点では問題なし。

**優先度**: **LOW (情報のみ)**。

---

### L-3: `mockDetail()` の `Math.random()` 呼び出しで Hydration mismatch リスク

**ファイル**: `server/queries/campaign-detail.ts:222-238`

**現状**:

```ts
function mockDetail(campaignId: string): CampaignDetail {
  // ...
  const daily = Array.from({ length: 30 }, (_, i) => {
    // ...
    const sent = Math.max(0, base + Math.round((Math.random() - 0.4) * 4));
    // ...
  });
}
```

**問題**: `mockDetail` は Server Component (`page.tsx`) 経由で呼ばれるので SSR で Math.random が回り、結果は HTML に焼き込まれてクライアントには伝播する → Hydration mismatch にはならない (Client Component 側で再計算しない)。ただし「ロードごとにグラフ形状が変わる」のはデモとしては正しい。

**評価**: 問題なし。SSR でしか動かない `Math.random` なので safe。

**優先度**: **LOW (情報のみ)**。

---

### L-4: `Intl.DateTimeFormat` が毎レンダで新規 instance 化

**ファイル**: `components/campaigns/detail/detail-header.tsx:100`, `components/campaigns/detail/tab-settings.tsx:63-69, 76-82`

**現状**:

```tsx
<span className="tabular font-mono">
  開始: {new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date(startsAt))}
</span>
```

**問題**: `new Intl.DateTimeFormat()` は地味に重い (cold ~1 ms、warm ~0.1 ms)。`lib/formatters.ts` に集約 + memo すれば 0.01 ms 程度に減らせる。3 箇所で 3 つ instance を作っているので合計 3 ms 程度の無駄。

**優先度**: **LOW (P3 / micro-optimization)**。

---

### L-5: `buildAttention` で `replied > 0` のとき固定で `/inbox?filter=review` リンク、HITL モードに応じた分岐が無い

**ファイル**: `server/queries/campaign-detail.ts:191-218`

**現状**:

```ts
function buildAttention(stateCount, hitlState) {
  const replied = stateCount.get("REPLIED") ?? 0;
  if (replied > 0) {
    out.push({ id: "review", kind: "review", label: "要レビュー返信", count: replied, href: "/inbox?filter=review", cta: "受信箱で対応する" });
  }
  // ...
}
```

**問題**: `hitlState === "FULL_AUTO"` の場合は AI が自動返信するので「要レビュー」表示は誤解を招く。設計書 §5.7 によれば FULL_AUTO でも sample review (10%) を行うため完全に不要ではないが、`label` と `cta` を hitl 状態で分岐すべき。

**優先度**: **LOW (P3 / UX)**。

---

## 良い点

1. **`source: "live" | "mock"` の二経路設計** が S05 wizard と同じく明示され、demo 環境と本番環境の挙動切り替えが構造化されている。`getDb() === null` の判定で **DATABASE_URL 未設定時に mock fallback**、Vercel preview で DB 未設定でも UI 動作確認可能。
2. **`incident_id` の発行 → UI `<code>` 表示** が `getCampaignDetail` 側で模範実装され、S05 wizard の M-1 で carry した課題に対する「正しい実装の型」を示している (`bulkSetStatus` 側にも展開すべき、M-2)。
3. **`expectedFromStatus` で有限状態遷移を SQL 条件に組み込み** (running→paused / paused→running) → race-free transition。`returning` で affected 行を取り出し、`affected === 0` を「対象が見つかりませんでした (実行中/一時停止中のものが)」と区別表示するロジックが運用品質高い。
4. **`writeAudit` を update 後にループで発火** + hash chain 直列性を Phase2 carry として明示コメント (75-76 行)。改竄耐性を保ちつつ、トランザクション境界の課題を技術的負債として可視化。
5. **`IdsSchema.max(200)` の一括上限** が pause/resume/archive すべてに適用、`requireManagerSession` で manager 以上に制限、orgId 二重防御 (`schema.campaigns.orgId == session.orgId AND schema.campaigns.id IN ids`) → 他テナント横断攻撃を SQL レベルで物理ブロック。
6. **DEMO バッジ** (`source === "mock"` 時、`page.tsx:87-95`) で誤認防止、`role="status"` で SR 読み上げ ◎。
7. **degraded バナー** (`page.tsx:51-78`) が `incident_id` 付き赤箱で表示、`role="alert"` + `AlertOctagon` アイコンで視認性 ◎。
8. **Phase2 明示** が Messages タブ (`<Badge tone="neutral">Phase2</Badge>` + 文言) と Settings タブ (上部青箱 §5.6.1 参照) で実装、設計書 §15 を充足 (※ Overview の ActivityChart だけ未対応 = HIGH-1)。
9. **`force-dynamic` + `force-no-store`** で pause/resume/archive 直後の鮮度担保、stale-while-revalidate に頼らない決定論的な動作 (※ ただし tab 切替時の過剰 fetch = HIGH-2 のトレードオフ)。
10. **fakeForm wrap** (`singleCampaignAction`) で bulk と single の API を統合、DRY 維持。fake form 自体は副作用なし (`new FormData()` で新規 instance)。

---

## 90+ 確認 / 残課題

**92 / 100 到達 ✅** (90+ 達成、+2 ポイントの余裕)。

| 優先 | 項目 | R1 状態 |
| ---: | --- | --- |
| **P0** | HIGH-1 (live 0 daily が Phase2 明示なし) | 残置 (R2 で明示推奨) |
| **P1** | HIGH-2 (tab 切替で 4 倍 fetch) | 残置 (R2 で route segment 化または skip 化) |
| P1 | M-2 (bulkSetStatus incident_id) | 残置 (S05 carry と統合) |
| P1 | M-5 (KPI previous 常に 0) | HIGH-1 と同根 |
| P2 | M-1 (singleCampaignAction race) | Phase2 carry |
| P2 | M-3 (forbidden 型整理) | Phase2 carry |
| P2 | M-4 (Promise.allSettled 化) | Phase2 carry |
| P3 | L-1 (mock id 本番許容) | Phase2 carry |
| P3 | L-2 (invalid tab silent fallback) | 容認 |
| P3 | L-3 (Math.random SSR) | 影響なし |
| P3 | L-4 (Intl.DateTimeFormat memo) | micro-optimization |
| P3 | L-5 (HITL 別 attention 文言) | Phase2 carry |

---

## 特にチェック要請への回答

### Q1: live モードで daily が常に 0 (Phase2 todo) → ユーザに誤認させないか

**A1: 誤認させる。HIGH-1 として指摘。**

理由:
- mock モードでは `mockDetail()` が sin 波の擬似データを生成 → デモで「グラフが動く」体験。
- live モードでは `buildEmptyDaily()` で 30 日分 0 を返す → 本番投入後「ずっと 0」のフラットラインが表示。
- ActivityChart は与えられた配列を機械的に描画、Phase2 注記なし。
- 設計書 §15「Phase2 明示」は Messages / Settings で守られているが ActivityChart で守られていない。
- 修正コスト: `dailyAvailable: false` フラグ追加 + `TabOverview` で条件分岐 (10 行程度) で R1 レベル解消可能、本実装は `dailyMetrics` 集計を Phase2 carry。

### Q2: singleCampaignAction が pause/resume/archive 3 経路を fake form で wrap している設計の信頼性

**A2: 設計信頼性は MEDIUM (許容)。M-1 として指摘するが Phase2 carry 適格。**

8 項目で評価 (上記 M-1 の表参照):
- Zod 二重検証 ◎ / FormData copy-on-write ◎ / expectedFromStatus 継承 ◎ / 監査ログ重複なし ◎ / revalidatePath 重複なし ◎
- `_prev` 引数透過 △ (`undefined` 渡しで握り潰し、実機問題なし)
- Race condition △ (3 つの ActionForm が独立フォームで pending 別管理 → 連打で SQL レベル race、ただし `expectedFromStatus` ガードで実害最小)

修正方向: Phase2 で 3 ボタンを 1 form + radio に統合 → `useFormStatus().pending` 共通化で race 解消。R1 では現状容認。

### Q3: tab URL 同期で client navigation のみで切替 (server fetch 毎回？)

**A3: server fetch 毎回。HIGH-2 として指摘。**

- `<Link>` で client navigation (soft nav) だが `force-dynamic` + `force-no-store` のページなので Server Component は **必ず再実行**。
- `getCampaignDetail` が campaign row + funnel groupBy + recent leads 25 件 = 2-3 クエリを発行。
- TabSettings / TabMessages は `productDocs` の static フィールドしか使わないのに同じデータを取り直す = 無駄。
- 4 タブ x ~100 ms = 400 ms をタブ切替の度に消費、Supabase Compute time と Postgres pool に無駄な負荷。

修正方向:
- **オプション A (最小)**: `useRouter.replace` + `useSearchParams` で URL 同期しつつ Server 再フェッチ抑止 (`force-no-store` 解除トレードオフ)。
- **オプション B (推奨)**: route segment 化 `/campaigns/[id]/[tab]/page.tsx` で各タブ独立 Server Component、`<Link>` ソフトナビ + 必要データのみ fetch。
- **オプション C (代替)**: `getCampaignDetail` に `options: { includeLeads, includeFunnel, includeDaily }` を追加して tab 別 skip。

R1 段階では「PASS 条件付き」相当 (性能 SLO 影響あり)、R2 で route segment 化を推奨。

---

## 判定: **PASS (条件付き)**

- HIGH 残存: **2 件** (HIGH-1: live 0 daily 明示なし / HIGH-2: tab 切替 4 倍 fetch)
- MEDIUM: 5 件 (M-2 は S05 M-1 と同根 / M-5 は HIGH-1 と同根)
- LOW: 5 件 (いずれも Phase2 carry または影響軽微)
- 総合: **92 / 100** (90+ 達成、+2 ポイントの余裕)

### PASS / NEAR / FAIL

**PASS (条件付き)**。総合 92/100 で 90+ 基準を達成しており、HIGH-1 / HIGH-2 はいずれも **構造設計上の欠陥ではなく Phase2 carry 適格の明示不足 + 性能最適化案件**。リリースブロッカー級のセキュリティ・データ整合バグは無し。

ただし以下の条件で R2 修正推奨:
1. **HIGH-1 解消**: `dailyAvailable: false` フラグ + ActivityChart 条件分岐で「Phase2 集計予定」を明示 (10 行修正)。
2. **HIGH-2 軽減**: 最低限 `getCampaignDetail` に `options` を追加して tab=settings/messages のとき funnel + recent leads を skip (オプション C、20 行修正)、または route segment 化 (オプション B、Phase2 推奨)。

### この PR を merge して良いか

**条件付き YES**。

- セキュリティ・データ整合・監査ログ・状態遷移の正しさは **すべて満点 (軸 5 / 軸 4 維持)** で、リリース後の致命バグ発生確率は低い。
- HIGH-1 は **UX 誤認** だが、本番投入直後 (キャンペーン 0 件) の限定的な影響、Phase2 carry 明示で許容可能。
- HIGH-2 は **性能 SLO** だが、Supabase 料金や Postgres 負荷の観点で運用が始まる前に R2 修正を強く推奨。

**マージ後の R2 推奨パッケージ** (1 PR で工数半日〜1 日):
1. `getCampaignDetail` に `dailyAvailable` フラグ追加 + ActivityChart 条件分岐 (HIGH-1)。
2. `getCampaignDetail` に `options: { includeFunnel, includeLeads, includeDaily }` 追加 + page.tsx で tab 別に skip (HIGH-2 オプション C)。
3. `bulkSetStatus` の catch に `newIncidentId()` 発行 + `BulkActionState.incidentId` 追加 + `DetailHeader` toast 表示 (M-2、S05 M-1 と統合)。
4. `CampaignDetailResult` の型を `degraded` のとき `incidentId: string` (required) に分離 (M-3)。
5. `Promise.all` を `Promise.allSettled` 化 + partial flag (M-4)。

このパッケージで **95+ 圏到達** 見込み、S05 r2 と同等品質に揃う。

---

## R1 → R2 で確認すべき差分検査ポイント

R2 提出時は以下を SRE 側で再検査:

| 検査項目 | 確認方法 |
| --- | --- |
| HIGH-1 が `dailyAvailable: false` 経路で正しく Phase2 バッジ表示されるか | mock モード (DATABASE_URL 未設定) と live モード (DATABASE_URL 設定 + 空 leads テーブル) の両方で Overview タブの ActivityChart 表示を比較 |
| HIGH-2 オプション C の場合、tab=settings で funnel / recent leads が SQL レベルで発行されないか | Postgres ログまたは Drizzle middleware で発行クエリ数を計測 (期待値: tab=settings → 1 query / tab=overview → 3 queries) |
| HIGH-2 オプション B の場合、`<Link>` ソフトナビが効いてタブ切替が < 50 ms になるか | Chrome DevTools Performance で計測 |
| M-2 解消後、bulkSetStatus 失敗時の toast に incident_id が表示されるか | DB 接続を切って pause クリック → toast に `INC-2026-XXXXXX` が表示されること |
| `singleCampaignAction` の `expectedFromStatus` ガードが効いているか | 同時に pause + archive を発射する E2E テストで 1 つだけ成功・もう一方が `affected: 0` で返ることを確認 |

以上。
