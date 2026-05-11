# CTO Review — S06 キャンペーン詳細 (r2)

**Reviewer**: CTO Agent
**Scope**: R1 と同一 (`app/(app)/campaigns/[id]/page.tsx`, `server/queries/campaign-detail.ts`, `server/actions/campaigns.ts`, `components/campaigns/detail/*`)
**Date**: 2026-05-11
**Verdict**: **PASS (90+)** — 総合 **96 / 100** (R1: 92 → +4)

---

## 総合スコア: 96 / 100 (R1 差分 +4)

| 軸 | R2 | R1 | Δ | コメント |
|---|---|---|---|---|
| 1. Next.js 15 RSC/Client境界・Server Action・generateMetadata・notFound | **19** | 18 | +1 | STRICT_UUID_RE (RFC4122 v1-v5) + `isDev` gating で MEDIUM-1 解消。`MOCK_PREFIXES` の本番遮断を NODE_ENV で物理閉鎖。設計意図が読みやすくなった。 |
| 2. TypeScript 型安全・Drizzle・org スコープ | **19** | 19 | 0 | 変更なし。`productDocs` の Zod parse 化 (MEDIUM-3) は据え置きで Phase2。 |
| 3. データ取得 (Promise.all / N+1 なし) | **19** | 17 | +2 | HIGH-1 (`daily` 全 0) を `hasDaily` 判定 + 「集計準備中 · Phase2」プレースホルダで UX 上のブロッカー解消。SQL 集計は Phase2 に正式繰延済み。`approvalRate` 分母 (MEDIUM-2) は未解消で -1 残。 |
| 4. エラーハンドリング (degraded / not_found / forbidden + incident_id) | **20** | 19 | +1 | `singleCampaignAction` で `revalidatePath('/campaigns/${id}')` を追加 (LOW-3 解消)、`action` を `z.enum(['pause','resume','archive'])` に内包し型レベルガード強化 (LOW-4 解消)、エラーメッセージも "対象または操作が指定されていません" に明示。 |
| 5. 再利用性 (KpiCard/Funnel/ActivityChart 既存資産流用、命名) | **19** | 19 | 0 | `Card` / `CardHeader` / `CardBody` / `Badge` / `LineChart` icon を再利用してプレースホルダ実装。重複なし。 |

**判定: PASS (≥90)**

---

## R1 で指摘した HIGH / MEDIUM / LOW の解消状況

| # | 重大度 | 内容 | R2 状況 |
|---|---|---|---|
| HIGH-1 | HIGH | `daily` が live で 30 日連続 0、ActivityChart が機能不全 | **解消** — `TabOverview` で `hasDaily = detail.daily.some(d => d.sent>0 \|\| d.replied>0 \|\| d.meeting>0)` を判定、false 時に「集計準備中 · Phase2」Card プレースホルダ (LineChart アイコン + メッセージ) に差し替え。Phase2 で `messages.sentAt` 集計実装する旨も UI 内に明示。 |
| MEDIUM-1 | MEDIUM | `UUID_RE = /^[0-9a-fA-F-]{36}$/` が緩く、`startsWith("c")` / `"00000000"` を本番でも許容 | **解消** — `STRICT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (RFC4122 v1-v5 厳密判定) に置換、`MOCK_PREFIXES = ["c", "00000000"]` を `isDev = process.env.NODE_ENV !== "production"` の and 条件で gating。production では UUID 以外 100% notFound。 |
| MEDIUM-2 | MEDIUM | `approvalRate = connected / sent (=MESSAGED)` だが hint 文言は "CONNECTED / PENDING" | **未解消** — `campaign-detail.ts:148-152` / `tab-overview.tsx:27` 共に R1 と同じ。R3 候補。 |
| MEDIUM-3 | MEDIUM | `productDocs` を `Record<string, unknown>` から as キャストで消費 | **未解消** — `tab-messages.tsx` / `tab-settings.tsx` 共に R1 と同じ。Phase2 で `ProductDocsSchema` Zod parse 化推奨。 |
| MEDIUM-4 | MEDIUM | mock detail が campaignId に関わらず同一データ | **未解消** — `server/queries/campaign-detail.ts:222-287` の `mockDetail` は R1 と同じ。R3 で fixture 共通化推奨。 |
| LOW-1 | LOW | `forbidden` 経路 deadcode | 未解消 (許容範囲) |
| LOW-2 | LOW | `MessageStep` / `Delivery` の局所型 | 未解消 (許容範囲) |
| LOW-3 | LOW | `revalidatePath('/campaigns/${id}')` 未呼び出し | **解消** — `singleCampaignAction` 末尾で `revalidatePath('/campaigns/${parsed.data.id}')` を呼出。詳細画面の status chip / DetailHeader が即時更新される。 |
| LOW-4 | LOW | `action` 文字列を z.enum で受けるべき | **解消** — `SingleIdSchema = z.object({ id: z.string().uuid(), action: z.enum(["pause","resume","archive"]) })`。型レベルで未対応 action を排除。エラーメッセージも親切化。 |
| LOW-5 | LOW | `DetailHeader` の `useEffect` 参照等価チェック | 未解消 (許容範囲) |
| LOW-6 | LOW | KpiCard hint の英語混在 | 未解消 (許容範囲) |

**R2 で潰した内訳**: HIGH 1/1、MEDIUM 1/4、LOW 2/6。当初の R2 トリアージ目標 (HIGH-1 + MEDIUM-1 + LOW-3 + LOW-4) を完全達成。

---

## 重点確認 — R2 で追加された差分の妥当性

### 1. `STRICT_UUID_RE` (RFC4122 v1-v5) + `isDev` gating

**該当**: `app/(app)/campaigns/[id]/page.tsx:19-50`

```ts
const STRICT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOCK_PREFIXES = ["c", "00000000"] as const;
...
const isDev = process.env.NODE_ENV !== "production";
const isReasonable =
  STRICT_UUID_RE.test(id) ||
  (isDev && MOCK_PREFIXES.some((p) => id.startsWith(p)));
if (!isReasonable) {
  notFound();
}
```

**評価**: **PASS**

- 正規表現は RFC4122 v1-v5 のバージョン位 (`[1-5]`) と variant 位 (`[89ab]`) を厳密検証。R1 で指摘した「`-`×36 や hex×36 が通る」問題が完全に閉じている。
- mock 許容は `isDev` の and 条件で本番ビルドから物理排除されているため、本番でユーザーが `/campaigns/capybara` を直打ちしても確実に notFound が走る。これは設計意図として明快。
- 一点軽指摘: NEW-LOW-1 として `isDev` 判定を `getDb() === null` (DB 未接続) 駆動にする方が筋が良い (NODE_ENV=production でも DATABASE_URL 未設定の preview デプロイでは mock を使うため)。ただし現在のオペレーション (`NODE_ENV=development` ローカル + production deploy) であれば実害なし。R3 で議論。

### 2. `TabOverview.hasDaily` プレースホルダ

**該当**: `components/campaigns/detail/tab-overview.tsx:11, 54-81`

```ts
const hasDaily = detail.daily.some((d) => d.sent > 0 || d.replied > 0 || d.meeting > 0);
...
{hasDaily ? (
  <ActivityChart data={detail.daily} />
) : (
  <Card>
    <CardHeader>
      <div>
        <CardTitle>日次活動量</CardTitle>
        ...
      </div>
      <Badge tone="info">集計準備中 · Phase2</Badge>
    </CardHeader>
    <CardBody>
      ...「Phase2 で messages.sentAt を集計してチャートを表示します」...
    </CardBody>
  </Card>
)}
```

**評価**: **PASS**

- `hasDaily` の判定がデータ駆動 (`detail.daily.some(...)`) なので、Phase2 で集計 SQL が実装されデータが入ってきた瞬間に自動的に `ActivityChart` 側に切り替わる。`if (isMockSource) ...` のような環境分岐を入れなかった点が良設計 (テストしやすい、cutover 不要)。
- プレースホルダの中身が「現状の制約 (集計準備中)」「ユーザーに何を見てほしいか (ダッシュボードの全体活動量)」を 2 行で伝えており、UX として誠実。
- 軽指摘 NEW-LOW-2: `hasDaily` 判定の意味は「30 日中 1 日でも非ゼロ活動があったか」だが、本来は「集計テーブルが繋がっているか (= Phase2 リリース済みか)」を `detail.dailySource: "stub" | "live"` のような明示フラグで伝える方が型安全。ただし現状で十分実用。

### 3. `singleCampaignAction.revalidatePath('/campaigns/${id}')`

**該当**: `server/actions/campaigns.ts:177`

```ts
// 詳細画面の状態 chip を即時更新
revalidatePath(`/campaigns/${parsed.data.id}`);
return result;
```

**評価**: **PASS**

- `bulkSetStatus` 内の `revalidatePath('/campaigns')` (一覧) に加えて、詳細画面のキャッシュを id 単位で破棄。Pause→Resume の連打でも DetailHeader の status バッジが即時反映される。
- 失敗時 (`result.kind === "fail"`) でも `revalidatePath` が呼ばれるが、これは無害 (RSC キャッシュを 1 回破棄するだけで DB は touch しない)。むしろ「再描画して再試行できる」UX として正解。
- 軽指摘 NEW-LOW-3: `singleCampaignAction` が detail 単独画面のみ意識して `revalidatePath('/campaigns/${id}')` を打っているが、`bulkPauseCampaigns` 経由で複数件処理した場合に detail 側のキャッシュは破棄されない (一覧の `revalidatePath('/campaigns')` のみ)。Phase2 で bulk 処理後の対象 row の detail を開いた時に古いステータスが見える可能性。`bulkSetStatus` 内で `for (const row of updated) revalidatePath('/campaigns/${row.id}')` を追加すると完全網羅。R3 候補。

### 4. `SingleIdSchema` に `action: z.enum(...)` を内包

**該当**: `server/actions/campaigns.ts:148-160, 167-174`

```ts
const SingleIdSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["pause", "resume", "archive"]),
});
...
if (parsed.data.action === "pause") { ... }
else if (parsed.data.action === "resume") { ... }
else { result = await bulkArchiveCampaigns(undefined, fakeForm); }
```

**評価**: **PASS**

- `action` を Zod enum で受けることで、`else` 分岐に到達した時点で TypeScript が `parsed.data.action` を `"archive"` narrowing する。Switch 文の `default: never` 不要で型安全。
- 不正な action (例: `"delete"`) を送ると `safeParse` が失敗し "対象または操作が指定されていません" を返す。R1 時点の「未対応の操作です」より UX が明快。
- 設計負債としては R1 で指摘したとおり `bulkSetStatus(ids: string[], session, ...)` の純関数化が Phase2 王道だが、現状の FormData 再構築は二重 Zod parse で安全性が担保されているので機能上問題なし。

---

## NEW HIGH / NEW MEDIUM (R2 で新規発見)

### NEW: なし

R2 の変更は厳密に R1 指摘の修正範囲に閉じており、副作用としての regression / 新規問題は検出されなかった。`STRICT_UUID_RE` 変更により mock 列挙 (`server/queries/campaigns.ts:186-195`) からのリンクが本番で 404 になる懸念があったが、`isDev` gating で開発時のみ許容しているため本番の動作には影響なし。

---

## HIGH 残存 / NEW HIGH

| # | 重大度 | 内容 | 状況 |
|---|---|---|---|
| (なし) | HIGH | — | **HIGH 0 件** |

**HIGH 残存: 0 件 / NEW HIGH: 0 件**

R1 で「Production 前のブロッカー」と評していた HIGH-1 は、`hasDaily` プレースホルダで UX 上は完全に閉じた。集計 SQL の本実装は Phase2 に正式延期となっており、コード内のコメント (`server/queries/campaign-detail.ts:125-127`) も「Phase2」を明記。これにより S06 PR は HIGH 0 件で merge 可能状態。

---

## NEW LOW (R2 で気付いた軽指摘・R3 任意)

- **NEW-LOW-1**: `isDev = process.env.NODE_ENV !== "production"` ではなく、DB 接続の有無 (`getDb() === null`) で mock 許容を判定する方が筋が良い。preview / staging で `NODE_ENV=production` + `DATABASE_URL=undefined` の組合せが起こりうる。
- **NEW-LOW-2**: `hasDaily` 判定が「データ的に 0 か否か」になっており、「集計テーブルが繋がっているか」とは厳密には別概念。`detail.dailySource: "stub" | "live"` のような明示フラグが理想。Phase2 で集計 SQL 実装時に同時導入推奨。
- **NEW-LOW-3**: `bulkSetStatus` で複数件処理した場合に各 `/campaigns/${row.id}` の revalidate が抜ける。`for (const row of updated) revalidatePath(...)` 追加でフルカバー。

---

## 90+ 判定

| 条件 | 状態 |
|---|---|
| 総合 90+ | **96 / 100 (達成、R1 92 から +4)** |
| HIGH 残存 0 件 | **達成** |
| NEW HIGH 0 件 | **達成** |
| MEDIUM 解消率 | 1/4 (MEDIUM-1) — 残 3 件は R3 / Phase2 で対応 |
| LOW 解消率 | 2/6 (LOW-3, LOW-4) — 残 4 件は技術負債として許容 |

**Verdict: PASS (≥90)** — マージ可。

R1 で「Production 前必須」としていた HIGH-1 が UX プレースホルダで解消されたため、R2 時点で S06 はマージ後 production deploy 可能な品質に到達。残 MEDIUM (approvalRate 分母 / productDocs Zod / mock fixture 共通化) は R3 もしくは S07 で計画的に消化することを推奨。

---

## 次アクション (R3 候補・任意)

1. **MEDIUM-2** `approvalRate` 分母を `PENDING + CONNECTED + EXPIRED` に修正、hint 文言と整合 (`campaign-detail.ts:148-152` + `tab-overview.tsx:27`)
2. **MEDIUM-3** `ProductDocsSchema` を `lib/wizard-schema.ts` から export、`getCampaignDetail` で 1 回 parse、Tab 側のキャスト撤去
3. **MEDIUM-4** `lib/__fixtures__/mock-campaigns.ts` を新設、`server/queries/campaigns.ts` と `mockDetail` で共有
4. **NEW-LOW-1** `isDev` を `getDb() === null` 駆動に置換 (preview / staging 対応)
5. **NEW-LOW-3** `bulkSetStatus` 内で各 row の `revalidatePath('/campaigns/${row.id}')` 追加

---

## 関連ファイル (確認済み)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx` (STRICT_UUID_RE + isDev gating)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx` (hasDaily + プレースホルダ)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts` (singleCampaignAction + z.enum action + revalidatePath)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts` (HIGH-1 の Phase2 コメント、daily スタブ維持)
