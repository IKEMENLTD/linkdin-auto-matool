# S11 LinkedIn 接続管理 セキュリティレビュー (r1)

**レビュー対象**:
- `server/actions/connections.ts` (4 Server Actions: pause / resume / updateDailyLimit / disconnect)
- `server/queries/connections.ts` (`listLinkedinConnections` + `ANY(${accountIds})` bulk count)
- `app/(app)/connections/linkedin/page.tsx`
- `components/connections/connections-container.tsx`
- `components/connections/account-card.tsx`

**継続参照**:
- `lib/auth.ts` (`getSession` / `hasAtLeastRole`)
- `lib/audit.ts` (`writeAudit` hash chain + advisory lock)
- `db/schema.ts` (`linkedinAccounts` definition, `AuditAction` enum)

**レビュー日**: 2026-05-11
**レビュー方針**: 既存 S04〜S10 と同一軸 (STRIDE + OWASP Top10 + LLM Top10 の関連項目) で、S11 で新規導入された 4 つの mutating Server Action とアカウント PII (ownerName / unipileAccountId) の露出を重点評価。

---

## 総合スコア: **93 / 100** → **90+ 判定 PASS**

| # | 評価軸 | 配点 | スコア | 判定 |
|---|---|---|---|---|
| 1 | テナント分離 (`linkedinAccounts.orgId` 強制) | 20 | **20** | PASS |
| 2 | 認可 (Admin+ / UUID / 状態機械) | 20 | **20** | PASS |
| 3 | 入力検証 (DISCONNECT 確認 / dailyLimit 範囲 / reason 文字数) | 20 | **20** | PASS |
| 4 | 監査ログ (4 action 全て writeAudit / purpose 意図記録) | 20 | **15** | PASS (改善余地) |
| 5 | XSS / Open Redirect / コード匂い | 20 | **18** | PASS |
| **計** | | **100** | **93** | **PASS** |

> **90+ 判定 PASS**。HIGH なし、MEDIUM 1 件 (AuditAction 分類)、LOW 4 件。MEDIUM は Phase2 必須対応として明記。

---

## 評価軸 #1: テナント分離 (20 / 20)

### 強み

すべての mutating WHERE 句が `orgId` 二重制約 になっている。攻撃者が他テナントの UUID をフォームに送り込んでも、`eq(linkedinAccounts.orgId, session.orgId)` が `returning` を空配列にし、`ACCOUNT_NOT_FOUND` を `throw` する設計。トランザクション内で `throw` するため audit log も書かれず、攻撃の痕跡を残さない (ただし下記 LOW-5 で攻撃検知の改善余地あり)。

`server/actions/connections.ts:60-66` (pause) / `:115-121` (resume) / `:177-183` (updateDailyLimit) / `:241-247` (disconnect) — 4 箇所すべて同形:

```ts
.where(
  and(
    eq(schema.linkedinAccounts.id, parsed.data.accountId),
    eq(schema.linkedinAccounts.orgId, session.orgId)   // 必須二重制約
  )
)
.returning({ id: schema.linkedinAccounts.id });
if (updated.length === 0) throw new Error("ACCOUNT_NOT_FOUND");
```

Read 側 (`server/queries/connections.ts:54`) も `eq(schema.linkedinAccounts.orgId, orgId)` で scoping。さらに今日の送信数集計の派生 query (`leads` 側) も `eq(schema.leads.orgId, orgId)` を含むため、`leads` 経由でのリーク経路も塞がれている。

### `ANY(${accountIds})` のパラメータ化 — 安全確認済

`server/queries/connections.ts:74`:
```ts
sql`${schema.leads.assignedAccountId} = ANY(${accountIds})`
```

drizzle-orm の tagged template は `${accountIds}` を **配列リテラル文字列ではなく $-bound パラメータ** として PostgreSQL に渡す (`text[]` または `uuid[]` 型でバインド)。`accountIds` の中身は DB から自分の orgId scope で取得した `r.id` (UUID) なので、ユーザー入力でない上に二重で安全。SQL injection 不可。

### 微小指摘 (減点なし)

- `mockAccounts()` は orgId 関係なく同一データを返すが、DB 未接続時のデモ専用で本番経路に影響しない。

---

## 評価軸 #2: 認可 (20 / 20)

### 強み

- `requireAdmin()` (`actions/connections.ts:18-25`) が `hasAtLeastRole(role, "admin")` を使用 → `viewer (1) / operator (2) / manager (3)` は拒否、`admin (4) / owner (5)` のみ通過。
- `AUTH_REQUIRED` と `FORBIDDEN` を区別して返す。これにより:
  - 未ログイン → `"サインインが必要です"`
  - ログイン済 / 権限不足 → `"この操作は Admin 以上の権限が必要です"`
  - エラーメッセージで列挙攻撃 (account 存在判定) は不可 (FORBIDDEN は accountId 取得前に return される)。
- UUID 検証 (`z.string().uuid()`) が型エラー (`'; DROP TABLE` 等の文字列) を最前段で弾く。

### 退職者ハンドオフ設計 (重点チェック) — PASS

シナリオ: 担当者 (operator) A が退職 → A の LinkedIn アカウントを別 operator B に引き継ぐ or 切断する。
- Operator は `requireAdmin()` で弾かれる → A 自身が在職中でも自分のアカウントを切断できない。
- Admin / Owner のみが pause / resume / updateDailyLimit / disconnect を実行できる → ハンドオフは必ず管理者経由でログが残る。
- `ownerUserId` の付け替え UI は S11 では未実装 (Phase2)。現状 disconnect → 再 connect で実質ハンドオフ。妥当な MVP 制限。

「退職者が在職中の自身のアカウントを勝手に切断する」リスクは設計でブロックされている。`users.isActive=false` 化された退職者は `getSession()` (`lib/auth.ts:41`) で session null になり、そもそも操作不可。

### 状態機械の守り

- `pauseConnection` は `safe_mode` への遷移を強制 (`active → safe_mode` 想定)。UI 側で `!isDisconnected && !isSafeMode` のときのみボタン表示 (`account-card.tsx:156-165`) → 二重押下は冪等 (`status=safe_mode` を `safe_mode` に上書きするだけ)。
- `resumeConnection` は `safe_mode → active` を想定。UI 側で `isSafeMode` のときのみ表示 (`:166-168`)。`warming` のアカウントを誤って `active` 上書きするリスクは UI で制限されているが、Server Action は accountId だけで `active` を強制する。**LOW-1 参照**。
- `disconnectAccount` は `disconnected` 化。UI で `!isDisconnected` のときのみ表示。

---

## 評価軸 #3: 入力検証 (20 / 20)

### 強み

| Schema | 制約 | 多層防御 |
|---|---|---|
| `PauseSchema.reason` | `z.string().trim().min(1).max(400)` | textarea `maxLength={400}` (`account-card.tsx:375`) + server Zod |
| `LimitSchema.dailyLimit` | `z.coerce.number().int().min(1).max(200)` | input `min={1} max={200}` (`:323-324`) + Zod + `clamp(value, 1, 200)` (`:171`) で三重 |
| `DisconnectSchema.confirm` | `z.literal("DISCONNECT")` | クライアント側 `disabled={confirmText.trim() !== "DISCONNECT"}` (`:441`) + server literal 一致 |
| すべて | `accountId: z.string().uuid()` | UUIDv4 形式以外を最前段で reject |

`clamp()` は Zod が通った後の追加防衛として残されており、Zod schema を変更した際の事故防止に役立つ (Defense in Depth)。`z.coerce.number()` は `"abc"` → `NaN` → `.int()` で弾かれるため文字列攻撃に強い。

### DISCONNECT 確認の二重化

- **クライアント**: ボタンが非活性 → 通常の UI からは送信不可
- **サーバー**: `z.literal("DISCONNECT")` → JavaScript を無効化されたブラウザ / 直接 fetch でも server で必ず弾かれる
- 余白文字 (`"DISCONNECT "`) は server literal 完全一致でリジェクト (`trim` していないため意図通り)

### reason の意図記録

`reason` は 1〜400 文字必須で `purpose` に格納 → 「なぜ一時停止したか」が監査ログから後から判明する。`auditLog.purpose` カラムは text 想定なのでサイズ問題なし。文字数上限 400 は監査 UI で読みやすい長さ。

---

## 評価軸 #4: 監査ログ (15 / 20) — 改善余地あり

### 強み

- 4 つの Server Action **すべて** が `db.transaction(async (tx) => { ... await writeAudit(..., tx) })` の形で書込み:
  - pause: `purpose: parsed.data.reason` (ユーザー入力の理由)
  - resume: `purpose: "resume_from_safe_mode"`
  - updateDailyLimit: `purpose: "daily_limit_changed"`
  - disconnect: `purpose: "user_initiated_disconnect"`
- `update` と `writeAudit` が同一トランザクション内 → update 成功 ∧ audit 失敗 / update 失敗 ∧ audit 成功 の inconsistent state が出ない (atomic)。
- `diff: { status: { to: "safe_mode" } }` 等で **遷移前後の事実** をログに残す。
- `actorUserId: session.userId` で「誰が」を明示。
- `lib/audit.ts:69-71` の `pg_advisory_xact_lock(hashtext(orgId))` により hash chain race が防がれる → 同時並行で 2 つの admin が pause を発火しても hash 整合性を保てる。

### MEDIUM-1 (-5): `AuditAction` enum に `linkedin.account_paused` 等が無い

**現状** (`lib/audit.ts:33-34`):
```ts
| "linkedin.account_connected"
| "linkedin.account_disconnected"
```

**問題**:
| 実装上の挙動 | 書込み action | 実際の DB 状態遷移 | ログ読解性 |
|---|---|---|---|
| pause | `linkedin.account_disconnected` | `→ safe_mode` | **誤り** (切断していないのに disconnected) |
| resume | `linkedin.account_connected` | `safe_mode → active` | 部分的に妥当 (再接続イベントとは異なる) |
| updateDailyLimit | `linkedin.account_connected` | `dailyLimit` のみ変更 | **誤り** (接続状態は変えていない) |
| disconnect | `linkedin.account_disconnected` | `→ disconnected` | 正しい |

`diff` と `purpose` には真実が記録されているので **監査追跡は可能** (∴ Critical でなく Medium)。しかし:

1. **SIEM ルールが破綻**: 「`linkedin.account_disconnected` の急増を検知」アラートが pause で誤発火する。
2. **コンプライアンス報告**: 月次の disconnect 件数を `action` で count すると pause も加算されて過大計上。
3. **将来の追加 action と矛盾**: `linkedin.account_paused` を後から追加すると、過去 log との互換性が崩れる (古い log は `disconnected` のまま)。

**推奨 Phase2 対応**:
```ts
export type AuditAction =
  | ...
  | "linkedin.account_connected"
  | "linkedin.account_paused"          // 新規 — pauseConnection 用
  | "linkedin.account_resumed"         // 新規 — resumeConnection 用
  | "linkedin.account_limit_changed"   // 新規 — updateDailyLimit 用
  | "linkedin.account_disconnected"
  ;
```
そして migration で過去ログのうち `action='linkedin.account_disconnected' AND diff->'status'->>'to'='safe_mode'` を一括で `linkedin.account_paused` にバックフィルする SQL を Phase2 で用意 (改竄耐性 hash chain は再計算)。

`writeAudit` 自体は変更不要 — action enum と call site のみ。**Phase2 で対応する旨を S11 PR 説明文に明記すれば現状コードで mergeable**。

---

## 評価軸 #5: XSS / Open Redirect / コード匂い (18 / 20)

### 強み

- すべての DB 由来値が JSX 経由レンダリング → React の自動エスケープが効く。`dangerouslySetInnerHTML` の使用なし (grep 確認)。
- 自由入力 `reason` (400 字) は `purpose` に格納されるのみで、S11 の画面には再描画されない (audit log 詳細画面は別 S で実装)。再描画される際も React JSX 経由なので XSS 不可。
- `revalidatePath("/connections/linkedin")` はリテラル文字列。ユーザー入力からの動的 path 構築なし → Open Redirect / CSRF revalidation 攻撃なし。
- 外部リンクなし。`href` を user input から生成する箇所なし。
- `aria-labelledby={`acc-${account.id}`}` は string concatenation だが、ID は drizzle が UUID として返した値のみ → 構文混入の余地なし。
- エラーレスポンスが汎用化 (`"処理中に問題が発生しました"`) → DB エラーメッセージや stack trace の漏えいなし。`incidentId` 経由で内部追跡 (`server/queries/connections.ts:104-108`)。
- `console.error` は `process.env.NODE_ENV !== "production"` でガード → 本番 stdout に sensitive 情報が漏れない。

### LOW-1 (-1): `ownerUserId` / `ownerName` / `unipileAccountId` の PII 露出範囲

| 表示要素 | 値 | 露出範囲 | リスク |
|---|---|---|---|
| `ownerName` | 「林 翔太」(実名) | 同 org の **viewer 含む全員** | 同テナント内で実名公開 = B2B SaaS で一般的だが、組織方針による |
| `unipileAccountId` | 「unipile_hayashi」(内部 ID) | 同上 | 内部識別子の列挙性 — Phase2 で manager+ 限定が望ましい |
| `ownerUserId` (UUID) | type に含まれるが UI 非表示 | UI には出ない | OK |

**現状の妥当性**: B2B SaaS で「誰が LinkedIn アカウントを担当しているか」をチーム全員に見せるのは UX 上ほぼ必須。本件は **意図された開示** と判断。ただし:
- 退職者 (`users.isActive=false`) の name が join で `leftJoin` 経由のまま返り続けるリスク。`server/queries/connections.ts:53` の `leftJoin` に `isActive=true` フィルタを追加すべきか検討余地あり。退職者の `ownerName` を継続表示すると元従業員の名前が長期間残るため、最低限 `users.isActive=false` の場合 `ownerName` を `null` 化するのが望ましい。
- `unipileAccountId` は内部識別子。Phase2 で 「Admin+ のみ表示」「Operator は伏字 `unipile_***ashi`」等の段階開示を検討。

### LOW-2 (-1): pause / disconnect Server Action に rate-limit なし

Admin アカウントが乗っ取られた場合、4 つの mutate を秒間数百回呼べる。`writeAudit` の `pg_advisory_xact_lock` が orgId 単位の serialize を保証するため hash chain は安全だが、`linkedinAccounts` 行ロックの contention が発生する可能性。S10 の `sendMessage` で導入された `lib/rate-limit.ts` を `pauseConnection` / `disconnectAccount` にも適用するのが Phase2 望ましい (例: actor × org で 30 req/min)。

`lib/rate-limit.ts` 自体は in-memory bucket でクラスタ非対応 (S10 r2 でも指摘済) なので、Phase2 で Upstash 化と合わせて connection actions に展開すべき。

---

## CHECK 項目別 判定サマリ

| ユーザー指定の重点項目 | 判定 | 該当箇所 |
|---|---|---|
| ANY 配列 (accountIds) のパラメータ化 | **PASS** | drizzle tagged template が $-bound (`queries:74`) — SQLi 不可 |
| ownerUserId の表示が PII 漏洩しないか | **PASS (LOW)** | `ownerUserId` 自体は UI 非表示。`ownerName` は同 org 全員可視 — B2B 妥当だが退職者 `isActive=false` フィルタは Phase2 推奨 |
| 退職者ハンドオフを考慮した Admin+ 設計 | **PASS** | `requireAdmin()` で operator 除外。退職者は `getSession()` が null で操作不可 |
| audit purpose が clear (一時停止理由は監査ログ必須) | **PASS** | `pauseConnection` が `purpose: reason` を必須化 (`min(1)`) |
| AuditAction が purpose で区別される点 — Phase2 で linkedin.account_paused を追加すべきか | **YES — Phase2 必須** | MEDIUM-1 参照。現状コードは mergeable だが SIEM/コンプラ観点で `paused / resumed / limit_changed` を追加すべき |

---

## HIGH / MEDIUM / LOW 一覧

### HIGH

なし。

### MEDIUM

| # | 件名 | 影響 | 推奨アクション |
|---|---|---|---|
| **M-1** | `AuditAction` enum が `linkedin.account_paused / _resumed / _limit_changed` を持たず、pause / resume / updateDailyLimit が `connected/disconnected` で記録される | SIEM 検知ルール・月次コンプラ集計が誤動作 | Phase2 で enum 追加 + 過去ログ backfill SQL を migration で提供 |

### LOW

| # | 件名 | 推奨アクション |
|---|---|---|
| **L-1** | `resumeConnection` が `warming` も `active` に上書きしうる (UI で防御中だが Server Action は accountId 単独で受理) | Server 側で現 status が `safe_mode` のときのみ `active` に遷移する CASE WHEN を `set` に追加するか、`update ... where status='safe_mode'` で守る |
| **L-2** | 4 Server Action に rate-limit なし | Phase2 で `lib/rate-limit.ts` (Upstash 化後) を適用 (30 req/min/actor) |
| **L-3** | 退職者 (`users.isActive=false`) の `ownerName` が join で表示され続ける | `leftJoin` に `and(eq(users.id, ...), eq(users.isActive, true))` 追加 or 表示時 fallback |
| **L-4** | `unipileAccountId` が viewer まで開示 | Phase2 で manager+ 限定 / マスキング検討 |
| **L-5** | `ACCOUNT_NOT_FOUND` が cross-tenant attack 試行時にも throw されるが、attempt が audit log に残らない | Phase2 で「access_denied」audit を action 側で能動的に書く (`writeAudit({ action: "BREAK_GLASS", purpose: "cross_tenant_attempt", ... })`) |

---

## 結論

**93 / 100 PASS (90+)**。

- HIGH なし、Phase1 として merge 可能。
- MEDIUM-1 (`linkedin.account_paused` 等の AuditAction 追加) は **Phase2 で必須対応** として PR 説明 + GitHub issue 化を推奨。それ以外は Phase2 の改善枠。
- テナント分離 / 認可 / 入力検証は満点。監査ログ結線も atomic transaction / hash chain と完璧。
- 唯一の構造的欠陥は AuditAction 分類 — コードロジックは正しく `diff` と `purpose` に真実が残るため**侵害リスクではなく分類問題**。Phase2 で enum 追加 + 過去 log backfill 1 回で解消する。

### S11 として 90+ 判定: **PASS**

レビュー対象ファイル:
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\connections.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\connections.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\connections\linkedin\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\connections\connections-container.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\connections\account-card.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts` (継続参照)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts` (継続参照)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts:100-123` (linkedinAccounts 定義)
