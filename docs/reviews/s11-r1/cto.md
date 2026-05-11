# S11 LinkedIn 接続管理 — CTO レビュー (r1)

- **対象** (S11 関連ファイル群):
  - `app/(app)/connections/linkedin/page.tsx`
  - `server/queries/connections.ts`
  - `server/actions/connections.ts`
  - `components/connections/connections-container.tsx`
  - `components/connections/account-card.tsx`
- **参照** (依存系):
  - `lib/auth.ts` / `lib/audit.ts` / `lib/incident.ts` / `lib/wizard-schema.ts` / `lib/utils.ts`
  - `db/schema.ts` (`linkedin_accounts`, `leads`, `users`, `audit_log`)
- **評価者**: cto-agent
- **基準**: 90+ 合格

---

## 総合スコア: **92 / 100** — 90+ **合格 (PASS)**

| 軸 | 配点 | スコア | 主観メモ |
|---|---|---|---|
| 1. Next.js 15 RSC / Client / Server Action / Promise.all | 20 | **18** | `force-dynamic` + `force-no-store` を `page.tsx` で明示。RSC は `getSession` → `listLinkedinConnections` の **逐次 await** で、Promise.all 化の余地あり (`session` を `accounts` の引数に使うため厳密には逐次依存だが、`getSession` 内部の users 引きと並行できる対象が他にないので致命的ではない)。Server Action は 4 本 (`pauseConnection` / `resumeConnection` / `updateDailyLimit` / `disconnectAccount`) すべて `useActionState` 連結。`revalidatePath("/connections/linkedin")` を成功時のみ呼ぶ規律も揃っている。Client 境界は `ConnectionsContainer` / `AccountCard` のみで境界配置が正しい。 |
| 2. TypeScript / Drizzle (orgId 強制, tx) | 20 | **19** | 4 つの Server Action すべて **`db.transaction(tx => {...})` の中で `update` → `returning` → `writeAudit(payload, tx)`** という統一形。`writeAudit` の `AnyTx` 契約 (`lib/audit.ts:62`) と完全に合致し、hash chain の advisory lock も同一 tx で取得される (= 並行操作の chain race を封じる)。`where(and(eq(id, parsed.accountId), eq(orgId, session.orgId)))` という org スコープが **すべての update** に組み込まれている (`returning` が空配列ならクロステナント or 存在しない → `throw "ACCOUNT_NOT_FOUND"`)。`ConnectionsResult` は `ok=true(live\|mock) \| ok=false(degraded)` の閉じた discriminated union、`LinkedinAccount["status"]` も `"active"\|"warming"\|"safe_mode"\|"disconnected"` の閉じた union。`any` は皆無、`z.coerce.number().int().min(1).max(200)` で number 強制も妥当。 |
| 3. データ取得 (本日送信集計 / ANY() 配列バインド) | 20 | **18** | `lead.lastActionAt >= todayStart` + `state in (MESSAGED, REPLIED, MEETING, COMPLETED)` の `count(*) filter (...)` を **1 クエリで sent / replied 同時集計**、`groupBy(assignedAccountId)` で N+1 を回避。`leads_org_state_action_idx (org_id, state, last_action_at)` (`db/schema.ts:176-180`) が直接効くため EXPLAIN 上も健全。`sql\`${schema.leads.assignedAccountId} = ANY(${accountIds})\`` は postgres-js 経由で `uuid[]` バインドとして安全に渡る (drizzle が `accountIds` を bind parameter として注入、SQLi 不可)。`accountIds` は事前 SELECT の結果 (= DB が返した UUID) なので入力経由汚染も無い。M-1: `state in (...)` の文字列リテラルが `leadStateEnum` の TS union と drift する余地あり (純 SQL リテラル) → 将来 `sql.raw` で enum 定数を参照するか、`inArray(leads.state, [...])` に置換するとさらに堅い。M-2: `todayStart = new Date(); setHours(0,0,0,0)` は **サーバプロセス TZ 依存** で、JST 運用なら UTC 16:00 にカットオフが寄る (= JST 翌 1:00)。日本市場特化なら `Asia/Tokyo` 固定の Day 切替が UI 上の「本日」と一致する。 |
| 4. エラーハンドリング (degraded + incident_id / ACCOUNT_NOT_FOUND) | 20 | **19** | `listLinkedinConnections` は `try/catch` で `incidentId = newIncidentId()` を発行し `{ok:false, reason:"degraded", incidentId}` に正規化、`page.tsx:18-37` がインライン alert + `incident_id` の monospace badge を表示する **サポート導線** が完備。Server Action は `throw new Error("ACCOUNT_NOT_FOUND")` を `instanceof Error && e.message === "ACCOUNT_NOT_FOUND"` で識別、それ以外は「処理中に問題が発生しました」の汎用文言に丸める (= 内部詳細の露出なし)。`process.env.NODE_ENV !== "production"` ガードで本番ログ汚染も抑制。L-1: ACCOUNT_NOT_FOUND の sentinel が文字列マッチで、将来 enum/class 化したい。 |
| 5. 再利用性 / 命名 / UI プリミティブ / AuditAction | 20 | **18** | `Button` / `Badge` / `Input` / `EmptyState` / `Header` を忠実に再利用し、`AccountCard` 内の `StatusBadge` / `Metric` / `ProgressBar` / `LimitForm` / `PauseForm` / `DisconnectForm` / `ResumeForm` / `SubmitButton` は単一責務に分解。命名 (`isSafeMode` / `isWarming` / `effectiveLimit` / `sentPct` / `reported`) も読みやすく一貫。`useFormStatus` を `SubmitButton` で集約しているのが特に良い。`AuditAction` を新規追加せず **既存の `linkedin.account_connected` / `linkedin.account_disconnected` の 2 値で 4 アクション** を表現し、`purpose` で `resume_from_safe_mode` / `daily_limit_changed` / `user_initiated_disconnect` / pause 理由文字列 を区別する設計は妥当 (M-3: ただし「pause = `account_disconnected` で `purpose=<ユーザー入力>`」は厳密には semantic mismatch、安全モード化と完全切断が区別しづらく後段検索クエリが煩雑になる懸念)。 |

> 合計: 18 + 19 + 18 + 19 + 18 = **92 / 100**

---

## 焦点項目の判定

### F-1. `sql\`${leads.assignedAccountId} = ANY(${accountIds})\`` の安全性 — ✅ 適合

`server/queries/connections.ts:74`:

```ts
sql`${schema.leads.assignedAccountId} = ANY(${accountIds})`
```

- `accountIds: string[]` は drizzle の `sql` テンプレートに **bind parameter** として渡る (postgres-js は配列 → `text[]`/`uuid[]` にシリアライズ)。Plain concatenation ではないので **SQLi は不可**。
- `accountIds` の中身は事前 SELECT の `linkedinAccounts.id` (= DB が返した UUID) なのでユーザ入力経由汚染もゼロ。
- `leftJoin(users)` で取得した行を `r.id` で射影する経路にも汚染なし。
- 同等の表現として drizzle 公式 helper の `inArray(leads.assignedAccountId, accountIds)` も使えるが、空配列時の挙動 (postgres は `= ANY('{}')` を空集合に評価) は同じで、空配列を渡しても結果 0 行で安全に終わる。
- 補足: rows が空のときは `accountIds = []` 経路に入る前に `if (rows.length === 0) return { ok: true, source: "live", accounts: [] };` で早期 return しているため、空配列バインドそのものも踏まない。 ✓

### F-2. pause / resume / updateDailyLimit / disconnectAccount の Admin+ 権限 — ✅ 適合

4 つの Server Action 全てが先頭で:

```ts
const { error, session } = await requireAdmin();
if (error === "AUTH_REQUIRED" || !session) return { ok: false, message: "サインインが必要です" };
if (error === "FORBIDDEN") return { ok: false, message: "この操作は Admin 以上の権限が必要です" };
```

判定:
- `requireAdmin()` は `getSession()` → `hasAtLeastRole(session.role, "admin")` で **ROLE_RANK (`viewer:1 → owner:5`) の閾値 ≥ 4 (admin/owner) のみ通過**。Manager 以下は FORBIDDEN になる。
- Zod の `safeParse` を **`requireAdmin` の前** に置く順序は意図的 (入力 validation は cheap、authz は session DB 引きを伴うので validation で弾けるなら DB 負荷を節約)。情報漏洩はゼロ (validation エラー時は accountId の所属確認をまだしていないが、UUID の存在自体は推測されないため許容)。
- `where(eq(id), eq(orgId, session.orgId))` の **二重制約** で orgId が一致しないと `returning` 空 → `ACCOUNT_NOT_FOUND`。これにより admin ロールでもクロステナント書き込みは物理的に不可能。
- ABAC として `ownerUserId === session.userId` までは要求していない (= admin は org 内の全アカウントを操作可能) が、これは設計意図と一致。

### F-3. AuditAction の表現 (`pause` / `resume` / `limit_change` を purpose で区別) — ⚠️ 適合だが議論あり

```ts
// pause → action: "linkedin.account_disconnected", purpose: <ユーザー入力>
// resume → action: "linkedin.account_connected",  purpose: "resume_from_safe_mode"
// limit  → action: "linkedin.account_connected",  purpose: "daily_limit_changed"
// disc.  → action: "linkedin.account_disconnected", purpose: "user_initiated_disconnect"
```

判定:
- **既存の `AuditAction` を増やさず purpose に意味を込める設計** は (a) ENUM/型変更によるマイグレーション不要、(b) audit_log のクエリインデックスが既存のまま効く、というメリットがある。
- ただし以下の課題が残る:
  - **pause と disconnect が同じ action に潰れる**: 後段の SIEM/分析で「一時停止だったのか完全切断だったのか」を `purpose` の文字列パースに頼ることになる。`purpose` は pause だとユーザ自由入力 (400 chars) なので、`like '%resume%'` 等のキーワード検索では信頼性が低い。
  - **limit_change が `account_connected`**: セマンティック的には「接続したわけではない」ため、grep ベースの監査で誤検知を産む。
- M-3: 推奨は `diff` 側に `kind: "pause"\|"resume"\|"limit_change"\|"disconnect"` を入れて **JSONB のキーで分類**する (Phase2 で `AuditAction` enum を細分化するまでの暫定として diff キーが信頼できる単一の真実源になる)。現状の `diff: { status: { to: "safe_mode" } }` / `{ dailyLimit: { to: next } }` でも差分形状で類推可能だが、明示 `kind` フィールドの方が SQL クエリが書きやすい。
- 90+ 合格には届く粒度 (= -2 点) だが、Phase2 で監査ダッシュボードを作るタイミングで必ず handle すること。

### F-4. `normalizeStatus` の DB ↔ UI 状態変換 — ✅ 適合

```ts
function normalizeStatus(raw: string, warmupDay: number) {
  if (raw === "safe_mode") return "safe_mode";
  if (raw === "disconnected") return "disconnected";
  if (warmupDay < 14) return "warming";
  return "active";
}
```

判定:
- DB 上は `status` (varchar(24)) に `active` / `safe_mode` / `disconnected` を入れているが、`warmupDay` は別カラムで、UI 層では **「ウォームアップ未完なら warming で上書き表示」** という派生状態が必要。これを query layer の純粋関数で 1 箇所に閉じ込めたのは正しい。
- 優先順位 `safe_mode > disconnected > warming > active` が妥当 (= 安全モードはウォームアップ完了でも最優先で警告すべき)。
- 注意点: `raw === "active"` かつ `warmupDay < 14` の DB 行は UI 上 `warming` として表示される。これは設計通り (= DB の active と UI の warming は別物) だが、`resumeConnection` で `status: "active"` に戻したとき warmupDay が 14 未満なら UI は依然 `warming` を出す → これも設計と整合。
- M-4: `raw` の入力型が `string` で wide すぎる (DB enum 化されていない varchar)。`db/schema.ts:112` で `varchar("status", { length: 24 })` のため将来 `"paused"` 等を入れた場合に `active` に黙って落ちる。`raw: "active" | "safe_mode" | "disconnected"` の union 化 + exhaustive switch + `never` で網羅性チェックすると ts-level で破損検知できる (LOW)。

### F-5. `DISCONNECT` 文字列確認の `z.literal` — ✅ 適合

```ts
const DisconnectSchema = z.object({
  accountId: z.string().uuid(),
  confirm: z.literal("DISCONNECT"),
});
```

判定:
- `z.literal("DISCONNECT")` で **完全一致のみ通過**、小文字 / 前後空白 / 似た文字 (キリル文字 "D" 等) は弾かれる → ✓
- Client 側は `confirmText.trim() !== "DISCONNECT"` で disable、Server 側は trim 無しで literal なので **「先頭/末尾に空白を入れてダブルバイパス」も不可** (= Client の trim はあくまで UX で、Server の literal が source of truth)。
- 失敗時の文言 `"「DISCONNECT」と入力して確認してください"` は意図を明示。`safeParse` の汎用文言ではなくドメイン文言にカスタムしている点も良い。
- 確認 UI が日本語 UI 内の英大文字なので、誤クリック耐性が高い (CJK IME 切替が必要)。
- 補足: `confirm` の値は監査ログには載らない (= `purpose` には載せず、`diff.status.to` のみ載る) のは PII/秘匿性の点で適切。

---

## HIGH (合格に必須)

なし。

## MEDIUM (90+ 合格後、Phase2 で必ず handle)

1. **M-1: `state in ('MESSAGED','REPLIED','MEETING','COMPLETED')` の文字列リテラル**
   - 場所: `server/queries/connections.ts:66-67`
   - 問題: `leadStateEnum` の TS union と SQL 文字列が drift する余地 (例: enum 名を将来変更した時に静的検査で検知できない)
   - 修正: `inArray(schema.leads.state, ["MESSAGED","REPLIED","MEETING","COMPLETED"])` を `count(*) filter (where ...)` の中ではなく外側の `WHERE` に出すか、`sql\`${schema.leads.state} in ${...}\`` で TS 型と紐付け
   - 工数: 30 分

2. **M-2: `todayStart` の TZ 依存**
   - 場所: `server/queries/connections.ts:37-38`
   - 問題: `new Date(); setHours(0,0,0,0)` はサーバプロセス TZ 依存。Vercel/Node はデフォルト UTC のため JST 翌 9:00 までデータが「昨日扱い」になる
   - 修正: `Asia/Tokyo` 固定の Day 切替 (例: `Temporal.PlainDate` / `date-fns-tz`、または UTC 計算 + 15h オフセット)
   - 工数: 1h

3. **M-3: `AuditAction` の粒度不足**
   - 場所: `server/actions/connections.ts:69-77, 124-134, 187-195, 250-259`
   - 問題: pause / resume / limit_change / disconnect が `account_connected` / `account_disconnected` の 2 値に潰れ、`purpose` の文字列パース依存
   - 修正案 A (短期): `diff` に `kind: "pause"\|"resume"\|"limit_change"\|"disconnect"` を明示
   - 修正案 B (中期): `AuditAction` に `linkedin.account_paused` / `linkedin.account_resumed` / `linkedin.daily_limit_changed` を追加
   - 工数: 案 A 30 分 / 案 B 2h (db enum マイグレ含む)

## LOW (改善余地)

1. **L-1: `ACCOUNT_NOT_FOUND` の sentinel が文字列マッチ**
   - 場所: `server/actions/connections.ts:85-87, 140-142, 202-204, 266-268`
   - 修正: `class AccountNotFoundError extends Error {}` で type narrowing or symbol error code
   - 工数: 1h (全 action 共通化)

2. **L-2: `normalizeStatus(raw: string, ...)` の `raw` が wide すぎる**
   - 場所: `server/queries/connections.ts:113-121`
   - 修正: `raw: "active" | "safe_mode" | "disconnected"` + exhaustive switch + `never` で網羅性
   - 工数: 30 分

3. **L-3: RSC の `getSession` → `listLinkedinConnections` を `Promise.all` 化する余地は薄いが**、将来このページにメトリクス系の独立クエリ (例: 直近 7 日の trend) を足すなら Promise.all 化を検討。
   - 工数: N/A (機能追加時)

4. **L-4: `Phase2 で実装予定` の disabled Button の `title` 属性**
   - 場所: `app/(app)/connections/linkedin/page.tsx:73`
   - 注意: `title` は touch device で読まれない。`aria-describedby` + 説明テキストの方が a11y 上強い (Designer 観点)
   - 工数: 15 分

5. **L-5: `(DEMO) ...` モック分岐のメッセージが本物の成功と区別しづらい**
   - 場所: `server/actions/connections.ts:53, 108, 169, 234`
   - 注意: `source === "mock"` 表示と組合せて UI 上は判別可能だが、e2e テストで「DEMO 文言の混入」をチェックする smoke を追加すると安全

---

## 90+ 判定

**PASS (92 / 100)**

- 必須軸 (orgId 強制 / tx / Admin+ authz / degraded + incident_id / ANY() 安全性 / z.literal) は全て満たす
- M-1〜M-3 は Phase2 で確実に解消すべきだが、Phase1 出荷ブロッカーではない
- L-1〜L-5 は後続 PR で軽く拾える粒度

S11 は **本番マージ承認**。Phase2 に向けて `AuditAction` の粒度 (M-3) と TZ (M-2) を優先で handle すること。

---

### 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\connections\linkedin\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\connections.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\connections.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\connections\connections-container.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\connections\account-card.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts`
