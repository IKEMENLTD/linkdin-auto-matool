# CTO Review — S06 キャンペーン詳細 (r1)

**Reviewer**: CTO Agent
**Scope**: `app/(app)/campaigns/[id]/page.tsx`, `server/queries/campaign-detail.ts`, `server/actions/campaigns.ts` (Phase2 / `singleCampaignAction`), `components/campaigns/detail/*` (header / tabs / overview / leads / messages / settings)
**Date**: 2026-05-11
**Verdict**: **PASS (90+)** — 総合 92 / 100

---

## 総合スコア: 92 / 100

| 軸 | スコア | 配点 | コメント |
|---|---|---|---|
| 1. Next.js 15 RSC/Client境界・Server Action・generateMetadata・notFound | **18** | 20 | RSC/Client 切り分け良好、`generateMetadata` async params 対応、notFound/degraded を `result.ok` で分岐。`UUID_RE` の mock 許容ロジックがやや過剰 (後述 MEDIUM-1) |
| 2. TypeScript 型安全・Drizzle・org スコープ | **19** | 20 | `CampaignDetailResult` を discriminated union で表現、Drizzle 全 select に `eq(campaigns.orgId, orgId)` あり。`Record<string, unknown>` の取り回しがランタイムに依存 (MEDIUM-3) |
| 3. データ取得 (Promise.all / N+1 なし) | **17** | 20 | funnel と recentLeads を `Promise.all` で並列、N+1 なし。ただし live の `daily` が常に 0 (HIGH-1)、`approvalRate` の分母が `MESSAGED` ではなく `sent`(=stateCount.get('MESSAGED')) でも分子 connected との整合が不自然 (MEDIUM-2) |
| 4. エラーハンドリング (degraded / not_found / forbidden + incident_id) | **19** | 20 | `degraded` は `newIncidentId()` 発行、本番では console を抑止、`not_found` で `notFound()` 呼び出し。`forbidden` 分岐は union に存在するが現状未使用 (LOW-1) |
| 5. 再利用性 (KpiCard/Funnel/ActivityChart 既存資産流用、命名) | **19** | 20 | `KpiCard` / `Funnel` / `AttentionList` / `ActivityChart` をそのまま流用、`StateChip` / `Badge` / `Card` ファミリも統一。`MessageStep` / `Delivery` 型を Tab 内に局所定義しているのが小さな冗長 (LOW-2) |

**判定: PASS (≥90)**

---

## 重点チェック項目への回答

### 1. UUID_RE と `"c1"` / `"00000000"` モック許容の判定

**該当**: `app/(app)/campaigns/[id]/page.tsx:19-44`

```ts
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const isReasonable = UUID_RE.test(id) || id.startsWith("c") || id.startsWith("00000000");
if (!isReasonable) notFound();
```

**評価**: **MEDIUM-1 (要改善、ブロッキングではない)**

- 設計意図は妥当: `getCampaignDetail` は DB 未接続時に `mockDetail(campaignId)` を返すため、`/campaigns/c1` のような mock 列挙ページ (`server/queries/campaigns.ts:186-195` の `mkRow("c1",...)`) からのリンクで 404 にならないように緩めている。
- ただし以下が混在しており UUID_RE の意義が薄れている:
  - **(a) UUID_RE が極めて緩い**: `/^[0-9a-fA-F-]{36}$/` は 36 文字 hex+`-` ならどの位置にハイフンがあっても通る (`8-4-4-4-12` を強制しない)。`------------------------------------` (`-`×36) や `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa` (hex×36) が通る。
  - **(b) `id.startsWith("c")`**: mock 用 `c1`〜`c10` を許容する意図だが、`"capybara-no-id"` のような誤入力も通り、その先で Drizzle に渡って `invalid input syntax for type uuid` を投げ `degraded` 経路に落ちる。
  - **(c) `id.startsWith("00000000")`**: 用途不明。テスト fixture? ドキュメント化されていない。
- **真の正攻法**: UUID 厳格判定 (`8-4-4-4-12`) を採用し、DB が無い (mock) 場合のみ任意 id を許容する条件分岐に置き換える。例:

```ts
const STRICT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const session = await getSession();
const isMockEnv = !getDb() || !session?.orgId;
if (!STRICT_UUID.test(id) && !isMockEnv) notFound();
```

これで live 環境では UUID 以外 100% notFound、mock 環境のみ任意 id 許容に整理できる。

### 2. `singleCampaignAction` が `fakeForm` を再構築する設計の安全性

**該当**: `server/actions/campaigns.ts:148-165`

```ts
const SingleIdSchema = z.object({ id: z.string().uuid() });
export async function singleCampaignAction(_prev, formData) {
  const parsed = SingleIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { ok: false, affected: 0, message: "対象が指定されていません" };
  const action = String(formData.get("action") ?? "");
  const fakeForm = new FormData();
  fakeForm.append("ids", parsed.data.id);
  if (action === "pause") return bulkPauseCampaigns(undefined, fakeForm);
  ...
}
```

**評価**: **PASS (LOW-3 として軽指摘)**

- セキュリティ的には **安全**。理由:
  - `SingleIdSchema` で `z.string().uuid()` 厳格検証してから ids に詰め直す。配列インジェクション (`ids: [a, b, c]`) を構造的に閉じている。
  - `bulkSetStatus` 内でさらに `IdsSchema` (`z.array(z.string().uuid()).min(1).max(200)`) が二重検証する。
  - org スコープ (`eq(campaigns.orgId, session.orgId)`) と Role 検査 (`requireManagerSession`) が `bulkSetStatus` で集中実施されており、`singleCampaignAction` 経由でも同じガードを通る。
  - `revalidatePath("/campaigns")` も bulk 側で実行されるので無効化されない。
- 軽指摘 (LOW-3):
  - `revalidatePath("/campaigns")` だけが呼ばれ、`revalidatePath(\`/campaigns/${id}\`)` が呼ばれていない。詳細画面の status バッジが古いまま表示される (Next.js 15 RSC キャッシュ)。`bulkSetStatus` 内で `for (const row of updated) revalidatePath(\`/campaigns/${row.id}\`)` を追加するか、`singleCampaignAction` 側で `revalidatePath(\`/campaigns/${parsed.data.id}\`)` を追加すべき。
  - `action` 文字列を `z.enum(["pause","resume","archive"])` で受けないと、未対応値時のメッセージ「未対応の操作です」が UX 的にやや雑 (action が悪意ではなく開発時 typo)。`zod` で型レベル保証するのが安全。
  - 設計負債としては、Bulk アクションを使い回すために `FormData` を 2 回構築するのは将来 `bulkSetStatus` のシグネチャ変更時に壊れる結合度を生む。`bulkSetStatus(ids: string[], session, ...)` のような純関数へリファクタし、`bulkXxxCampaigns` / `singleCampaignAction` 双方から呼ぶ形 (Phase2) が王道。

### 3. `CampaignDetail.productDocs` 型 (`Record<string, unknown>`) の取り扱い

**該当**: `server/queries/campaign-detail.ts:18`, `components/campaigns/detail/tab-messages.tsx:21-22`, `tab-settings.tsx:19-20`

**評価**: **MEDIUM-3**

- スキーマ側 (`db/schema.ts:138`) は `jsonb("product_docs").$type<Record<string, unknown>>()`。json なので「読めば unknown」は型としては安全。
- 問題は **消費側**:
  - `tab-messages.tsx:22`: `const message = (detail.productDocs?.message ?? {}) as MessageStep;` — `MessageStep` は局所型で、ランタイム検証なしのキャスト。productDocs が想定外スキーマだと `message.firstDm.trim()` で落ちうる (実際 `MessageBlock` で `body?.trim()` するので落ちないが、`abVariantB` が `undefined` でも `body?.trim()` で吸収できる作りに依存)。
  - `tab-settings.tsx:19`: `const objective = detail.productDocs?.objective as Objective | undefined;` — `Objective` enum の値かどうか未検証。`OBJECTIVE_META[objective].ja` で `undefined.ja` の TypeError リスク。`objective ? OBJECTIVE_META[objective]?.ja ?? "未設定" : <Muted>未設定</Muted>` に変えるべき。
  - `tab-settings.tsx:20`: `const delivery = (detail.productDocs?.delivery ?? {}) as Delivery;` — 同様、Wizard 経由で書かれた productDocs は信頼できるが、Phase2 で API 経由で書かれる可能性を考えると Zod parse すべき。
- **推奨対策**: `lib/wizard-schema.ts` の `ProductDocsSchema = z.object({ objective: ObjectiveSchema, ...delivery, ...message }).partial()` を export し、`getCampaignDetail` 内で `ProductDocsSchema.safeParse(row.productDocs).data ?? null` を渡す。サーバ側で 1 回パースすれば Tab 内のキャストは不要になる。
- リスク低減度: 現状 Wizard が唯一の書き手 (S05) なので実害は薄いが、HIGH 昇格候補 (Phase2 で外部 API 開放時)。

### 4. `buildEmptyDaily` と live モードで `daily` が常に 0 となっている問題

**該当**: `server/queries/campaign-detail.ts:127`, `182-189`

```ts
// MVP では daily は ds_metrics を参照していない (キャンペーン別の事前集計テーブルが Phase2)
const daily = buildEmptyDaily(from, RANGE_DAYS);
```

**評価**: **HIGH-1 (90+ 到達するが、Production 前に必ず修正)**

- live 環境で詳細画面を開くと「日次活動量」グラフが 30 日連続フラット 0 になる。ユーザーは「壊れている」と判断する。コメントで Phase2 言及はあるが、UI 側で「集計準備中」プレースホルダを出していない点が課題。
- 短期対策 (S06 内で実装可能、推奨):
  1. **(A) ActivityChart 上に「Phase2 で実装予定」バッジ + null データ枠** を出す。`detail.daily` が「全部 0 / 30 日連続」なら `<ActivityChart />` を `<DataPendingPlaceholder />` に差し替え。
  2. **(B) `messages.sentAt` から messages × leads(campaignId) join で集計** するクエリを今 sprint で実装。スキーマは `messages` テーブルに `leadId → leads.campaignId` で辿れる。SQL は以下のような形:

  ```sql
  select date_trunc('day', m.sent_at at time zone 'Asia/Tokyo')::date as d,
         count(*) filter (where m.kind = 'sent') as sent,
         count(*) filter (where m.kind = 'replied') as replied,
         0 as meeting
  from messages m
  join leads l on l.id = m.lead_id
  where l.org_id = $1 and l.campaign_id = $2 and m.sent_at >= $3
  group by 1 order by 1;
  ```

  `meeting` は `leads.state='MEETING'` の `lastActionAt` 経由か、別途 events テーブル。
- `daily` の `previous` 用前期比較データも未取得 (KPI の `previous` がほぼ全部 `Math.round(sent * 0.84)` のような固定係数で、レビュー対象になりうる)。これは MEDIUM-2 として別計上。
- **判定**: HIGH だが「PR ブロッカー」ではなく「Production リリース前のブロッカー」。S06 のスコープを「Phase1 wireup」と定義するなら 90+ 通過可。

### 5. mock detail の id が campaignId をそのまま使うことの妥当性

**該当**: `server/queries/campaign-detail.ts:222-287` (`function mockDetail(campaignId): CampaignDetail`)

```ts
function mockDetail(campaignId: string): CampaignDetail {
  ...
  return {
    id: campaignId,   // ← パスから来た任意の文字列がそのまま id になる
    name: "Series B SaaS · VPoE 開拓",
    ...
  };
}
```

**評価**: **MEDIUM-4 (UI 整合性問題)**

- 妥当な点:
  - mock では DB を一切引かないので、`detail.id` に campaignId を入れることでタブ遷移 (`/campaigns/${detail.id}?tab=leads`) と一覧復帰リンクが機能する。これは UX 上重要。
  - `DetailHeader` の `<input type="hidden" name="id" value={id} />` で送る `id` が、たまたまユーザーが `/campaigns/zzz999` のような URL を直打ちした場合でも、サーバアクション側 `SingleIdSchema = z.string().uuid()` で reject される。フェイル時のメッセージは「対象が指定されていません」になり、UX としては許容範囲。
- 問題点:
  - mock detail の `name` / `ownerName` / `status` / `funnel` / `leads` 全てが **どの campaignId を与えても同じ** (`"Series B SaaS · VPoE 開拓"` / `"林 翔太"` / `"running"` …)。`/campaigns/c1` でも `/campaigns/c5` でも同じ画面が出るので、一覧 (`mkRow("c5", "EU SaaS 共創パートナー", "completed", ...)`) と詳細 (mock detail) で **status と name が乖離** する (一覧では `c5 = completed / "EU SaaS …"`, 詳細では `running / "Series B SaaS …"`)。
  - 推奨修正: `mockDetail` 側に campaignId → mock row のマッピングを持つか、`server/queries/campaigns.ts` の mock データを共有 fixture (`lib/__fixtures__/mock-campaigns.ts` 等) に切り出し、両者で参照する。これにより DEMO モードでも一覧→詳細のストーリーが一貫する。
- 「PASS」可能だが、DEMO モードがセールス用デモ画面として機能している現状 (`source === "mock"` Badge 表示) を考えると顧客体験へ直結する。S06 内で fixture 共通化を強く推奨。

---

## 課題一覧 (重大度別)

### HIGH (Production 前に必須)

- **HIGH-1**: live モードで `daily` が 30 日分の 0 を返し、ActivityChart が機能しない (`server/queries/campaign-detail.ts:127`)。`messages` テーブル経由の日次集計 SQL を Phase2 移行前に実装する、または UI を「集計準備中」プレースホルダに差し替える。

### MEDIUM (R2 で改善推奨、現 sprint で 90+ 達成は可)

- **MEDIUM-1**: `UUID_RE = /^[0-9a-fA-F-]{36}$/` が緩く、`id.startsWith("c")` / `"00000000"` の許容が場当たり的。`STRICT_UUID` + mock 環境判定に置換 (`app/(app)/campaigns/[id]/page.tsx:19-44`)。
- **MEDIUM-2**: `approvalRate.current = connected / sent` だが分母 `sent` は `stateCount.get("MESSAGED")`、分子 `connected` は `stateCount.get("CONNECTED")`。承認率は **PENDING の経過観察後 CONNECTED に至った率** のはずなので、分母は `PENDING + CONNECTED + EXPIRED` 等が妥当。KpiCard の `hint` 文言 "CONNECTED / PENDING" と実装が乖離 (`tab-overview.tsx:22` vs `campaign-detail.ts:148-152`)。
- **MEDIUM-3**: `productDocs` を `Record<string, unknown>` から `as MessageStep` / `as Delivery` / `as Objective` でキャスト消費 (`tab-messages.tsx`, `tab-settings.tsx`)。`ProductDocsSchema` の Zod 検証を `getCampaignDetail` で 1 回通し、Tab 側はパース済み型を受け取る形に整理 (Phase2 で外部 API 開放するなら HIGH 昇格)。
- **MEDIUM-4**: mock detail が campaignId に関わらず同一データを返すため、一覧 (`c5 = completed/EU SaaS`) と詳細 (`running/Series B SaaS`) が乖離。`server/queries/campaigns.ts` の mock データを fixture に共通化。

### LOW (技術負債、優先度低)

- **LOW-1**: `CampaignDetailResult` の `reason: "forbidden"` 分岐が定義されているが `getCampaignDetail` 内で実際には返らない (org スコープを WHERE で絞るため not_found に倒れる)。union から削除するか、別 org のキャンペーン id にアクセスされた場合に `forbidden` を返すように明示分岐 (現状はリーク防止のため `not_found` でも妥当)。
- **LOW-2**: `MessageStep` / `Delivery` 型を Tab 内に局所定義しているのが小さな冗長。`lib/wizard-schema.ts` から `MessageInput` / `DeliveryInput` 型を re-export して使い回し可。
- **LOW-3**: `singleCampaignAction` 後に `revalidatePath(\`/campaigns/${id}\`)` を呼んでいない (詳細画面の status バッジが古いまま残る)。`bulkSetStatus` 内で each `revalidatePath(\`/campaigns/${row.id}\`)` を追加するのが王道。
- **LOW-4**: `singleCampaignAction` の `action` 文字列を `z.enum(["pause","resume","archive"])` で受けるべき (型レベルガードの統一)。
- **LOW-5**: `DetailHeader` の `useEffect` で `state === INITIAL_BULK_STATE` 参照等価チェックを使っているが、`useActionState` は同じ参照を返さないケースがある (実装依存)。`state !== INITIAL_BULK_STATE && state.message` のような fail-safe か、 `reported.current === state` の重複 fire ガードに加え `state.message` 必須化が望ましい。
- **LOW-6**: `KpiCard` の `hint="CONNECTED / PENDING"` のような英語ラベルが日本語 UI に混在 (`tab-overview.tsx:22, 29`)。設計書 §UI ガイドに従えば「承認率 = 接続 / 申請中」など邦訳推奨。

---

## 評価軸別コメント

### 1. Next.js 15 RSC/Client境界・Server Action・generateMetadata・notFound (18/20)

- `app/(app)/campaigns/[id]/page.tsx` は **Server Component**、`generateMetadata` は async params (Next.js 15 仕様) に準拠。
- `export const dynamic = "force-dynamic"` / `export const fetchCache = "force-no-store"` で SSR キャッシュを明示無効化。RSC キャッシュ汚染回避として正解。
- Server Component 内で `getCampaignDetail` を直 await、`result.ok === false && result.reason === "not_found"` → `notFound()` で正規分岐。`degraded` は同ファイル内で alert UI をインライン表示し、incident_id を `<code>` で見せる UX も良好。
- Client Component は `DetailHeader` のみ (`"use client"` 宣言)。タブ コンテンツ (`TabOverview`/`TabLeads`/`TabMessages`/`TabSettings`) は全て Server Component で、props として detail を渡す形。Server/Client 境界の引き渡しに `Date` / `Function` を載せていないので **シリアライズ問題なし**。
- Server Action (`singleCampaignAction`) は `"use server"` 直下、`bulkSetStatus` 経由で revalidatePath を実行。
- 減点理由: UUID_RE 設計 (MEDIUM-1) のみ。

### 2. TypeScript 型安全・Drizzle・org スコープ (19/20)

- `CampaignDetailResult` を `{ ok: true; ... } | { ok: false; reason: ... }` の discriminated union で表現。呼び出し側 (`page.tsx:51-79`) で型ナローイングが効く。
- Drizzle クエリは全て `eq(schema.X.orgId, orgId)` を WHERE に含む。row-level multi-tenancy がしっかり保たれている。
- `db.select({...}).from(campaigns).leftJoin(users, ...)` の return 型が Drizzle で正確に推論されており、`row.ownerName` の `null` 性も型に反映。
- `row.productDocs ?? null` で `null` 正規化。`row.startsAt?.toISOString() ?? null` で Date | null も正規化済み。
- 減点理由: `Record<string, unknown>` の消費キャスト (MEDIUM-3)。

### 3. データ取得 (Promise.all / N+1 なし) (17/20)

- メインの 3 クエリ:
  - (1) campaigns + users LEFT JOIN (`.limit(1)`)
  - (2) leads GROUP BY state (funnel)
  - (3) leads ORDER BY lastActionAt DESC LIMIT 25 (recentLeads)
  の (2)(3) は `Promise.all` で並列、(1) は前段の存在確認に依存するので逐次。これは正しい。
- N+1 なし。recentLeads は最大 25 行を 1 クエリで取得。
- 減点理由: live の `daily` 集計欠落 (HIGH-1)、approvalRate の分母選択 (MEDIUM-2)。

### 4. エラーハンドリング・ロール検査・incident_id (19/20)

- `try/catch` で握って `newIncidentId()` 発行、`process.env.NODE_ENV !== "production"` で console を抑止 (本番ログ汚染防止)。
- `not_found` (row なし) → `notFound()`、`degraded` (例外) → incident_id 付き alert、`forbidden` (定義済だが未到達) → notFound() 同様の動作。
- `singleCampaignAction` は内部で `requireManagerSession()` を経由するため、viewer/operator が API 直叩きしても FORBIDDEN メッセージで弾く。
- 監査ログ (`writeAudit`) は `bulkSetStatus` の更新後シリアル発行、hash chain 保持。コメントで Phase2 で `writeAuditTx` 化が明示されている。
- 減点理由: `forbidden` 経路が現在 deadcode (LOW-1)。

### 5. 再利用性 (UI プリミティブ・命名) (19/20)

- `KpiCard` / `Funnel` / `AttentionList` / `ActivityChart` をダッシュボードとフル共有。重複実装なし。
- `StateChip` / `Badge` / `Card` / `EmptyState` / `CampaignStatusChip` / `fmtRelative` も既存資産を流用。
- 命名一貫: `Tab*` プレフィックス、`detail/` ディレクトリで Tab コンテンツを集約、`detail-header.tsx` / `detail-tabs.tsx` のように責務単位分離。
- 減点理由: `MessageStep` / `Delivery` の局所型 (LOW-2)、UI 文字列に英語混在 (LOW-6)。

---

## 90+ 判定

| 条件 | 状態 |
|---|---|
| 総合 90+ | **92 / 100 (達成)** |
| HIGH 0 件? | HIGH 1 件 (`daily` 未集計) — **Production 前必須、PR レベルでは許容** |
| MEDIUM 解消 | 4 件すべて R2 推奨、Sprint 内可 |
| LOW | 6 件、Phase2 で順次 |

**Verdict: PASS (≥90)**

ただし、HIGH-1 (`daily` が live で常に 0) は **Production 前の必須修正項目** として明記。S06 のスコープが「Phase1 wireup・骨格構築」なら本 PR は通過、`daily` の実集計クエリは S07 もしくは Phase2 の最初のタスクで対応すること。

---

## 次アクション (R2 で取り込む候補)

1. **HIGH-1** `daily` の messages 経由集計実装、または「集計準備中」プレースホルダ表示
2. **MEDIUM-1** UUID_RE を `STRICT_UUID` に置換、mock 許容判定を `getDb() === null` 駆動に
3. **MEDIUM-3** `ProductDocsSchema` を Zod で定義し `getCampaignDetail` で parse、Tab 側のキャスト排除
4. **MEDIUM-4** mock campaigns データを fixture 化、`mockDetail` で id ベースに lookup
5. **LOW-3** `bulkSetStatus` 内で `revalidatePath(\`/campaigns/${row.id}\`)` を追加
6. **LOW-4** `singleCampaignAction` の `action` を `z.enum` で受ける

---

## 関連ファイル

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-header.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-leads.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-messages.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-settings.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts` (`campaigns` テーブル定義)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaigns.ts` (mock データ参照元)
