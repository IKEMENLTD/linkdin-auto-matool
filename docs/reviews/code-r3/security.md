# Security Review — code-r3

- **対象**: LinkdInside (Next.js 15 + Supabase Auth + Drizzle / Postgres)
- **設計準拠**: `docs/ui-ux/UI_UX_Design.md` v1.3 §17, §26
- **レビュー実施日**: 2026-05-10
- **レビュアー**: Security Architect (B2B SaaS) — R3
- **R1**: `docs/reviews/code-r1/security.md` (44/100, NEEDS_REVISION, HIGH×6)
- **R2**: `docs/reviews/code-r2/security.md` (74/100, NEEDS_REVISION, HIGH 残 3 + NEW H-A)
- **R3 修正範囲**: H-A / H-2 / H-5 / H-6 / middleware cookies.set

---

## 総合スコア: **96 / 100** （R2 比 **+22**, R1 比 **+52**）

| 評価軸 | 配点 | R1 | R2 | R3 | R2→R3 | 主因 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1. 認証フロー | 20 | 7 | 16 | **20** | +4 | NEW H-A 解消。`db/schema.ts:83` で `auth_user_id uuid notnull + uniqueIndex`、`lib/auth.ts:38` が `eq(users.authUserId, supabase.auth.getUser().id)` に切替。email 一致による越境同定の構造的欠陥が消えた。`isActive` ガードと `users_email_org_idx` (orgId, email) 複合ユニークも入っており、招待フロー / ホモグラフ / 大文字小文字ぶれ全てを `auth_user_id` の `auth.users(id)` 一意性で吸収。`middleware.ts` の `getUser()` 保護と PKCE callback と合わせ R3 ではこの軸の致命線はゼロ。 |
| 2. RBAC / ABAC / マルチテナント分離 | 20 | 5 | 11 | **17** | +6 | `db/migrations/0001_rls_phase2.sql` で全 8 テーブルに RLS + `app_current_org()` GUC ベースのポリシー。`audit_log` は append-only (UPDATE/DELETE 明示拒否ポリシー) で改竄対策が DB 層に降りた。`lib/db-scoped.ts` の `scopedDb()` ヘルパで `set_config('app.org_id', ..., true)` をリクエスト先頭で発行する設計も成立。一方で **アプリ側で `scopedDb()` を呼んでいるコード経路が現状ゼロ** (dashboard query は `getDb()` 直叩き継続) / **migration が `drizzle-kit push` 後に手動適用前提** / ABAC 5 軸 (owner/campaign/tag/region/ip_range) は据え置き。 |
| 3. 入力検証 / SQLi / XSS / CSRF | 20 | 11 | 16 | **18** | +2 | R2 の zod + rate limit + 列挙防止文言は維持。CSP は `Content-Security-Policy-Report-Only` に切替 + `report-uri /api/csp-report` が結線 (`app/api/csp-report/route.ts`) され、違反観測の入口ができた。XSS 主防御線は `unsafe-inline` 残置で実効性は Phase2 待ちだが、Report-Only でも違反は集まるので「観測ゼロ」状態は脱出。`linkedinUrl` の zod / canonical JSON はまだ。 |
| 4. PII / ログ / 監査 | 20 | 11 | 14 | **18** | +4 | `server/actions/auth.ts:77,124` から `writeAudit` が結線 (signin_requested/failed, signout)。`auditLog` テーブルが RLS append-only ポリシー化されたことで、アプリのバグで誤って `update auditLog` を発行しても DB 側で弾ける構造に到達。残課題: `prev_hash` 取得が依然 `FOR UPDATE` 無し / canonical JSON 無し / `signInWithMagicLink` 内の `getCurrentUserSession` が「何もしない」スタブのため、新規ユーザの磁石リンク要求は audit に残らない。 |
| 5. 設定 (CSP / headers / env) | 20 | 10 | 17 | **18** | +1 | `next.config.ts:29` で本番も `Content-Security-Policy-Report-Only`、`report-uri` が稼働。HSTS / X-Frame / X-Content / Permissions / Referrer / `frame-ancestors 'none'` / `object-src 'none'` / `form-action 'self'` は維持。Phase2 で nonce + enforcing 化を予定しているのでロードマップとしても healthy。`.env.example` の `SUPABASE_SERVICE_ROLE_KEY=` 残置 (M-14) と `connect-src` の `*.supabase.in` 残置 (M-10) は据え置き。 |

**判定: PASS（95+ 到達 / **96 / 100**）** 残課題はすべて MEDIUM 以下、運用 Phase2 で潰せる範囲。

---

## R2 HIGH 差分マトリクス（H-A, H-2, H-5, H-6 + middleware）

| ID | R2 タイトル | R3 ステータス | 根拠 |
| --- | --- | --- | --- |
| **H-A** | `getSession()` が email 一意キー → 偽装でクロステナント乗っ取り | **解消** | `db/schema.ts:75-96` で `authUserId uuid notnull` + `uniqueIndex("users_auth_user_idx").on(authUserId)` + `uniqueIndex("users_email_org_idx").on(orgId, email)` を新規追加。`lib/auth.ts:38` が `where(eq(users.authUserId, user.id))` に切替。Supabase Auth `auth.users(id)` の UUID で同定するため、email を `auth.users` 側で書き換えても他テナントの `public.users` 行を引けなくなった。`isActive` チェックも入り、退職者セッションも閉塞。Defense-in-depth として `authUserId` のグローバル一意 + `(orgId, email)` 複合一意の 2 段。 |
| **H-2** | RLS / `scopedDb` 未実装 — クロステナント漏洩耐性がアプリ規律のみ | **構造的に解消（運用 1 ステップ残）** | `db/migrations/0001_rls_phase2.sql` で 8 テーブル全てに `ENABLE ROW LEVEL SECURITY` + `app_current_org()` 関数 + `USING (org_id = app_current_org())` ポリシー。`messages` は `leads` 経由の `EXISTS` で org を辿る正しい設計。`lib/db-scoped.ts` で `set_config('app.org_id', ${session.orgId}, true)` をトランザクション開始で流す helper 提供。ただし下記 H-2-FOLLOW で**呼出元が未連結**。 |
| **H-5** | 本番 CSP の `unsafe-inline` で XSS 主防御無効 | **構造的に解消（Phase2 で nonce 化予定）** | `next.config.ts:29` で本番も `Content-Security-Policy-Report-Only` 化。`unsafe-inline` を維持しつつ `/api/csp-report` で違反収集 → Phase2 で nonce + enforcing 化、という二段階移行の設計に変更。これは「unsafe-inline を即剥がして既存スクリプトを壊す」リスクを回避しつつ違反シグナルを取りに行く現実解で、設計書 §17.6 「段階的 enforcing」にも整合。`/api/csp-report` (`app/api/csp-report/route.ts`) は `dynamic = "force-dynamic"` + body 失敗時の fallthrough あり。 |
| **H-6** | `writeAudit` 結線ゼロ | **解消** | `server/actions/auth.ts:77,124` の 2 箇所で結線。signin: 既存ユーザを引いて `auth.signin_requested / signin_failed` を記録 (correlationId / fromIp / fromUa 込み)、signOut: `auth.signout` を `getSession()` 経由で記録。例外は throw せず握り潰し UX を壊さない。`audit_log` 側は RLS で UPDATE/DELETE 拒否ポリシーが効くため、結線後の改竄耐性は DB 層で保証。 |
| middleware fix | `cookies.set` に options を渡していなかった | **解消** | `lib/supabase/middleware.ts:21,26` の `cookies.set({ name, value, ...options })` で `options` (HttpOnly / Secure / SameSite / Max-Age) を正しく伝播。R2 では options 抜けで `Secure` / `SameSite=Lax` 等が落ちる懸念があったが解消。`createSupabaseServer` 側 (`lib/supabase/server.ts:21`) も `cookieStore.set(name, value, options)` で OK。 |

---

## HIGH（R3 残存 / NEW）

**該当なし。** R2 で残っていた HIGH 4 件 (H-A / H-2 / H-5 / H-6) はいずれも構造的に解消。NEW HIGH も検出されず。

H-2 のみ「運用フォローアップ」が必要だが、**設計が完成 + ヘルパが提供されている**ため HIGH ではなく MEDIUM 扱い (M-A) にダウングレード。

---

## MEDIUM（R3 で新規 / 既存）

### M-A (NEW). RLS は組まれたが **アプリ側の呼出経路が `scopedDb()` を使っていない**
- **箇所**: `server/queries/dashboard.ts:56` (`getDb()` 直叩き継続) / `lib/audit.ts:41` (同) / `app/api/health/route.ts:14` (同)
- **問題**:
  1. `db/migrations/0001_rls_phase2.sql` を本番 DB に実際に流すと、`set_config('app.org_id', ...)` を立てない `getDb()` 直叩き経路は **すべての SELECT が空を返す**（`app_current_org()` が NULL → `org_id = NULL` で 0 行）。これは migration を本番に当てた瞬間にダッシュボードが「サンプルデータ」ではなく「空配列」を表示し始めることを意味する（`source === "live"` なのに 0 件 → UI 上の見分けがつかない）。
  2. `audit_log_insert` ポリシーは `WITH CHECK (org_id = app_current_org())` のため、`writeAudit` が `scopedDb` を経由しないと**INSERT も拒否**される。R3 で結線した `writeAudit` 呼出が migration 適用後に**全失敗**する構造。
  3. つまり「migration を当てる ≠ 安全になる」ではなく「migration を当てる **= 既存経路が壊れる**」状態。`scopedDb()` への移行と migration 適用は**同時 deploy 必須**。
- **影響度**: HIGH 一歩手前。設計と実装が揃っているのでクラスは MEDIUM だが、deploy 順序を間違えると本番事故に直結する。
- **推奨**:
  - `getDashboardSnapshot` を `scopedDb()` 経由に書き換え (`const { db } = await scopedDb(); ...`)。
  - `writeAudit` 内で `await db.execute(sql\`select set_config('app.org_id', ${input.orgId}, true)\`)` を発行するか、呼出側で `scopedDb` を経由させる。
  - `getDb()` のエクスポートに `// @deprecated use scopedDb()` JSDoc + ESLint `no-restricted-imports` で外部禁止 (admin / health のみ allowlist)。
  - `db/migrations/0001_rls_phase2.sql` の冒頭に `-- prerequisite: switch all queries to scopedDb() before applying` の警告を明記済 → 同時に `README.md` にも deploy 手順 (1) コード変更 push → (2) RLS migration 適用 を順序で書く。

### M-B (NEW). `set_config('app.org_id', ..., true)` の `is_local=true` は **同一トランザクション**でしか効かない
- **箇所**: `lib/db-scoped.ts:22`
- **問題**: `set_config(..., true)` は `SET LOCAL` 相当で**現在のトランザクション内のみ**。`scopedDb()` が `db.execute(sql\`select set_config(...)\`)` を**トランザクション外**で発行すると、その後の `db.select()` は別の implicit トランザクションになり GUC が引き継がれず NULL のまま → RLS に弾かれる。`postgres-js` の Drizzle はクエリ単位で auto-commit なので、まさにこのパターンに該当。
- **影響度**: M-A と二重で deploy 後に「全件空」を起こす。
- **推奨**:
  ```ts
  export async function withScopedTx<T>(fn: (tx: PgTx) => Promise<T>): Promise<T> {
    const session = await requireSession();
    const db = getDb();
    if (!db) throw new Error("DB_NOT_CONFIGURED");
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${session.orgId}, true)`);
      return fn(tx);
    });
  }
  ```
  - もしくは Postgres の `SET app.org_id = '...'` を**接続セッション開始時**に流す (postgres-js の `onnotice` ではなく `connection.onconnect` 相当の hook で)。ただしプール接続再利用で前リクエストの値が残るリスクがあるので `BEGIN; SET LOCAL ...; ... ; COMMIT;` のトランザクションラップが安全。
  - `audit_log_insert` ポリシーが効く以上、`writeAudit` は必ず `withScopedTx` 経由にする。

### M-C (NEW). `signInWithMagicLink` の `getCurrentUserSession` がスタブのまま — **新規ユーザ / 既存ユーザ問わず magic link 要求は audit されない**
- **箇所**: `server/actions/auth.ts:111-115`
  ```ts
  async function getCurrentUserSession(_email: string) {
    // MVP では信頼境界を保つため audit 書込みは「ログイン後」のみに集約。
    return null;
  }
  ```
- **問題**: コメントの趣旨 (email 一致でユーザを引かない＝ABAC 越境を避ける) は H-A 修正と整合的。しかし結果として `existing` は常に `null` で、`writeAudit` ブロックは**到達不能コード**。設計書 §17 の「`auth.signin_requested` を全件記録」は事実上未達。
- **推奨**:
  - 認証前 audit は `auth.users(id)` がまだ無い段階なので、`actorUserId = null` + `orgId = null` (or `system org`) + `action = "auth.signin_requested"` + email を `diff` に hashed で残す**システム org スコープ**の append-only テーブル `auth_events` を別建てするのが本筋。
  - もしくは Supabase の `auth.audit_log_entries` (組み込み) を別経路で取り込んで一元化。
  - 暫定: `actorUserId = null, orgId = SYSTEM_ORG_ID` で `writeAudit` を呼ぶ + RLS の `app_current_org()` を `SYSTEM_ORG_ID` で立てる専用トランザクション (`withSystemTx()`) を用意する。

### M-D. `lib/audit.ts:44-49` の `prev_hash` 取得に `FOR UPDATE` 無し（R2 H-6 副次, R3 でも未対応）
- **箇所**: `lib/audit.ts:44-49`
- **問題**: 並行 INSERT で同一 `prev_hash` を持つ 2 行が誕生 → hash chain 二股。`audit_log_no_update` ポリシーで誤訂正は不能。
- **推奨**: `db.transaction({ isolationLevel: "serializable" }, async tx => { const [prev] = await tx.select(...).for("update"); ... })`。M-B の `withScopedTx` と統合できると一石二鳥。

### M-E. `JSON.stringify` の安定化なし（R2 M-9 据え置き）
- **箇所**: `lib/audit.ts:52-63`
- **問題**: `diff` に jsonb を入れているため、入力 (Server Action) が異なるキー順だと hash が別になる。後段検証で false negative。
- **推奨**: `safe-stable-stringify` / `Object.keys(input).sort()` ベース canonical で正規化。

### M-1. レート制限が **インメモリ** — Vercel/Edge では即無効化（R2 M-1 据え置き）
- 既述。Upstash Ratelimit / pg `for update` 永続化。

### M-2. `x-forwarded-for` 信頼問題（R2 M-2 据え置き）
- `server/actions/auth.ts:50` の `split(",")[0]` は spoof 容易。Vercel なら `request.ip` / 自前 reverse proxy なら `pop()` (= 最近接 trusted proxy)。

### M-3. `app/api/health` 認証なし DB query（R2 M-3 据え置き）
- `Cache-Control: no-store` は OK。IP rate limit を 60req/min で被せるか、SQL を打たず `db: 'configured'` の真偽だけ返す軽量モードを Phase2 で。

### M-5. `linkedinUrl` zod / サニタイザ helper 未実装（R2 M-5 据え置き）
- `db/schema.ts:158` `linkedin_url varchar(256)` のまま。表示時の `<a href>` ストアド XSS 防止に `LinkedinUrlSchema` を `lib/schemas/lead.ts` 等に共通化必要。Phase2 で leads 機能着手前に必須。

### M-7. `auth/callback` の `failed.search` 構築が `?error=...` 上書き（R2 M-7 据え置き）
- `app/auth/callback/route.ts:23` `failed.search = \`?error=...\`` は `code=` を引き継がないので OK だが、明示的に `failed.search = ""; failed.searchParams.set("error", "auth_callback_failed")` の方が安全。

### M-8. `dashboard/page.tsx:46` で **本番 UI に `.env.local` 設定 hint 表示**（R2 M-8 据え置き）
- `snapshot.source === "mock"` 条件で `.env.local` 設定方法を出すのは dev 専用化必須。`process.env.NODE_ENV === "production"` では「準備中です」など中立文言に。

### M-10. `connect-src` の `*.supabase.in` 残置（R2 M-10 据え置き）
- 古いインフラ。`*.supabase.co` のみで十分。

### M-11. Sentry / OpenTelemetry 未結線（R2 M-11 据え置き）
- `instrumentation.ts` は存在するが Sentry DSN 等の env 配線ゼロ。`/api/csp-report` の violation も `console.warn` のみで、本番は無音。Phase2 で結線。

### M-12. `tsconfig.json` の `noUncheckedIndexedAccess` 未指定（R2 M-12 据え置き）

### M-13. `next@15.0.3` のまま（R2 M-13 据え置き）

### M-14. `.env.example` の `SUPABASE_SERVICE_ROLE_KEY=` **残置**（R2 M-14 / R1 M-14 据え置き — 3 巡未対応）
- **要対応**: 値が空でも項目があるだけで bundle 流出経路。`lib/server-only/admin.ts` を新設して `assertServerOnly()` 経由で取り扱う。

### M-15. ESLint security plugin 未導入（R2 M-15 据え置き）

---

## LOW（R3 で残存）

- L-1. `lib/supabase/middleware.ts:50` 公開パス前置一致（R2 L-1 据え置き）
- L-2. `pathname !== "/login"` の冗長条件（R2 L-2 据え置き）
- L-4. `app/error.tsx` の incident_id を `lib/incident.ts` 共通化していない（R2 L-4 据え置き）
- L-5. `throw new Error("AUTH_REQUIRED")` を class 化（R2 L-5 据え置き）
- L-6. `fromUa varchar(256)` の切り捨て（R2 L-6 / R1 L-6 据え置き）
- L-7. `package.json` の `engines` / `packageManager` 未指定（R2 L-7 据え置き）

---

## R3 で評価できる前進点（差分）

1. **`auth_user_id` 一意紐付けへの全面切替** (`db/schema.ts:83`, `lib/auth.ts:38`)
   - email を信頼境界から外した。`(orgId, email)` 複合一意も付与され招待フローでドメインが衝突しない。`authUserId` のグローバル一意で `auth.users` 側を先に作って `public.users` 側を後付けする migration が走らせやすい。

2. **RLS migration の整合性が高い** (`db/migrations/0001_rls_phase2.sql`)
   - `audit_log` の append-only ポリシー (UPDATE/DELETE 拒否) を**ポリシー行で明示** (`USING (false)`) しており、デフォルト deny に頼らず意図がコードで読める。
   - `messages` を `leads` 経由で org 突合する `EXISTS` ポリシーは正しい。テーブル間の参照整合と RLS が両立するパターン。
   - `app_current_org()` を `STABLE` 関数として切り出したことで、policy が plan-time で展開され性能影響が小さい。

3. **CSP Report-Only への切替** (`next.config.ts:29`, `app/api/csp-report/route.ts`)
   - 「即 enforcing で既存スクリプトを壊す」失敗パターンを避けつつ違反シグナルを集める段階移行。設計書 §17.6 と整合。
   - `report-uri /api/csp-report` を結線したことで Phase2 で「最低 1 週間違反ゼロを確認 → enforcing 化」の運用判断ができる。

4. **`writeAudit` 結線 + DB 層の改竄耐性**
   - signin / signout の主要遷移を覆った。`audit_log` が RLS で UPDATE/DELETE 拒否ポリシー化されたことで、アプリのバグでうっかり update 文を流しても DB が拒否する**多層防御**。

5. **`middleware.ts` の cookies options 伝播**
   - Supabase の cookies が `HttpOnly / Secure / SameSite=Lax` のメタを伴って正しく cookie に書き込まれる。@supabase/ssr 0.6 の規約通り。

---

## 95+ 判定: **PASS（96/100）**

**判定根拠**:
- R2 で残っていた HIGH 4 件 (H-A, H-2, H-5, H-6) は**全て構造的に解消**。
- 認証フロー (20/20) は満点。`auth_user_id` ベース化により設計書 §17 ABAC の「同定」軸の致命線がゼロになった。
- マルチテナント分離 (17/20) は RLS が DB 層に降りたことで **「アプリ規律だけが砦」状態を脱出**。残点 3 は `scopedDb()` 経由への呼出移行 (M-A) と `set_config(..., true)` のトランザクションラップ (M-B) が完了していないこと、ABAC 5 軸 (Phase2) のため。
- 監査 (18/20) は RLS append-only + 結線で構造完成。残 2 は canonical JSON / `FOR UPDATE` / 認証前 audit (M-C/M-D/M-E)。
- CSP/Headers (18/20) は Report-Only 段階で適切。Phase2 で nonce + enforcing で 20/20 到達見込み。

**95+ 到達のうえでの本番投入チェックリスト**:

1. **deploy 順序の固定（最重要）**:
   - (a) `getDashboardSnapshot` / `writeAudit` を `scopedDb()` (＋ M-B 修正後の `withScopedTx`) 経由に書き換え → デプロイ
   - (b) DB に `db/migrations/0001_rls_phase2.sql` を適用
   - 上記順序を逆にすると本番が空配列を返す。`README.md` / `CHANGELOG.md` に手順を明記必須。
2. **`set_config(..., is_local=true)` のトランザクションラップ実装** (M-B)
3. **`SUPABASE_SERVICE_ROLE_KEY=` を `.env.example` から削除** (M-14)

**Phase2 (運用フェーズ)**:

4. CSP Report-Only の violation を 7 日確認 → nonce + `'strict-dynamic'` + enforcing
5. ABAC 5 軸 (owner/campaign/tag/region/ip_range) の policy 化（§17.1）
6. PII マスク（§17.3）/ 表示権限階段（§26.2）
7. canonical JSON + `FOR UPDATE` で hash chain 二股を排除 (M-D / M-E)
8. WORM ストレージ (S3 Object Lock Compliance Mode) への audit 外部化
9. Upstash Ratelimit (M-1) / Sentry 結線 (M-11) / `linkedinUrl` schema (M-5)
10. ペネトレーションテスト + 脅威モデル §26.1 の定期レビュー

---

## 参考: 確認したファイル (R3)

- 修正観測:
  - `db/schema.ts` (auth_user_id, users_email_org_idx 追加)
  - `lib/auth.ts` (authUserId ベースに切替, isActive チェック)
  - `db/migrations/0001_rls_phase2.sql` (新規, 8 テーブル RLS + audit_log append-only)
  - `lib/db-scoped.ts` (新規, scopedDb ヘルパ)
  - `next.config.ts` (CSP Report-Only)
  - `app/api/csp-report/route.ts` (新規, violation 受信)
  - `server/actions/auth.ts` (writeAudit 結線, signin/signout)
  - `lib/supabase/middleware.ts` (cookies.set options 渡し)
- 変化なし:
  - `lib/audit.ts`, `lib/rate-limit.ts`, `lib/incident.ts`
  - `app/auth/callback/route.ts`, `lib/supabase/server.ts`
  - `db/client.ts`, `app/api/health/route.ts`
  - `app/(app)/dashboard/page.tsx`, `server/queries/dashboard.ts`
  - `.env.example`, `package.json`

`scopedDb(` 経路の grep ヒットは `lib/db-scoped.ts` のみ → 呼出元未連結を裏付け (M-A 根拠)。`writeAudit(` 呼出は `server/actions/auth.ts:77,124` の 2 箇所で結線確認。RLS migration 内 `app_current_org()` ポリシー = 8 テーブル `ENABLE ROW LEVEL SECURITY` 確認。
