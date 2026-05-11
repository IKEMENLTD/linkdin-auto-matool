# SRE レビュー — S04 キャンペーン一覧画面 (r1)

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下 (S04 一式)
  - `app/(app)/campaigns/page.tsx`
  - `components/campaigns/campaigns-table.tsx`
  - `components/campaigns/campaigns-filter-bar.tsx`
  - `components/campaigns/campaign-status-chip.tsx`
  - `components/ui/{pagination,empty-state,checkbox,dropdown,select,input,badge,...}.tsx` (新規)
  - `server/queries/campaigns.ts`
  - `server/actions/campaigns.ts`
  - `lib/campaign-status.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§15 パフォーマンス予算 / §24 SLO/Runbook)
- 参照: `docs/reviews/code-r4/sre.md` (96/100、`withScopedDb` トランザクション化 / RLS 三重防護が確立済み)
- レビュアー: SRE シニア (観測性 / パフォーマンス / 信頼性 / 安全運用)
- 評価日: 2026-05-11

---

## 総合スコア: **62 / 100**

| 評価軸 | 配点 | スコア | 主所見 |
| --- | ---: | ---: | --- |
| 1. パフォーマンス (集計、N+1、ページング) | 20 | **13** | `count(*) filter (...)` で N+1 は避けたが、(a) `leads` 集計に `orgId` 述語が無くインデックス効率が悪い、(b) `ilike '%q%'` がフルテーブルスキャン (LIKE 用 index 不在)、(c) `count(*)::int` の COUNT が万件超で重い。 |
| 2. エラーハンドリング (DB 失敗、tx 失敗、bulk 部分成功) | 20 | **8** | listCampaigns に try/catch が一切なく、Promise.all のどちらかが reject すると **空白ページが 500 で返る**。bulk action は全件 atomic UPDATE で部分成功なし。**BulkBar が Server Action を呼んでおらず alert() で終わるため Server Action 失敗時にユーザに何も伝わらない (useActionState 不使用)**。 |
| 3. 観測性 (ログ・metric・incident_id) | 20 | **11** | クエリレイヤに log/timer/incident_id 紐付けが無い。`writeAudit` の `action` が `campaign.launched` 固定で **「実際に何が起きたか」が監査ログから追えない**。`source: "mock"` / `live` を画面に出している点は良い (運用上見える)。 |
| 4. ユーザビリティ運用 (空状態 / 停滞 / DEMO バッジ) | 20 | **17** | DEMO バッジ・空状態 (フィルタあり / 空) 出し分け・停滞バッジは仕様準拠。あと一歩は (a) 停滞判定がページ表示時刻基準のため SSG 静的化と相性が悪い、(b) `source: "mock"` 時に bulk action を押すと「デモのため更新されません」と alert する整合が片肺。 |
| 5. キャパシティ・安全 (上限 / レート / 暴発防止) | 20 | **13** | bulk 上限 200 件は Zod で実装済み (◎)。しかしレート制御なし、break-glass なし、bulk 実行ログから後追いリストア不能 (`targetId` CSV 結合)。**全件選択 UI が一括 200 件操作の引き金になりやすいのに UI 側の防護が `confirm()` 1 段だけ**。 |

R4 で確立した RLS / `withScopedDb` トランザクション境界はこのファイル群では **使われていない** (queries/actions が `getDb()` を直接叩いている)。MVP デモ段階では機能するが本番投入前に必ず `withScopedDb` 経由に揃える必要がある点が SRE 観点の最大の懸念。

---

## HIGH (リリース前に必須修正)

### HIGH-1: `withScopedDb` を通っていない — RLS GUC が立たず本番では空配列が返る
**ファイル**: `server/queries/campaigns.ts:44`, `server/actions/campaigns.ts:44,89`

R4 で導入された `lib/db-scoped.ts` の `withScopedDb` は、`db.transaction` 内で `set_config('app.org_id', ..., true)` を発行することで RLS policy `org_id = app_current_org()` を成立させる。本 S04 実装は `const db = getDb()` を直接呼んでおり GUC が一切セットされない。

- **本番投入時の挙動**: RLS が `app_current_org()` を `NULL` と評価し `org_id = NULL` (UNKNOWN) で全行が不可視に倒れる → `listCampaigns` は常に `items: []` を返し、bulk action も 0 件しか更新できない。
- **更に危険**: `getDb()` が `service_role` 経路で接続されている環境では逆に **クロステナント全件可視化** に倒れる (FORCE RLS で守られているが、policy 設計ミスやスキーマ拡張で 1 枚剥がれた瞬間に事故化)。
- **修正**:
  ```ts
  // server/queries/campaigns.ts
  import { withScopedDb } from "@/lib/db-scoped";
  export async function listCampaigns(args: ListCampaignsArgs) {
    return withScopedDb(async ({ tx }) => {
      const conditions = [eq(schema.campaigns.orgId, args.orgId!)];
      // ...
      const [rows, totalRow] = await Promise.all([
        tx.select({...}).from(schema.campaigns).where(where)...,
        tx.select({ value: sql`count(*)::int` }).from(schema.campaigns).where(where),
      ]);
      // 集計クエリも tx 経由に
    });
  }
  ```
- bulk action も同様。`session` は `withScopedDb` 内側に渡される。

### HIGH-2: listCampaigns に try/catch が無く、DB 障害で `/campaigns` が 500 ページ全面化
**ファイル**: `server/queries/campaigns.ts:57-74`, `app/(app)/campaigns/page.tsx:41`

- Promise.all で `rows` 取得と count を並列実行しているが、片方でも reject すると `await listCampaigns(...)` から throw され、page.tsx の async boundary で Next.js のデフォルト error page に倒れる。
- SLO 観点で「DB が瞬断 → メイン画面が真っ白 → ユーザは何をすればいいか分からない」になる。設計書 §24 SLO の availability target (一覧画面 99.5%) を割る原因になりやすい。
- **修正**: クエリ層で `catch` し、`source: "degraded"` で空配列 + `incident_id` を返す。page.tsx は `degraded` を検出したら DEMO バッジと同列に "障害発生中" バナーを表示する。
  ```ts
  try {
    const [rows, totalRow] = await Promise.all([...]);
  } catch (err) {
    const incidentId = newIncidentId();
    logger.error("listCampaigns failed", { incidentId, orgId, err });
    return { items: [], total: 0, source: "degraded", incidentId };
  }
  ```

### HIGH-3: BulkBar が Server Action に **結線されていない** — alert() で偽完了
**ファイル**: `components/campaigns/campaigns-table.tsx:236-243`

```tsx
onClick={() => {
  if (destructive) {
    if (!confirm(`${ids.length} 件を ${label} します。よろしいですか？`)) return;
  }
  alert(`${label}: ${ids.length} 件 (デモ環境のため実際の更新は行いません)`);
}}
```

- `server/actions/campaigns.ts` の `bulkPauseCampaigns` / `bulkArchiveCampaigns` は **どこからも呼ばれていない死蔵コード**。本番でユーザが「一時停止」ボタンを押しても何も起きず、alert で「実際の更新は行いません」と表示される → **本番事故扱い**。
- 加えて `useActionState` (Next 15) も `useFormStatus` も `<form>` も使っていないため、将来 Server Action を結線した時に **失敗してもユーザに何も伝わらない** (HIGH-4 と同根)。
- **修正**: BulkButton を `<form action={bulkPauseCampaigns}>` + `useActionState` で書き直し、`result.ok === false` 時に `result.message` を toast に表示する。Server Action 完了後 `revalidatePath('/campaigns')` で自動再取得。

### HIGH-4: Server Action 失敗時のユーザ通知経路がゼロ (useActionState 不使用)
**ファイル**: `server/actions/campaigns.ts:33-39, 76-87` + BulkBar 全体

- `bulkPauseCampaigns` は `{ ok: false, message: "..." }` を返すが、それを受け取って表示する Client 側コンポーネントが存在しない。
- 設計書 §24 incident_id 提示の運用 (「画面右上に INC-YYYY-XXXXXX を出してユーザに伝える」) も未実装。
- **修正パターン**:
  ```tsx
  "use client";
  import { useActionState } from "react";
  function BulkButton({ action, ids, label }: {...}) {
    const [state, formAction, pending] = useActionState(action, null);
    return (
      <form action={formAction}>
        {ids.map(id => <input type="hidden" name="ids" value={id} key={id} />)}
        <button disabled={pending}>{label}</button>
        {state?.ok === false && <span role="alert">{state.message}</span>}
      </form>
    );
  }
  ```
- 並行して `lib/incident.ts` を活用し、Server Action 内で失敗時に `newIncidentId()` を発行 → return に含め → toast 表示する。

### HIGH-5: 監査ログの `action` が常に `"campaign.launched"` で **監査証跡が虚偽**
**ファイル**: `server/actions/campaigns.ts:63, 108`

- `bulkPauseCampaigns` / `bulkArchiveCampaigns` ともに `action: "campaign.launched"` を渡している → §17 hash chain 付き append-only ログに「ローンチした」嘘記録が刻まれる。
- 後で「誰が 5/11 に 100 件まとめて一時停止したのか」を追えない (= incident 対応・インシデント postmortem で証拠が出ない)。
- **修正**: `lib/audit.ts` の `AuditAction` ユニオンに `"campaign.paused" | "campaign.archived"` を追加し、それぞれの action で呼び出す。同時に `targetId` のカンマ結合をやめ、ID 1 件につき 1 行 audit_log 行を作る (200 行になるが正しい解像度)。

---

## MEDIUM

### M-1: `leads` 集計クエリに `orgId` 述語がなく、RLS のみに依存
**ファイル**: `server/queries/campaigns.ts:84-94`

```ts
.from(schema.leads)
.where(inArray(schema.leads.campaignId, ids))
.groupBy(schema.leads.campaignId);
```

- `ids` は同一 org のキャンペーンに絞ってあるので結果は正しいが、**インデックス選択ヒント** として `eq(schema.leads.orgId, orgId)` を一緒に置くと `leads_org_idx` (`leads_camp_idx` ではなく) も使えるようになる。25 キャンペーン × 数千 lead が現実的レンジになると効く。
- 加えて HIGH-1 の `withScopedDb` 経由になっていない時点では RLS GUC も立っていないため、**この WHERE 句が唯一のテナント分離になっている**。明示的に `eq(schema.leads.orgId, orgId)` を入れて防御線を二重化すべき。

### M-2: `count(*)::int` の総件数 COUNT がスケールしない
**ファイル**: `server/queries/campaigns.ts:73`

- PostgreSQL の `count(*)` は seq scan or index-only scan が必要で、`campaigns` が 5 万行を超えたあたりからページネーション 1 回ごとに数百 ms 食う。
- 設計書 §15 で API レスポンス P95 < 600ms を掲げているが、`/campaigns` は (a) campaigns 一覧 + (b) total count + (c) leads 集計の 3 クエリ並列で律速になりやすい。
- **修正案 (Phase2)**:
  - 50 件以下なら count 不要 → `LIMIT perPage+1` で「次ページあり?」を判定し件数表示を「25+ 件」に。
  - 厳密件数が必要なら `daily_metrics` のような precomputed 数値を `org_campaign_count` として保持。

### M-3: `ilike '%q%'` がフルテーブルスキャン (前方一致でも index 不在)
**ファイル**: `server/queries/campaigns.ts:52`, `db/schema.ts:127-144`

- `campaigns.name` には `camp_org_idx` (org_id 単独 index) しかなく、`ilike '%q%'` は B-tree で使えない。`pg_trgm` の GIN index が必要。
- 1,000 件規模では実用、10,000 件超で `q` 検索が 200ms 超に伸びる。
- **修正**:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX campaigns_name_trgm_idx ON campaigns USING gin (name gin_trgm_ops);
  ```
  もしくは検索 UI を「前方一致」に縮退して `ilike 'q%'` + 通常 B-tree で十分対応可能。
- 暫定では `q.length < 2` で検索発火させないバリデーションを追加 (debounce はあるが文字数下限なし → 1 文字検索でフルスキャン誘発)。

### M-4: bulk 全件選択時 200 件超で UI 表示は止まるが、選択漏れに気づきにくい
**ファイル**: `server/actions/campaigns.ts:11` / `components/campaigns/campaigns-table.tsx:32-38`

- Zod の `.max(200)` は防御線として正しい (◎)。
- ただし「全選択」ボタンは **現在の 25 件ページ内のみ** を選択する仕様。ページネーション込みの「絞り込んだ全件選択 (cross-page select all)」は未実装。実装するなら最大 200 件で頭打ちにする UI 制御 (「最大 200 件まで」表示) が必須。
- 現状の `toggleAll` は `rows` (25 件以下) を選ぶだけなので 200 件超過は構造的に起きない (◎)。**Phase2 で cross-page select all を入れる時に必ずこの 200 上限を UI に表示**。

### M-5: BulkBar の `fixed bottom-6` がモバイルでスクロール阻害 / クリック干渉
**ファイル**: `components/campaigns/campaigns-table.tsx:200-221`

- `fixed inset-x-0 bottom-6 z-40` は良いが、モバイル Safari で virtual keyboard 表示時に底辺被り。`pointer-events-none` の親で逃げているのは適切 (◎) だが、**最終行のキャンペーン名タップ判定の上に BulkBar が乗る瞬間がある**。
- iOS で `alert()` / `confirm()` は **モーダル中スクロール完全停止 + ページ全体スクロール権を奪う** ため、「うっかり選択 → confirm モーダル → モバイルでスクロール戻せない」体験が発生。
- **修正**: HIGH-3 で結線した時点で `alert/confirm` を捨て、`<dialog>` ベース or shadcn `<AlertDialog>` に置換する。BulkBar 自体は `bottom-[max(1.5rem,env(safe-area-inset-bottom))]` で safe area 対応。

### M-6: クエリ層で metric / structured log 出力なし
**ファイル**: `server/queries/campaigns.ts` 全体

- listCampaigns のレイテンシ・件数を観測する経路が一切無い。
- 設計書 §24 で P95 を SLO 化する以上、せめて以下を出力したい:
  ```ts
  const t0 = performance.now();
  // ... query
  logger.info("listCampaigns", {
    orgId, page, perPage, total, hits: items.length,
    latencyMs: Math.round(performance.now() - t0),
  });
  ```
- Phase2 で OpenTelemetry を入れる前提なら、最低限 `console.log` ベースの JSON で出しておけば Vercel Log Drain で拾える。
- これは S04 単体の責務というよりプロジェクト全体のロガー基盤の問題で、L-1 として記録。

### M-7: 停滞バッジの判定が SSR `Date.now()` 基準 → CDN キャッシュと衝突
**ファイル**: `server/queries/campaigns.ts:107-114`

- `force-dynamic` を指定しているので現状はキャッシュされないが、Phase2 で ISR (revalidate 60s) を入れた瞬間に「停滞バッジが古いタイムスタンプに固着」する。
- 一覧画面で `now - lastAt > 24h` を server で計算するより、**Client コンポーネントで `<RelativeTime ts={lastActivityAt}/>` 形にして停滞判定もクライアント時刻で行う**ほうが将来の ISR と整合。
- 暫定では `force-dynamic` 継続で問題ないが、Phase2 issue として明記。

### M-8: bulk action にレート制御なし — クリック連打で同一 UPDATE 多重発火
**ファイル**: `server/actions/campaigns.ts` 全体

- `lib/rate-limit.ts` (60req/分) は CSP report で使われているが Server Action では不使用。
- HIGH-3 修正後、ボタン連打で 200 件 × N 回の `UPDATE` が走る可能性。冪等な操作 (paused → paused) なので致命的ではないが、`audit_log` が同じ内容で 5 行重複記録される → 監査が読みにくくなる。
- **修正**: `useFormStatus().pending` で button disable + Server Action 先頭で `rateLimit(\`bulk-pause:${session.userId}\`, 5, 60_000)` をかける。

### M-9: `setSelected` が `rows` 切り替え (フィルタ変更 / ページ遷移) でリセットされない
**ファイル**: `components/campaigns/campaigns-table.tsx:27`

- ページ 2 で `c26` を選択 → ページ 1 に戻ると BulkBar が「1 件選択中」と出続けるが、`c26` は今ページに存在しない。`allSelected` 判定も壊れる。
- bulk action 実行時に「画面上に居ない ID」を更新するため、ユーザの認知と実行が乖離する。
- **修正**:
  ```tsx
  React.useEffect(() => {
    setSelected(prev => new Set([...prev].filter(id => rows.some(r => r.id === id))));
  }, [rows]);
  ```
  もしくは page/filter 変更時に `setSelected(new Set())` で全クリア。

---

## LOW

- **L-1**: プロジェクト全体に構造化ロガーが不在。`pino` or `console.log + JSON.stringify` の薄いラッパを Phase2 で入れる。
- **L-2**: `campaign-status.ts` の `CAMPAIGN_STATUS_OPTIONS` に空文字 value `""` が混在。`<Select>` の HTML 仕様上は OK だが、フォームライブラリと組み合わせる時に `undefined` と区別できない事故源。`"all"` に揃える方が安全。
- **L-3**: `campaigns-table.tsx:165` の `<Link className="absolute inset-0 hidden md:hidden">` は `md:hidden` で常に非表示。意図が不明。デッドコードなら削除、モバイル行クリック導線なら `md:hidden` → `md:hidden block` の typo の可能性が高い。
- **L-4**: `mockCampaigns` の `mkRow` 内で `startsAt: lastActivityAt` を入れているのは意図的か? schema 的に startsAt はキャンペーン開始日時で lastActivityAt とは意味が違う。デモ表示には影響ないが、`fmtRelative(row.startsAt)` を将来出すと混乱する。
- **L-5**: `BulkBar` の `count / totalRows` 表示は「現ページ内 / 25」になる。「絞り込み全体 / total」を出した方が運用判断しやすい (cross-page select all を入れる前提でも文言を `count / page` に明示)。
- **L-6**: `BulkButton` の `destructive` は「アーカイブ」だけだが、「一時停止」も復旧に手数がかかる準破壊操作。両方に confirm を出す or 両方とも `<AlertDialog>` で統一が望ましい。
- **L-7**: `EmptyState` の `role="status"` は控えめだが、`primary` ボタン押下を促す UI である以上 `aria-live="polite"` 付与 + 見出し階層 (`<h2>` を `<h3>` に) を h1 (page header) との関係で見直し。
- **L-8**: `Pagination` の `prev`/`next` 計算がページ範囲外時に `disabled` 表示まで行くのは ◎、ただし `total === 0` のときも `0 件` 表示と pager は出る。空状態 (= `items.length === 0`) では page.tsx 側で Pagination をそもそも描画しない方が一貫。

---

## 良い点 (Top 3)

1. **集計クエリの形が正しい (N+1 回避)** — `count(*) filter (where state in (...))` で 1 ラウンド 1 クエリ完結。25 キャンペーン × 4 集計 (total/sent/replied/meeting) + last_at を 1 SQL で取り切るのは設計書 §15 の P95 600ms 目標に対して正しいアプローチ。`db.select(...).from(leads).where(inArray(campaignId, ids)).groupBy(campaignId)` の構造が drizzle で読みやすい。

2. **DEMO バッジ・空状態出し分け・停滞バッジが運用視点で揃っている** — `source === "mock"` を画面に出すことで「本番接続できていない」事象がユーザにも開発にも一目で分かる (= silent failure 防止)。設計書 §15.4 / §24.2 の「ユーザに状態を見せる」原則と一致。`anomaly` フラグの「24h 経過なのに running」も Runbook 化しやすい。

3. **bulk 上限 200 件 / Zod スキーマで防御済み** — `z.array(z.string().uuid()).min(1).max(200)` で UI が壊れて 10,000 件渡しても DB は守られる。`uuid()` バリデーションも入っており、不正 ID で `inArray` を巨大化される攻撃も防げている。Server Action 側のキャパシティ安全としては基本ができている。

---

## 95+ 到達のための残ブロッカー

| 優先 | 項目 | 期待効果 | 該当指摘 |
| ---: | --- | --- | --- |
| 1 | `withScopedDb` 経由に揃え、RLS GUC を確実にセット | 本番投入時に空配列バグを撲滅、設定ミス耐性 +4 | HIGH-1 |
| 2 | BulkBar を `useActionState` + `<form action={bulkPause}>` で結線、alert/confirm を `<AlertDialog>` に置換 | 「死蔵 Server Action」を解消、失敗時の incident_id 通知経路が確立、モバイル UX が回復 | HIGH-3, HIGH-4, M-5 |
| 3 | listCampaigns に try/catch + `source: "degraded"` + incident_id 返却 | DB 瞬断で画面が真っ白にならず、SLO availability を防衛 | HIGH-2 |
| 4 | `AuditAction` に `campaign.paused` / `campaign.archived` を追加し、1 ID = 1 audit row に分解 | 監査ログの解像度と真実性が回復、後追いリストア可能に | HIGH-5 |
| 5 | `pg_trgm` GIN index + `count` の Phase2 戦略合意 (LIMIT+1 or precomputed) | 1 万件超でも P95 600ms を維持 | M-2, M-3 |
| 6 | クエリ層 / Server Action 層に構造化 JSON log + latencyMs を出力 | Vercel Log Drain → Sentry/Datadog で SLO 監視の土台が立ち上がる | M-6 |
| 7 | bulk action にユーザ単位 rate-limit + `useFormStatus().pending` で連打防止 | 監査ログ重複と誤操作の抑止 | M-8 |
| 8 | `rows` 変更時の selection リセット effect | 「画面に居ない ID を bulk pause」事故を構造的に防止 | M-9 |

上記 1〜4 (HIGH 全消し) で **目安 +20pt (62 → 82)**、5〜8 (MEDIUM 高優先) で **+10pt (82 → 92)**、L-1 / L-3 / L-5 など軽量項目を片付けて **95+**。

なお、本ファイル群は「**MVP デモ画面として見せる**」目的の完成度としては十分機能している。**本番投入 (RLS-on Supabase 接続) の手前で HIGH-1〜5 を片付けないと、画面が空になるかコンプライアンス汚染が起きる** ことだけが SRE 観点の絶対条件。
