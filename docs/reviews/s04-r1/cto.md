# CTO Review — S04 キャンペーン一覧画面 (r1)

- 対象ブランチ: working tree
- 対象設計: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.1
- レビュアー: CTO エージェント (Opus 4.7)
- 日付: 2026-05-11

---

## 総合スコア: **74 / 100**

| 軸 | スコア | コメント |
|---|---:|---|
| 1. Next.js 15 RSC/Client 境界、Server Action 設計 | **16 / 20** | RSC/CSR の分離はクリーン。`force-dynamic` / `force-no-store` も適切。ただし Bulk Action が UI に結線されておらず、Server Action が「存在するだけ」で死蔵。 |
| 2. TypeScript 型安全、Drizzle クエリ品質 | **15 / 20** | 型は健全。集計クエリは `count(*) filter` を使った 1 ラウンドの良設計だが、**`leads` 集計に `orgId` 述語が無く** RLS 二重防御 / インデックス効率の両面で不足。`count(*)::int` は大量レコードで遅い。 |
| 3. 状態管理 (URL query sync、selection state、debounce) | **12 / 20** | URL 連動と debounce は基本良好。ただし **selection state が `rows` 変更時にリセットされない**致命的バグあり (詳細 HIGH-2)。Pagination の `hrefFor` が未知 query param を落とすため、保存ビューの `hitl=...` が 2 ページ目で消える。 |
| 4. エラーハンドリング・ロール検査・revalidate | **14 / 20** | `requireManagerSession` は綺麗。`revalidatePath` も呼ばれる。ただし **監査ログの action が `campaign.launched` 固定で正しいイベント名がない**、`targetId` を CSV 連結する設計バグあり (詳細 HIGH-1)。 |
| 5. 再利用性 (UI プリミティブ、命名、命名一貫性) | **17 / 20** | Checkbox / Dropdown / Pagination / EmptyState / Select は汎用性高く再利用可。命名も統一。ただし `Dropdown` の trigger 実装が **button 入れ子 (a11y 違反)** を作る。 |

---

## HIGH (リリース前に必ず修正)

### HIGH-1: bulk action の監査アクション名が虚偽・`targetId` 設計が破綻
**ファイル**: `server/actions/campaigns.ts:63, 108` / `lib/audit.ts:6-19`

- `bulkPauseCampaigns` / `bulkArchiveCampaigns` 両方とも `action: "campaign.launched"` を書いている。これは事実と異なる監査記録で、§17 改竄耐性ハッシュチェーン入りの append-only ログを **コンプライアンス的に汚染** する。後から「誰が一時停止したか」を辿れない。
- `AuditAction` ユニオンに `campaign.paused` / `campaign.archived` を追加し、それぞれ正しい action を渡すこと。
- `targetId: parsed.data.ids.join(",")` も問題。`audit_log.target_id` は単一 UUID 列のはず (要 schema 確認) で、200 件 × 36 char = 7,200 文字の CSV を 1 行に押し込むと **TEXT に変換されるか truncate** される。N 行に分けて記録するか、`targetId` は空にして `diff.ids` のみに格納する設計に変更。

```ts
// 修正例
await Promise.all(
  parsed.data.ids.map((id) =>
    writeAudit({
      orgId: session.orgId,
      actorUserId: session.userId,
      action: "campaign.paused",  // ← 新規追加
      targetType: "campaign",
      targetId: id,
      purpose: "bulk_pause",
      diff: { previousStatus: "running", nextStatus: "paused" },
    })
  )
);
```
> 注: hash chain がシリアル前提なので、ループ内で順次実行 (Promise.all ではなく for-of) すべき。前ハッシュの取り直しが必要。

---

### HIGH-2: 選択状態 (`selected`) が `rows` 更新時にリセットされない
**ファイル**: `components/campaigns/campaigns-table.tsx:27`

`rows` は SSR で再生成される (ページ遷移・フィルタ変更で別配列)。一方 `selected: Set<string>` は **クライアント側 React state** として保持される。

- フィルタ「実行中のみ」適用 → 5 件選択 → フィルタ解除 → 元 5 件が **画面に存在しないのに選択状態が残り**、`BulkBar` には `5 / 25 件選択中` と表示される。
- そのまま「一括一時停止」を押すと存在しないキャンペーン ID で Server Action が呼ばれる (今は alert なので実害ゼロだが、HIGH-3 を直した瞬間に本番事故になる)。
- ページネーションでも同じ。`page=2` で 5 件選択 → `page=1` に戻ると 5 件選択中のまま (本来は表示中行限定が UX 期待)。

**修正**:
```tsx
const rowsKey = rows.map(r => r.id).join(",");
React.useEffect(() => {
  // 表示中の行に存在しない id は落とす
  setSelected((prev) => {
    const visible = new Set(rows.map(r => r.id));
    const next = new Set<string>();
    for (const id of prev) if (visible.has(id)) next.add(id);
    return next.size === prev.size ? prev : next;
  });
}, [rowsKey]); // eslint-disable-line
```
あるいは「全選択」を「**現ページ全選択**」と定義したうえでページ遷移時に `setSelected(new Set())` で完全クリアする方が UX として明快。設計書 §6.11.1 に挙動が明記されていないので PM 判断を仰ぐ。

---

### HIGH-3: BulkBar が Server Action に結線されていない
**ファイル**: `components/campaigns/campaigns-table.tsx:238-243`

`BulkButton.onClick` が `alert(...)` のみ。`server/actions/campaigns.ts` の `bulkPauseCampaigns` / `bulkArchiveCampaigns` は **デッドコード**。設計書 §6.11.1 にも `[一括: 一時停止 / アーカイブ]` と明記されており、画面の主要機能の 1 つが未実装。

修正方針:
1. `<form action={bulkPauseCampaigns}>` で囲み、`<input type="hidden" name="ids" value={id} />` を ids 数だけ並べる。
2. もしくは `useTransition` + `bulkPauseCampaigns(formData)` を手動構築して `startTransition`。
3. 成功時 toast / 失敗時 `result.message` 表示も必要 (現状は完全に黙る)。
4. 操作前の **二段階確認** (一括一時停止は §11.1.1 Critical) を `confirm()` で済ませず専用モーダルで。
5. mock 環境 (`source === "mock"`) では Server Action を呼ばずインライン警告にフォールバック。

---

### HIGH-4: `leads` 集計クエリに `orgId` 述語が欠落
**ファイル**: `server/queries/campaigns.ts:82-94`

```ts
.from(schema.leads)
.where(inArray(schema.leads.campaignId, ids))
```

- `ids` は同じ org のキャンペーンに絞り込んだ結果なので **論理的にはテナント越境は起きない**。
- しかし:
  - **RLS 二重防御** (defense-in-depth) の観点では `eq(leads.orgId, orgId)` を必ず併記すべき。campaign 側の bug や RLS 設定ミスで他社 ID が混入したケースを救えない。
  - インデックス利用: `leads_camp_idx` は `(campaign_id)` 単独。`(org_id, campaign_id)` の複合 index なら effectivly partition pruning が効く。`orgId` 述語があれば PostgreSQL planner が `leads_org_idx` を活用できる選択肢が増える。
  - 設計書 §17 ABAC「常に `org_id = current_org` を必須」の精神に反する。

```ts
.where(
  and(
    eq(schema.leads.orgId, orgId),
    inArray(schema.leads.campaignId, ids)
  )
)
```

---

## MEDIUM (リリース直後の hotfix で許容)

### MED-1: Pagination の `hrefFor` が未知 query param を破棄する
**ファイル**: `app/(app)/campaigns/page.tsx:50-57`

```ts
const params = new URLSearchParams();
if (status) params.set("status", status);
if (owner) params.set("owner", owner);
if (q) params.set("q", q);
```

`STARTER_VIEWS` に `?status=running&hitl=REVIEW_REQUIRED` を入れているのに、2 ページ目に遷移すると `hitl` が消える。今は `hitl` をサーバ側で読んでいないので実害は無いが、後で `hitl` フィルタを実装した瞬間に「ページめくると要レビューフィルタが解ける」というバグになる。

**修正**: `hrefFor` は `sp` 全体を base に上書きする方式に。
```ts
const hrefFor = (p: number) => {
  const params = new URLSearchParams(sp as unknown as Record<string,string>); // または searchParams を passthrough
  if (p > 1) params.set("page", String(p));
  else params.delete("page");
  return params.size ? `/campaigns?${params.toString()}` : "/campaigns";
};
```

### MED-2: `Dropdown` の trigger が `<button>` を内包し a11y 違反
**ファイル**: `components/ui/dropdown.tsx:39-54` / `components/campaigns/campaigns-filter-bar.tsx:117-124` (保存ビュー)

`Dropdown` は trigger を `<span role="button" tabIndex=0>` で包む。filter-bar 側の trigger は `<button>` なので **button 入れ子** になる (HTML 仕様違反、a11y axe-core で Critical)。

**修正**: trigger を `cloneElement` で受けて自身に handler を注入、または trigger が button のときは外側 span を `<>`/`<div>` に切り替える props を追加。最終的には Radix Primitives の `DropdownMenu` への置換を強く推奨 (コメントにも書かれている)。

### MED-3: 行ホバーアクションの onSelect が空ハンドラ
**ファイル**: `components/campaigns/campaigns-table.tsx:141-156`

「一時停止 / 再開 / 複製 / 編集申請 / アーカイブ」がすべて `onSelect={() => close()}` で、close 以外何もしない。`row.status === "paused"` の動的アイコン差し替えは綺麗だが、機能は完全に未実装。HIGH-3 と同じく Server Action 化が必要 (単件版 `pauseCampaign(id)` / `archiveCampaign(id)` を追加)。

### MED-4: `ilike` でユーザ入力の `%` `_` がエスケープされない
**ファイル**: `server/queries/campaigns.ts:52`

```ts
ilike(schema.campaigns.name, `%${q.trim()}%`)
```

`q` に `%` や `_` を入れると wildcard として作用 (e.g. `q=_a` で `xa`, `ya` 等が全部マッチ)。SQLi は drizzle がパラメータ化するので無し。低リスクだが、`q.trim().replace(/[\\%_]/g, c => "\\" + c)` でエスケープが望ましい。

### MED-5: `count(*)::int` が大量行で遅い
**ファイル**: `server/queries/campaigns.ts:73`

`org` に campaign が 10 万件あると `SELECT count(*) FROM campaigns WHERE org_id=?` は数百 ms かかる。代替案:
- `count(*) over()` を rows クエリに含めれば 1 ラウンドで済む。
- 概算で良ければ `pg_class.reltuples` ベースの推定。
- とはいえ MVP 規模では問題なし → Future Work で OK。

### MED-6: 保存ビュー `needs-review` がサーバで処理されない
**ファイル**: `components/campaigns/campaigns-filter-bar.tsx:25`

`?status=running&hitl=REVIEW_REQUIRED` を投げても `page.tsx` が `hitl` を読まないため、表示結果は単に「実行中のみ」と同じ。設計書ではこのビューは存在価値があるので、`listCampaigns` 引数に `hitlState` を足してフィルタを実装するか、当該ビューを STARTER から外す。

### MED-7: Audit hash chain が並列書き込みで壊れる
**ファイル**: `lib/audit.ts:44-49`

`prevHash` を `SELECT … ORDER BY created_at DESC LIMIT 1` で取る → INSERT する設計。同一トランザクションでないため、2 リクエスト同時着弾で **両方が同じ prev_hash を読む → chain が分岐**。MVP 単一 worker なら回避可能だが、bulk action から 200 並列 insert は危険 (HIGH-1 修正でループ直列化必須)。中期的には `SELECT … FOR UPDATE` + 同一トランザクション化、または DB トリガでチェーン生成。

---

## LOW (技術的負債、見栄え)

- **LOW-1**: `campaigns-table.tsx:183` の `<input type="hidden" name="total" value={total} />` はどの form にも属さず無意味。削除。
- **LOW-2**: `campaigns-table.tsx:162-168` の `<Link className="absolute inset-0 hidden md:hidden">` は `hidden md:hidden` で常時非表示。モバイル行クリックを `Link` でカバーする意図と思われるが現状動かない。要修正または削除。
- **LOW-3**: `mockCampaigns` の `ownerUserId === "me"` 判定が `田中 健司` ハードコード。せめて mock セッション名と一致させるか、コメントで明示。
- **LOW-4**: `mkRow` の `anomaly` 計算がページ側 (`r.status === "running" && (!a?.lastAt || now - a.lastAt.getTime() > DAY)`) と微妙にずれる (`lastActivityAt !== null` を必須にしている)。仕様は「アクションが無い」≒ 「null も含む」なので live 側が正しい。mock を合わせる。
- **LOW-5**: `EmptyState` の `role="status"` は「ライブリージョン」を意味する。空表示は live region 不要 → `role="region"` か role 省略の方が SR ユーザに親切。
- **LOW-6**: `Select` で `value=""` のとき disable される `placeholder` の挙動 (`disabled={value !== ""}`) は条件が逆。`disabled={value === ""}` ではなく？確認のこと。
- **LOW-7**: `Pagination.PagerLink` で `disabled` ブランチに `aria-disabled` を真偽値なし (空属性) で渡している。React は空文字列を渡す。`aria-disabled={true}` を明示。
- **LOW-8**: `force-dynamic` を全画面に貼ると ISR の恩恵がゼロ。当画面はテナントデータなので妥当だが、`unstable_cache` + tag invalidation (`revalidateTag('campaigns:'+orgId)`) を検討。

---

## 良い点 (3 つ)

1. **集計クエリの設計が筋が良い**
   `count(*) filter (where state in (...))` を 1 クエリで一気に取り、`Map` で `O(rows + agg)` 結合。N+1 を完全に避けつつ「送信/返信/商談/total/last action」を一度に取れる。Drizzle で `sql<number>\`...\`` の段違いキャストも型整合性が取れている。Promise.all で count と rows を並列実行している点も◎。

2. **RSC / CSR 境界の引き方がモダン**
   `page.tsx` を server-only 化し `getSession()` + `listCampaigns()` を直接 await、`CampaignsFilterBar` / `CampaignsTable` だけ `"use client"` という最小クライアント表面。`force-dynamic` + `force-no-store` の組み合わせで「テナントデータを ISR に漏らさない」明確な意図表明。`server-only` import で誤って client bundle に混ざるのを防止。

3. **UI プリミティブの抽象度が高く再利用可能**
   `Checkbox` の `indeterminate` 状態 (aria-checked="mixed")、`Dropdown` の close 引数受け渡しパターン (`{(close) => …}`)、`Pagination` の `hrefFor` callback による URL 構築の宿主側委譲、`EmptyState` の primary/secondary action 構造は他画面 (S07 リード、S09 受信箱) でそのまま流用可能な設計。命名 (`CAMPAIGN_STATUS_META` 単一 source of truth → chip も filter options も全部ここ参照) も DRY で美しい。

---

## 95+ 到達のための残ブロッカー (優先順)

1. **HIGH-1 解消**: `AuditAction` に `campaign.paused` / `campaign.archived` を追加、`targetId` を 1 行 1 ID 化、hash chain の直列性確保。**+8 点** (axis 4: 14→18, axis 2: 15→17)
2. **HIGH-2 解消**: `selected` state を `rows` 変化に追従 (`useEffect` で visible 集合と交差)。**+5 点** (axis 3: 12→16)
3. **HIGH-3 解消**: BulkBar / row Dropdown を Server Action に結線、toast + ローディング状態。**+4 点** (axis 1: 16→18, axis 4: +1)
4. **HIGH-4 解消**: `listCampaigns` の leads 集計に `eq(leads.orgId, orgId)` を追加。**+2 点** (axis 2: 17→18, セキュリティ)
5. **MED-1 + MED-2 + MED-6 解消**: pagination の全 query 引継ぎ、Dropdown trigger の button 入れ子解消、`hitl` フィルタ実装または STARTER から削除。**+3 点** (axis 3: +2, axis 5: 17→19)
6. **必須テスト追加** (vitest + Playwright):
   - `listCampaigns` の集計 SQL に対する snapshot / RLS 越境テスト
   - selection state の rows 変化追従テスト
   - bulkPauseCampaigns の Manager 未満ロール拒否テスト
   - 監査ログの hash chain 結合テスト
   **+3 点** (信頼性配点)

これで **95–97 / 100 圏内** に到達見込み。HIGH 4 件をまず潰せば **85 程度** までは即時上がる。

---

## 推奨次ステップ

1. HIGH-1 → HIGH-2 → HIGH-3 → HIGH-4 の順で 1 PR ずつ分割修正。HIGH-1 と HIGH-3 は 1 PR にまとめて構わない (action 名と結線は同時に直すのが自然)。
2. MED-1, MED-2 はリファクタ系で別 PR、HIGH 解消後の plan-review-gate にかける。
3. r2 レビューでは「Server Action 結線後の e2e シナリオ (Manager で一括停止 → 監査ログ確認 → revalidate)」をシミュレーションファースト原則で必ず通すこと (CLAUDE.md MEMORY の feedback_simulation_first 参照)。

---

**Verdict: NEEDS REVISION (74/100)**
HIGH 4 件のいずれもユーザ体験 / コンプライアンス / セキュリティ二重防御に直結。S04 を「実装完了」と宣言する前に必ず修正してください。
