# S07 リード一覧 — SRE Review (r1)

Reviewer: sre-agent (read-only)
Date: 2026-05-11
Scope:

- `app/(app)/leads/page.tsx`
- `server/queries/leads.ts` (listLeads / getLeadById / getCampaignNamesForFilter)
- `server/actions/leads.ts` (bulkDisqualifyLeads)
- `components/leads/leads-table.tsx`, `leads-filter-bar.tsx`, `lead-drawer.tsx`
- `db/schema.ts` (leads / audit_log)
- `lib/incident.ts`, `lib/audit.ts`

---

## Summary

| 軸                                       |    Score |
| ---------------------------------------- | -------: |
| 1. パフォーマンス (集計/ページング/index/N+1) |    13/20 |
| 2. エラーハンドリング (DB / forbidden / 404) |    14/20 |
| 3. 観測性 (incident_id / ログ)             |    13/20 |
| 4. ユーザビリティ運用 (DEMO/degraded/空状態) |    18/20 |
| 5. キャパシティ・安全 (bulk 500 / レート)    |    11/20 |
| **総合**                                  | **69/100** |

判定: **NOT PASS (90+ 未達)** — 90+ までに HIGH 3 件 / MEDIUM 4 件の解消が必要。

---

## 1. パフォーマンス — 13/20

### HIGH-P1: `listLeads` の `count(*)` が 50万件で常時走る

`server/queries/leads.ts:103-107`

```ts
Promise.all([
  db.select(... rows ...).limit(safePerPage).offset(offset),
  db.select({ value: sql<number>`count(*)::int` }).from(schema.leads).where(where),
]);
```

- 50万件テーブルで `org_id = ?` フィルタ後でも 1org=20万件規模なら毎リクエスト `count(*)` でフルスキャン相当 (Postgres は count に index-only scan を効かせるが MVCC のため visibility check が必須)。
- ページネーション UI のために**ページごとに毎回**走るのが致命的。フィルタ変化なしでも常時実行。
- **影響**: P95 200-800ms 上昇、DB CPU 持続的上昇、Pagination が "総件数表示" のためだけにテーブル全体を走査。

**推奨**:

1. **総件数を概算化** — `pg_class.reltuples` ベースの推定値、または `count(*) over ()` を window で 1 クエリ化。
2. **next/prev のみ** — `total` を返さず `hasMore` フラグ (rows.length === perPage + 1) で十分なら count を完全削除。
3. **キャッシュ** — `unstable_cache` で同一 where 句の count を 30-60s memoize。`force-dynamic` 下でも count だけは tolerable。

### HIGH-P2: ILIKE 検索が pg_trgm GIN 不在でフルテーブルスキャン

`server/queries/leads.ts:71-76`

```ts
const like = `%${escapeLikePattern(safeQ)}%`;
sql`(${schema.leads.fullName} ILIKE ${like} OR ${schema.leads.company} ILIKE ${like} OR ${schema.leads.headline} ILIKE ${like})`;
```

- `%foo%` の leading wildcard は B-tree index を一切使わない。`db/schema.ts:171-175` の leads index は `(org_id)`, `(campaign_id)`, `(state)` のみで **trigram GIN 不在**。
- 50万件で 3 列 ILIKE → 1 クエリで 1-3 秒。`q` が空でも `escapeLikePattern("") = ""` で `%%` 化はしないが (`if (safeQ)` で gate されている、OK)、検索時の劣化は確実。
- 加えて `count(*)` 側も同じ ILIKE を走らせるので **2 倍のフルスキャン**。

**推奨** (migration 必要):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX leads_fullname_trgm ON leads USING gin (full_name gin_trgm_ops);
CREATE INDEX leads_company_trgm  ON leads USING gin (company   gin_trgm_ops);
CREATE INDEX leads_headline_trgm ON leads USING gin (headline  gin_trgm_ops);
-- ILIKE は trgm GIN を自動利用 (Postgres 9.1+)
```

または最小限フルテキスト検索 (`tsvector` + GIN) に切り替え。

### MEDIUM-P3: orderBy `last_action_at DESC` 用の複合 index 不在

leads の sort key は `last_action_at DESC` (page.tsx の暗黙ソート) だが、index は `leads_org_idx (org_id)` 単独。

- (org_id, last_action_at DESC) または部分 index がないため、org 内ソートでヒープアクセス＋in-memory sort になる。

**推奨**:

```sql
CREATE INDEX leads_org_last_action_idx
  ON leads (org_id, last_action_at DESC NULLS LAST);
```

state フィルタ常用なら `(org_id, state, last_action_at DESC)` の検討も。

### MEDIUM-P4: ドロワー再ロード時の `getLeadById` 単発クエリ

`app/(app)/leads/page.tsx:46-58`

- `Promise.all` で `listLeads` と並列実行されているのは良い (待ち時間は最大値だけ)。
- しかし `listLeads.items` の中に同じ ID の行が既に存在するケースが多い (フィルタ条件が一致する場合)。再フェッチは無駄。
- もっと深刻なのは、`listLeads` が degraded (例外発生) で空配列を返した状態で `getLeadById` が走り続けると、同じ障害源 (DB) に対し更にクエリを投げてしまう。

**推奨**:

1. `listLeads.items.find(i => i.id === drawerLeadId)` でショートサーキット、無ければ `getLeadById` にフォールバック。
2. `listLeads` が `degraded` の場合は drawer 取得をスキップして "現在取得できません" 表示。

### LOW-P5: `getCampaignNamesForFilter` が limit 50 で打ち切り

- 50 件超のキャンペーンを持つ org でフィルタ選択肢が欠落。`listLeads.campaignId` 自体は ID 直接受け取りなので URL hack で残り org も検索できるが UX 上 silent drop は事故。
- 検索可能 Combobox 化 or page=2 lazy load 推奨。

---

## 2. エラーハンドリング — 14/20

### HIGH-E1: `getLeadById` の例外が完全に隠蔽される

`server/queries/leads.ts:198-200`

```ts
} catch {
  return null;
}
```

- 例外を握りつぶし、incident_id も発行しない、ログも出さない。
- ユーザー視点では「リードが見つかりません」と「DB 障害」が区別不能。
- ドロワー UI には incident_id ヒントが渡らないのでサポートエスカレーションが詰む。

**推奨**:

```ts
} catch (e) {
  const incidentId = newIncidentId();
  logger.error({ incidentId, leadId, op: "getLeadById" }, e);
  return null; // 戻り型は維持するが、上流で incident_id を取り回せるよう型変更も検討
}
```

または `getLeadById` の戻りを `LeadListItem | { error: true; incidentId: string } | null` に分離。

### MEDIUM-E2: `bulkDisqualifyLeads` のエラーメッセージに incident_id が無い

`server/actions/leads.ts:86-89`

```ts
} catch (e) {
  if (process.env.NODE_ENV !== "production") console.error("[bulkDisqualifyLeads]", e);
  return { ok: false, affected: 0, message: "処理中に問題が発生しました" };
}
```

- 一括除外という**監査対象操作**で失敗時に追跡ハンドルが無い。ユーザーがサポート連絡しても再現困難。
- 加えて `console.error` が **本番では完全に sink されている** (NODE_ENV ガード) のは観測性として致命的。

**推奨**:

```ts
} catch (e) {
  const incidentId = newIncidentId();
  logger.error({ incidentId, op: "bulkDisqualifyLeads", orgId: session.orgId, ids: parsed.data.ids.length }, e);
  return { ok: false, affected: 0, message: `処理中に問題が発生しました (${incidentId})` };
}
```

### MEDIUM-E3: `requireOperatorSession` の `FORBIDDEN` がログされない

- viewer ロールが除外操作を試みても audit に乗らない (`writeAudit("auth.forbidden")` 未発行)。
- 内部不正検知の観点で「忘れずに viewer の操作試行を記録」が必要。

**推奨**: forbidden return 前に `writeAudit({ action: "auth.signin_failed", ... })` 相当の権限拒否ログを残す (型に `permission.denied` 追加)。

### LOW-E4: `not_found` が drawer で文字メッセージのみ

- `lead-drawer.tsx:198` の "URL の lead パラメータに該当するリードが見つかりませんでした。" は OK だが、HTTP の 404 セマンティクスを取らない (ページは 200 OK)。
- 監視 (uptime / synthetic) で 404 を検出したい場合に運用が困るので、`metadata.robots = "noindex"` 程度は付与。SEO 観点で `notFound()` を呼ぶ判断は UX とトレードオフ。

---

## 3. 観測性 — 13/20

### HIGH-O1: incident_id が DB / 集約ログに永続化されない

- `lib/incident.ts` で生成された `incident_id` は `listLeads` の戻り値経由でユーザーへ表示されるが、**サーバ側のログ / audit / Sentry のいずれにも紐付かない**。
- ユーザーから "INC-2026-A1B2C3 が出た" と言われても、その ID がどのリクエストか SRE 側で逆引きできない。

**推奨**:

1. logger (pino / winston / `next-logger`) を導入し `{ incidentId, op, orgId, userId, durationMs, err }` を JSON で stdout に出す (Vercel Functions の log drain で集約可)。
2. Sentry を使うなら `Sentry.captureException(e, { tags: { incident_id: incidentId } })` を必ず併発行。
3. `console.error` の `NODE_ENV !== "production"` ガード (`leads.ts:127`, `actions/leads.ts:87`) を撤去。本番こそログが必要。

### MEDIUM-O2: correlation_id がリクエスト/audit に伝播していない

- `writeAudit` は `correlationId` 引数を受け付けるが、`bulkDisqualifyLeads` から渡されていない。
- middleware で `x-request-id` ヘッダから correlation_id を採取 → AsyncLocalStorage で持ち回し → audit / log に統一 ID 付与、が一般的なパターン。

**推奨**: `instrumentation.ts` でグローバル AsyncLocalStorage を初期化し、middleware で `x-request-id` (なければ生成) を store に詰める。`writeAudit` / logger からその store を参照。

### MEDIUM-O3: メトリクス未計装

- listLeads / getLeadById / bulkDisqualifyLeads の `duration_ms`, `result=success|degraded|error` カウンタが無い。
- SRE ダッシュボードで "lead list が degraded を返している割合" が見えない = SLO が立てられない。

**推奨** (最低限):

```ts
const start = performance.now();
// ...
metrics.histogram("leads.list.duration_ms", performance.now() - start, { source });
metrics.counter("leads.list.result", 1, { result: source });
```

Vercel なら OpenTelemetry / `@vercel/otel`、それ以外なら StatsD/Prom.

### LOW-O4: PII を含む可能性のあるログ素材

- フォロー実装で `logger.info({ leadId, fullName, company })` を出すと PII が log drain に流れるリスク。
- 現状は console.error が dev only なので未顕在化だが、本番ログ化と同時にレダクションポリシ (`lib/log/redact.ts`) を整備すべき。

---

## 4. ユーザビリティ運用 — 18/20

良いところ:

- `source === "mock"` で DEMO バッジ + 説明文 (page.tsx:75-83) ✓
- `source === "degraded"` で role="alert" + incident_id 表示 (page.tsx:85-105) ✓
- 空状態を「フィルタ起因」と「無リード」で**正しく出し分け** (page.tsx:118-134) ✓
- bulk action 中の disabled + spinner (leads-table.tsx:262-281) ✓
- toast 自動消去 3500ms + role="status" + aria-live ✓

### MEDIUM-U1: 停滞バッジが無い

- 設計書的に `last_action_at` が古いリードは「停滞」として可視化したい (一般的な SaaS UX)。
- 現状は `fmtRelative` のテキスト表示のみで一目で停滞検知できない。

**推奨**: `lastActionAt < now() - 14d && state in (PENDING, MESSAGED)` で `<Badge tone="warning">停滞</Badge>` を表示。S07 r1 の必須ではないが 90+ 判定の差別化要因として推奨。

### LOW-U2: degraded 時の "再試行" CTA が無い

- 現在は「時間をおいて再読み込みしてください」と文言案内のみ。
- 1-click `<a href="/leads">再読み込み</a>` ボタンを置くとオペレータ運用がスムーズ。

### LOW-U3: bulk confirm が `window.confirm`

- `leads-table.tsx:248` の `window.confirm` はスマホでスタイル制御不可、CSP の `unsafe-eval` とは無関係だが、デザインシステムと不揃い。Designer review 領域だが SRE 観点でも "誤操作防止度" が低い (Enter キー 1 発で OK)。

---

## 5. キャパシティ・安全 — 11/20

### HIGH-S1: bulk UPDATE → audit ループにトランザクション不在

`server/actions/leads.ts:52-74`

```ts
const updated = await db.update(schema.leads).set(...).where(...).returning(...);
for (const row of updated) {
  await writeAudit({...}); // 500 回逐次
}
```

問題:

1. **原子性なし** — UPDATE 成功後に audit ループ中で例外が出ると、状態だけ DISQUALIFIED で監査が部分書きという**改竄耐性違反**。設計書 §17 (audit append-only / hash chain) の前提が崩れる。
2. **N+1** — `writeAudit` 自体が `SELECT prev_hash` + `INSERT` の 2 クエリ。500 件で 1000 クエリ。Vercel Functions のタイムアウト (10s) に乗りやすい。
3. **hash chain race condition** — 並行 bulk が同 org で走ると `prev_hash` 取得タイミング次第で **同じ prev_hash を持つ枝分かれ** が発生し chain が分岐 = 監査の検証不能化。

**推奨**:

```ts
await db.transaction(async (tx) => {
  // 1) SELECT FOR UPDATE で行ロック + 既存 state を取得 (diff の from を埋めるため)
  const before = await tx.select({ id: leads.id, state: leads.state })
    .from(leads).where(...).for("update");

  // 2) UPDATE
  const updated = await tx.update(leads).set(...).where(...).returning(...);

  // 3) hash chain を 1 行で集約 ("lead.bulk_disqualified") もしくは
  //    advisory lock (pg_advisory_xact_lock) で audit 書込を serialize
  await writeAuditBulk(tx, {
    orgId: session.orgId,
    action: "lead.bulk_disqualified",
    targetIds: updated.map(r => r.id),
    diff: { ids: updated.map(r => r.id), state: { to: "DISQUALIFIED" } },
  });
});
```

- bulk 専用 audit エントリを 1 件にすることで hash chain 件数も 500 → 1 になり、audit_log の肥大化も防げる。
- もしくは 500 件分の audit を残したい要件があるなら、advisory lock で hash chain 書込を排他化。

### MEDIUM-S2: レート制御 (rate limit) 不在

- `bulkDisqualifyLeads` に IP / user 単位の throttle が無い。`getDb()` 接続プールを 500 件 × 並行 N で食い潰す DoS が可能。
- 既存 `pg_pool` 設定不明 (`db/client.ts` 未確認だが) でも、操作系 Server Action には常識的に rate limit を入れるべき。

**推奨**: `@upstash/ratelimit` or 自前で `(orgId, userId, "bulk_disqualify")` キーで `5 req / min` 程度。

### MEDIUM-S3: 500 件上限は zod で弾くが UI 側ガードなし

`server/actions/leads.ts:20`

```ts
ids: z.array(z.string().uuid()).min(1, "対象を選択してください").max(500),
```

- サーバで 500 件超を弾くのは正しい (HIGH ではない) が、UI 側 (`leads-table.tsx`) は perPage=50 のため通常は 50 件しか選択不可。
- ただし将来 "ページ横断選択" を入れた瞬間に 501 件目以降が silent drop。せめて `formData.getAll("ids").length > 500` 時点で UI 側で "上限 500 件" メッセージ提示を入れたい。

### LOW-S4: PAGE_MAX = 2000 の意図不明

`server/queries/leads.ts:39` `const PAGE_MAX = 2000`

- 2000 × perPage(50) = 10万件目までしか辿れない。50万件規模を前提とするなら不整合。
- 一方で 50万件全部を offset/limit でページめくりすることに意味があるかは別議論 (cursor pagination 推奨)。
- 設計書側で「ページネーション最大件数」を明示しておくべき。

---

## 90+ 到達に必要な修正一覧

| #     | 優先度    | 対象                          | 概要                                                  | 想定 score 加点 |
| ----- | --------- | ----------------------------- | ----------------------------------------------------- | --------------- |
| HIGH-P1 | HIGH    | listLeads count               | hasMore 化 or 30-60s cache                            | +3              |
| HIGH-P2 | HIGH    | leads ILIKE                   | pg_trgm GIN index 3 列                                | +2              |
| HIGH-E1 | HIGH    | getLeadById                   | catch で incident_id + logger.error                   | +2              |
| HIGH-O1 | HIGH    | logger 導入                   | console.error の NODE_ENV ガード撤去 + 構造化         | +3              |
| HIGH-S1 | HIGH    | bulk audit                    | tx で囲む / hash chain 集約 entry 化                  | +4              |
| MED-P3  | MEDIUM  | leads index                   | (org_id, last_action_at DESC) 複合 index              | +1              |
| MED-P4  | MEDIUM  | getLeadById                   | listLeads.items から find ショートサーキット          | +1              |
| MED-E2  | MEDIUM  | bulk error msg                | incident_id を message に同梱                         | +1              |
| MED-O2  | MEDIUM  | correlation_id                | middleware + AsyncLocalStorage 伝播                   | +1              |
| MED-O3  | MEDIUM  | metrics                       | duration_ms / result counter                          | +1              |
| MED-S2  | MEDIUM  | rate limit                    | bulk_disqualify を 5 req/min                          | +1              |

HIGH 5 件で +14 → 83/100。MEDIUM 6 件で +6 → **89-90/100**。
HIGH-S1 (audit tx) は 90+ 到達の必須条件。それ以外を満たさないとSRE観点では本番運用許可不可。

---

## 判定

- **総合**: 69/100
- **HIGH**: 5 件 (P1, P2, E1, O1, S1)
- **MEDIUM**: 6 件 (P3, P4, E2, E3, O2, O3, S2, S3 のうち優先 6)
- **LOW**: 5 件 (P5, E4, O4, U2, U3, S4)

**Next action**:

1. HIGH 5 件を r2 で必須対応。特に HIGH-S1 (bulk audit transaction) は機能の正しさに直結。
2. pg_trgm migration を drizzle で追加 (`extensions` + `gin` index)。
3. logger + incident_id pipeline を `lib/log/` 配下に新設し、listLeads/getLeadById/bulkDisqualify の 3 ヶ所で利用。
4. その上で再レビュー → 90+ を狙う。
