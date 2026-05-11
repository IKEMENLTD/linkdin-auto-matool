# S09 受信箱 SRE レビュー (r1)

- 対象: `server/queries/inbox.ts`, `app/(app)/inbox/page.tsx`, `components/inbox/inbox-thread-list.tsx`, `components/inbox/inbox-filter-tabs.tsx`, `lib/incident.ts`, `db/schema.ts` (messages / leads)
- 観点: SRE (パフォーマンス・エラーハンドリング・観測性・運用UX・キャパシティ)
- 評価日: 2026-05-11

---

## 総合スコア: **86 / 100** — 判定: **NEAR (要修正で 90+ 到達可能)**

| # | 観点 | 配点 | 得点 | 主な欠点 |
|---|------|------|------|----------|
| 1 | パフォーマンス | 20 | **14** | messages の (lead_id, sent_at DESC) 複合 index 不在、leads (org_id, state, last_action_at DESC) 不在、count(\*) 二重実行 |
| 2 | エラーハンドリング | 20 | **18** | degraded + incidentId 一貫。本番 console.error 抑制が片方向で集約先未配線 |
| 3 | 観測性 | 20 | **15** | INC は乱数 6hex のみで衝突確率明記済だが本番シーケンス未着手。correlation_id がリクエスト境界で未伝播 |
| 4 | ユーザビリティ運用 | 20 | **19** | DEMO / degraded / SLA バッジ・空状態すべて実装。code タグの incident_id コピー導線がない (軽微) |
| 5 | キャパシティ・安全 | 20 | **20** | clamp/q 長さ/PAGE_MAX/perPage 上限 100/state 5値固定。SQL injection 面も escapeLikePattern + drizzle param で OK |

---

## HIGH (90+到達のために必須 / 本番投入前に必須)

### H-1. `messages` の (lead_id, sent_at DESC) 複合 index が存在しない
**ファイル:** `db/schema.ts:192-195`

現状:
```ts
leadIdx: index("msg_lead_idx").on(t.leadId),
sentIdx: index("msg_sent_idx").on(t.sentAt),
```

最終メッセージ取得クエリ (`inbox.ts:149-164`) は:

```sql
row_number() over (partition by lead_id order by sent_at desc)
... where lead_id in (...)
```

`msg_lead_idx` (lead_id only) を使うと、各 lead に対する全 messages を取得→メモリ内ソートになる。1 lead あたり数百〜数千件メッセージが将来溜まると、30 lead × 数千行 = **数万行を毎リクエスト読む**ことになる。

**インパクト:**
- messages 数千万件規模で Index Scan → Sort (heap fetch) で **p95 1〜3秒** クラスになる典型パターン
- ページ表示の支配的コストになる

**修正:**
```ts
// db/schema.ts messages の index 定義に追加
leadSentIdx: index("msg_lead_sent_idx").on(t.leadId, sql`sent_at DESC`),
```
+ migration:
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS msg_lead_sent_idx
  ON messages (lead_id, sent_at DESC);
-- 既存の msg_lead_idx は冗長になるので様子見て DROP 可
```

これにより `row_number()` partition の各パーティション先頭 1 行が **Index-only scan で O(N_leads)** に落ち、30 lead = 30 行アクセスで済む。`btree (lead_id, sent_at DESC)` が WINDOW PARTITION BY/ORDER BY と完全に一致するので Postgres は Sort Node を省略する (`WindowAgg` だけになる)。

> 補足: GIN は不要 (全文検索ではない)。btree 複合で十分。

### H-2. `leads` の (org_id, state, last_action_at DESC) 複合 index 不在 → ページネーション本体クエリが遅い
**ファイル:** `db/schema.ts:171-175`, `inbox.ts:117-129`

現状の index:
- `leads_org_idx (org_id)`
- `leads_state_idx (state)`

メインの一覧クエリは:
```
WHERE org_id = $1
  AND state IN ('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')
ORDER BY last_action_at DESC
LIMIT 30 OFFSET ?
```

`org_id` だけの index でヒットして、その後 state フィルタ + メモリ内ソートになる。テナント内 leads が **数十万件**スケールに達した時点で OFFSET 大での p95 劣化が確実。

**修正:**
```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_org_state_action_idx
  ON leads (org_id, state, last_action_at DESC NULLS LAST);
```

これで「特定テナントの inbox 対象 state を新しい順」が **Index-only on (org_id, state)** で取り、`last_action_at DESC` がそのまま ORDER BY を満たす。LIMIT 30 ヒットで読み打ち切り。

### H-3. `count(*)` を 2 重に走らせている (totalRow + statusCounts) → 同じ org_id を 2 回フルスキャン
**ファイル:** `inbox.ts:130-140`

```
totalRow: count(*) WHERE org+state+q
statusCounts: count(*) GROUP BY state WHERE org+state(5値)
```

`statusCounts` の合算が `counts.all` になっており (`inbox.ts:207`)、これは **q や state フィルタを反映しない** "テナント全体の inbox total" を示す。一方 `totalRow` はフィルタ後のページネーション用 total。それぞれ役割は違うが、

- q を打った時の **total と counts.all の意味のズレ**がユーザに見える (タブの数字とページ数の数字が違う)
- `count(*)` × 2 同時実行は Postgres プランナにとって **同じテーブルへの並列 SeqScan/IndexScan 2 つ**で I/O が重複する

**インパクト:** 機能的バグ寄り + 軽い性能ペナルティ。ユーザビリティ運用にも 1 点引っ張られる。

**修正案 A (推奨, シンプル):**
`statusCounts` を **q 条件なし・state 5値で GROUP BY** にしてタブ数字専用とし、`totalRow` を「フィルタ後 total ページネーション専用」と役割を完全分離。これは現状コード通りなので、その意図をコメント化＋ counts.all の意味を「タブ "すべて" = 受信箱全体 (検索フィルタ非適用)」に明示。タブ表示としてはむしろこの挙動が自然なので、コードに明示コメントだけ追加すれば実質 OK。

**修正案 B (将来):**
`mv_inbox_status_counts` (テナント×state の MATERIALIZED VIEW) を 1 分粒度で refresh して `statusCounts` を O(1) lookup にする。10k テナント時に効く。

---

## MEDIUM (90+到達には推奨 / 本番運用で効く)

### M-1. INC-ID 衝突対策が「年間 100件で 3.7%」前提のままで本番未昇格
**ファイル:** `lib/incident.ts:7-15`

コメントが正直で良い (「本番では DB シーケンスに置換予定」)。ただし:
- 6 hex = 16,777,216 通り → 誕生日 1% 衝突は **約 583 件で到達**
- インシデント保管期間が 1 年なら 583 件/年でアウト

**修正:**
1. 短期: `randomBytes(4)` (8 hex = 42億通り) に増やす → 1% 衝突は **約 9300 件**
2. 中期: `INC-YYYY-NNNNNN` 形式の DB シーケンス (`CREATE SEQUENCE inc_seq`) に切り替え
3. すくなくとも `incident_logs` テーブルに **(incident_id, created_at, route, org_id, error_class)** を最小フィールドで append し、衝突検知できるようにする

### M-2. degraded 経路で incident_id が "クライアントに返るだけ" でサーバ集約先がない
**ファイル:** `inbox.ts:215-227`

```ts
if (process.env.NODE_ENV !== "production") {
  console.error(`[listInboxThreads] ${incidentId}`, e);
}
return { ..., incidentId };
```

本番だと **console.error すら出ない**。Vercel/CloudWatch のログにも痕跡が残らず、ユーザが INC を持って問い合わせても突き合わせ先がない。

**修正 (最小):**
```ts
// 本番でも構造化 1 行は必ず出す
logger.error({
  incidentId,
  route: "listInboxThreads",
  orgId,
  filter,
  err: serializeError(e),
}, "inbox_query_failed");
```

`logger` がまだ無ければ `console.error(JSON.stringify({ ... }))` で構造化して Vercel Logs / Datadog で検索可能にする。INC が運用に役立つかは「サーバ側に同じ INC が刻まれているか」が全て。

### M-3. SLA 超過判定がサーバ TZ 依存 + 営業時間考慮なし
**ファイル:** `inbox.ts:11-13, 176-184`

```
SLA_HOURS = 2  // 営業時間 2h と書きつつ単純 2h 経過判定
slaBreached = isReplied && (now - lastAt > 2h)
```

問題:
- `Date.now()` はサーバ機の UTC で動くので **DB と Node のクロックドリフトに敏感** (Vercel Edge/Lambda は通常同期されているが、cold start 後の skew は実測あり)
- 「営業時間内」がコメントだけで実装されていないため、土日金曜夜の REPLIED が朝に SLA 超過バッジ満載で出る

**修正 (段階):**
1. now を SQL 側で揃える: `select now()` を一発取って `nowTs` として使い、レンダリングと判定を同じ時刻で行う。または lastAt の比較を **DB 側** (`WHERE state='REPLIED' AND last_action_at < now() - interval '2 hours'`) に持ち込んでフラグ化。
2. business-hours 判定は Phase 2 (タイムゾーンは JST 固定で `dayjs.tz('Asia/Tokyo')` などで月-金 9-18 のみカウント)。

最低でも (1) で **時計依存性を 1 か所**にまとめておく。

### M-4. q 検索の `ILIKE %x%` がインデックスを使えない
**ファイル:** `inbox.ts:88-93`

`fullName ILIKE '%xxx%'` は前方一致でも後方一致でもなく中間一致なので btree も pg_trgm GIN なしでは SeqScan。**現状の leads 件数で問題はない**が、テナント内 1M lead を超えるとサーチが秒オーダーに化ける。

**修正 (将来):**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX leads_fullname_trgm_idx ON leads USING gin (full_name gin_trgm_ops);
CREATE INDEX leads_company_trgm_idx ON leads USING gin (company gin_trgm_ops);
```
これは本リリース必須ではないが、リリースノートの「キャパシティ前提」に書いておく。

---

## LOW (任意 / 細部)

### L-1. degraded 時の counts が全部 0 → タブ数字が「読み込めなかったのか 0 件なのか」区別できない
`inbox.ts:223` で `counts: { all: 0, unread: 0, review: 0, meeting: 0 }` を返す。

UI 側 `inbox-filter-tabs.tsx:73` は `count > 0` でしか数字を出さないので、結果として **タブにバッジが消える** = ユーザは「メッセージが減った」と誤解する可能性。

軽い改善: degraded の時は `counts` を `null` にし、`InboxFilterTabs` で「—」表示にするか、`source==='degraded'` をタブにも渡して `?` 表示。

### L-2. ThreadList のクライアント側ソートが SLA 超過を必ず先頭にする
`components/inbox/inbox-thread-list.tsx:26-31`

サーバ側で `order by last_action_at desc` をしているのに、クライアントで再ソート。SLA 超過の section 分割をしているので結果は正しいが、**サーバが返した順序を信頼する**設計に統一した方が SSR/CSR 差分が出にくい。

### L-3. `lastActionAt` を fallback にしているが「メッセージなし」と「メッセージあり」の slaBreached 判定挙動が違う
`inbox.ts:179-184`: `lastAt = lastMsg?.sentAt ?? r.lastActionAt`。lastMsg がない REPLIED 行で `r.lastActionAt` (= 状態遷移時刻) で SLA 判定される。これは妥当だが、定義としてユニットテストで明示しておく。

### L-4. INC コードは表示はされるが **ワンクリックコピー** できない
`page.tsx:82-87` の `<code>` はクリックで選択可能だがコピー導線がない。サポート連絡のフリクションを 1 段減らす意味で、`button` で `navigator.clipboard.writeText(incidentId)` を 1 行入れると運用が滑らかになる (Phase 2)。

### L-5. perPage = 30 固定で UI から変更できない
意図的でも構わないが、`PAGE_MAX = 1000` の意味が perPage か page かで読み取りにくい。`PAGE_NUM_MAX` などにリネームすると安全側コメントが明確化。

---

## 90+ 到達のための必須アクション

最小修正セット:

1. **H-1**: `messages (lead_id, sent_at DESC)` 複合 index 追加 (migration 1 行) **→ +3 点**
2. **H-2**: `leads (org_id, state, last_action_at DESC)` 複合 index 追加 (migration 1 行) **→ +2 点**
3. **H-3**: `statusCounts` の役割をコードコメントで明示 (もしくは MV 化はリリースノート送り) **→ +1 点**
4. **M-2**: degraded 経路で本番でも構造化ログ出力 (1 関数追加) **→ +2 点**
5. **M-1**: INC を 8 hex に拡張 (1 行変更) **→ +1 点**

これで **86 → 95** に到達可能。H-1/H-2 の index は本番投入前に必須レベル。

---

## 採点根拠 (各観点 詳細)

### 1. パフォーマンス: 14 / 20
- (-3) H-1 messages 複合 index 不在
- (-2) H-2 leads 複合 index 不在
- (-1) H-3 count(\*) 二重実行 + `counts.all` の意味のズレ
- (+) `Promise.all` で 3 クエリ並列、leadIds 後の msgRows のみ直列で 4 RTT。これは適切設計
- (+) `safePerPage` 上限 100、`PAGE_MAX = 1000` で OFFSET 暴走を防止 (`page <= 1000` && `perPage <= 100` で OFFSET ≤ 100,000)
- (+) `escapeLikePattern` + drizzle parameter で SQL injection 面は OK
- (+) `inArray(state)` のため index OR ではなく BitmapOr / Index Cond ANY が選ばれる

### 2. エラーハンドリング: 18 / 20
- (+) try/catch で必ず InboxResult を返す (上位の Suspense / ErrorBoundary に依存しない)
- (+) `degraded` を `"live" | "mock" | "degraded"` の discriminated union で明示
- (+) `incidentId` を結果に同梱、UI 表示まで完結
- (-1) M-2 本番でログが消える経路
- (-1) ユーザ通知文 (`受信箱の取得中に問題が発生しました`) はリトライ示唆あり、技術詳細はリーク無しで適切

### 3. 観測性: 15 / 20
- (-2) M-1 INC が乱数のみ + 衝突管理なし
- (-2) M-2 サーバ集約ログなし → INC が片肺
- (-1) correlation_id がリクエスト境界 (middleware) で生成されインボックス route に伝播していない (今回スコープ外だが SRE 観点なので減点)
- (+) `lib/incident.ts` にコメント (§12.3.1 / §24) で設計準拠が明示
- (+) `source` フィールドで「live / mock / degraded」を機械可読に出せる → 監視で `source != "live"` の rate でアラートにできる

### 4. ユーザビリティ運用: 19 / 20
- (+) DEMO バッジ (mock 経路) を `role="status"` で配置
- (+) degraded を `role="alert"` で配置、INC を併記
- (+) 空状態 (`EmptyState` コンポーネント) でフィルタ切替誘導
- (+) SLA 超過は **section 分離 + 左端 3px ストリップ + アイコン + ラベル**で多重に表現 (色覚配慮)
- (+) `requiresReview` NEW バッジ vs SLA 超過の優先順位が明確 (SLA breached の方は NEW を出さない条件分岐済み `inbox-thread-list.tsx:133`)
- (-1) L-1 degraded 時にタブ数字が "0" として出てしまい誤解を生む

### 5. キャパシティ・安全: 20 / 20
- (+) `Q_MAX_LEN = 120` で query 文字列 DoS 防止
- (+) `PAGE_MAX = 1000`, `perPage` clamp(10, 100) で OFFSET 暴走防止
- (+) `state` を 5 値リテラルでサーバ側ハードコード → クライアントから不正 state 注入不可
- (+) `ALLOWED_FILTERS` で URL フィルタを Set 検証 (`page.tsx:15`)
- (+) `orgId` 必須 (`!orgId` → mock 経路) → クロステナント漏洩を構造的に防止
- (+) `force-dynamic` + `force-no-store` で CDN/ISR キャッシュ汚染なし
- (+) campaigns join に `eq(schema.campaigns.orgId, orgId)` を明示 → JOIN 時の RLS バックアップ
- 満点で問題なし

---

## 判定: **NEAR (86/100)**

- 90+ には HIGH 3 件のうち H-1 / H-2 の **migration 2 行追加が事実上必須**
- H-1/H-2 を当てれば 91 点、M-1 / M-2 追加で 94-95 点で安定 PASS
- 現状コードはロジック・UX 面は十分高品質。**index の不在 1 点で 4 点失っている**のがもったいない構図

---

## 追加: 推奨 migration (本レビューの帰結)

```sql
-- supabase/migrations/2026_05_11_s09_inbox_indexes.sql
BEGIN;

-- H-1 受信箱の「最終メッセージ」取得を index-only に
CREATE INDEX CONCURRENTLY IF NOT EXISTS msg_lead_sent_idx
  ON messages (lead_id, sent_at DESC);

-- H-2 受信箱の「テナント × inbox-states × 新着順」ページネーション
CREATE INDEX CONCURRENTLY IF NOT EXISTS leads_org_state_action_idx
  ON leads (org_id, state, last_action_at DESC NULLS LAST);

COMMIT;
```

> 注: `CREATE INDEX CONCURRENTLY` は **トランザクション外**で実行する必要があるため、Supabase MCP 経由なら `apply_migration` を 2 ファイルに分割 (BEGIN/COMMIT を外す) するか、`execute_sql` で個別実行する。
