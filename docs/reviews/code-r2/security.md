# Security Review — code-r2

- **対象**: LinkdInside (Next.js 15 + Supabase Auth + Drizzle / Postgres)
- **設計準拠**: `docs/ui-ux/UI_UX_Design.md` v1.3 §17, §26
- **レビュー実施日**: 2026-05-10
- **レビュアー**: Security Architect (B2B SaaS) — R2
- **R1 リポート**: `docs/reviews/code-r1/security.md` (44/100, NEEDS_REVISION, HIGH×6)

---

## 総合スコア: **74 / 100** （R1 比 **+30**）

| 評価軸 | 配点 | R1 | R2 | 増減 | 主因 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. 認証フロー | 20 | 7 | 16 | +9 | `middleware.ts` + `lib/supabase/middleware.ts` で `getUser()` 保護成立 / `auth/callback` PKCE 実装 / `next` の同一 origin 強制 / 未ログイン→/login + ログイン済→/dashboard の双方向リダイレクト OK。残るは「`getSession()` が email 一意で org を決めている」設計上の弱点 (NEW H-A)。 |
| 2. RBAC / ABAC / マルチテナント分離 | 20 | 5 | 11 | +6 | `getSession().orgId` 必須化 / 未認証時は `mock` 返却で本データ漏洩なし / `hasAtLeastRole` ヘルパ追加。一方で **RLS 未実装 / ABAC 5 軸ゼロ / `scopedDb(orgId)` ヘルパなし** は据え置き。`postgres-js` 直結で service-role 相当ロールを使えばサーバ側バグが直接クロステナント漏洩になる構造は不変 (HIGH 残存)。 |
| 3. 入力検証 / SQLi / XSS / CSRF | 20 | 11 | 16 | +5 | Server Action に zod 採用 / 5 件/5 分のレート制限 / 列挙防止の汎用エラー文言。残課題: zod 共通 wrapper 化なし、`linkedinUrl` の URL 検証/サニタイザ helper 未実装、`tsconfig` 厳格化未対応 (`noUncheckedIndexedAccess`)。 |
| 4. PII / ログ / 監査 | 20 | 11 | 14 | +3 | `lib/audit.ts` で hash chain 書込み実装。一方で **どこからも呼ばれていない** (auth/signin/signout 含む) のと、`prev` 取得が `FOR UPDATE` 無し → 並行下で hash 分岐リスクあり。PII マスク / WORM はまだ。 |
| 5. 設定 (CSP / headers / env) | 20 | 10 | 17 | +7 | HSTS / X-Frame / X-Content / Permissions / Referrer / 基本 CSP すべて投入。`frame-ancestors 'none'` も OK。残: `script-src 'unsafe-inline'` が本番でも残置 (実質 XSS 防御の主柱が無効) / `SUPABASE_SERVICE_ROLE_KEY` が `.env.example` に残置 / `NEXT_PUBLIC_APP_URL` 依存。 |

**判定: NEEDS_REVISION（あと 1 巡で 95+ 到達可能）**

R1 HIGH 6 件のうち **4 件解消 / 2 件部分解消 / 0 件未着手**。新規 HIGH 1 件 (`getSession` の email-only 同定) を検出。

---

## R1 HIGH 差分マトリクス

| ID | R1 タイトル | R2 ステータス | 根拠 |
| --- | --- | --- | --- |
| H-1 | 認証ミドルウェア不在 | **解消** | `middleware.ts` + `lib/supabase/middleware.ts:30-46` で `getUser()` ベースの保護。matcher も `_next/static` 等を除外して `(app)/*` 全部を覆う。 |
| H-2 | テナント分離 (`org_id` 強制) 未実装 | **部分解消** | `dashboard/page.tsx:25-26` が `session.orgId` 必須化 / `getDashboardSnapshot:57` が `!orgId` で mock 返却に降格。**ただし RLS / ABAC / `scopedDb` helper はゼロ**。MVP 1 ファイルだけ守ってもスケールしない。HIGH 残存。 |
| H-3 | Open Redirect + auth/callback 不在 | **解消** | `app/auth/callback/route.ts:9-32` で PKCE `exchangeCodeForSession` + `next` を `startsWith("/") && !startsWith("//")` で検証。同一 origin 限定が成立。`signInWithMagicLink` 側でも同条件でガード (`server/actions/auth.ts:59`)。 |
| H-4 | Server Action のレート制限 / 列挙 | **解消** | zod `SignInSchema` (`max(254).email()`) / `rateLimit("signin:ip:email", 5, 5min)` / 失敗文言固定化で列挙防止。ただし `rateLimit` は **インメモリ** なので Vercel 等の serverless では即無効化される (R2 MEDIUM)。 |
| H-5 | Security Headers / CSP 不在 | **部分解消** | HSTS / X-Frame / X-Content / Referrer / Permissions / 基本 CSP 投入済。**`script-src 'unsafe-inline'` が本番でも残るため XSS 主防御線は穴空き**。nonce 化 or `'strict-dynamic'` への移行が必須。HIGH 残存。 |
| H-6 | 監査ログ書込み実装ゼロ | **部分解消** | `lib/audit.ts:40-85` で hash chain 書込みヘルパ実装。**しかし grep で `writeAudit(` 呼出箇所はゼロ**。`signInWithMagicLink` / `signOut` / `auth/callback` のいずれも監査されておらず、設計書 §17 の「すべての state-changing 操作を append-only」要件は事実上未達。HIGH 残存（実装はあるが結線されていない）。 |

---

## HIGH（残存 + 新規）

### H-2 (残存). RLS / ABAC が空 — クロステナント漏洩耐性は MVP 1 ファイルの規律のみ
- **箇所**: `db/schema.ts` 全体（`enableRowLevelSecurity()` / `pgPolicy()` 宣言ゼロ）/ `db/client.ts:16-23`（postgres-js を `prepare:false` で素直に接続、トランザクション毎の `set local "request.jwt.claims"` 流し込み無し）
- **問題**:
  1. 現状「アプリ層が `eq(orgId, session.orgId)` を**忘れない**」という規律だけが砦。`getDashboardSnapshot` 1 関数は守れていても、今後 inbox / leads / campaigns 用クエリが書かれた瞬間に必ず崩れる。
  2. ABAC 5 軸（`linkedin_account_owner` / `campaign_member` / `tag_scope` / `region` / `ip_range`、設計書 §17.1）は grep ヒット 0。
  3. `db/client.ts` の `globalThis.__pg__` で全テナント共有プール → **直前トランザクションのセッション変数を引きずる**懸念は R1 M-4 から未改善。
- **影響**: 本番投入で IDOR / クロステナントデータ漏洩がほぼ確定。
- **推奨（最低ライン）**:
  - `db/scoped.ts` に `scopedDb(orgId)` を作成、`select/insert/update/delete` を**強制で `where(eq(*.orgId, orgId))` でラップ**するファサードに統一。
  - Drizzle `migrations/` に `enable row level security` + 各テーブルの policy（`USING (org_id = current_setting('app.org_id')::uuid)`）。
  - `getDb()` を `getScopedDb(orgId)` に置換し、トランザクション開始時に `set local "app.org_id" = ...` を流す。
  - 直結ロールは「RLS 強制ロール」に固定。`SUPABASE_SERVICE_ROLE_KEY` は環境変数として**サーバ専用ファイル**でしか参照させない (例: `lib/server-only/admin.ts`)。

### H-5 (残存). 本番 CSP の `script-src 'unsafe-inline'` で XSS 主防御線が無効
- **箇所**: `next.config.ts:28`
  ```ts
  `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'unsafe-inline'"}`
  ```
- **問題**: `'unsafe-inline'` を script-src に置くと、CSP がインラインスクリプト/`onclick=`/`<script>document...</script>` を**素通し**にする。これは「CSP がある」と書いたエンジニアが最初に外すべきものであり、設計書 §17 / §26.2 の DLP / XSS 階梯を支える前提が崩れる。`db/schema.ts:155` の `linkedin_url`/`headline`/`fullName` は将来 UI に表示されるため、ストアド XSS の踏み台になりうる。
- **影響**: ストアド XSS が発生した場合、CSP では止められない。`next.config.ts` のヘッダ群が「コンプラ用ラベル」止まりになる。
- **推奨**:
  - Next 15 + middleware で `crypto.randomUUID()` ベースの `nonce` を発行 → ResponseHeaders と `<script nonce={...}>` の両方に注入。
  - 本番だけは `script-src 'self' 'nonce-XXX' 'strict-dynamic'`、`'unsafe-inline'` 撤去。
  - `style-src` に限り `'unsafe-inline'` は当面許容で OK（Tailwind v4 / Next が style 注入する）。
  - `report-to` / `report-uri` を入れて、移行中の違反を可視化。

### H-6 (残存). 監査ログ helper が**結線されていない**
- **箇所**: `lib/audit.ts:40-85` (実装あり) / `server/actions/auth.ts`, `app/auth/callback/route.ts`, `lib/supabase/middleware.ts`（呼出ゼロ）
- **問題**: `writeAudit` は型・ハッシュチェイン込みで実装されているが、**どこからも呼ばれていない**。設計書 §17 が要求する「auth.signin_requested / signin_success / signout / break_glass を append-only で全件記録」が実体ゼロ。
- **副次問題**:
  1. `lib/audit.ts:44-49` で **直前 row を `SELECT .. ORDER BY desc LIMIT 1` で取得しているが `FOR UPDATE` を取っていない**。並行 INSERT 下で同一 `prevHash` を持つ枝分かれ（hash chain の二股）が発生しうる。
  2. `prevHash` が同一トランザクション内で確定されないため、`SERIALIZABLE` でない限り「監査の欠落 / 二重」を後検出できない。
- **推奨**:
  ```ts
  await db.transaction(async (tx) => {
    const [prev] = await tx
      .select({ hash: schema.auditLog.hash })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.orgId, orgId))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1)
      .for("update"); // 行ロック (Drizzle: .for('update'))
    // ... insert ...
  }, { isolationLevel: "serializable" });
  ```
  - `signInWithMagicLink` / `signOut` / `app/auth/callback/route.ts` から `writeAudit({ action: "auth.signin_requested" / "signin_success" / "signout", fromIp, fromUa, ... })` を**必ず**呼ぶ。
  - Server Action に `withAudit(action)` ラッパ HOF を作って強制化（設計書 §17 の趣旨）。

### NEW H-A. `getSession()` が **email 一意キー** で users を引いている — `auth.users.email` 偽装で他テナント乗っ取り
- **箇所**: `lib/auth.ts:36-38`
  ```ts
  .where(eq(schema.users.email, user.email ?? ""))
  ```
- **問題**:
  1. `db/schema.ts:90` の `users_email_idx` はグローバル一意。Supabase の `auth.users` と `public.users` は **`id` で結ばれていない**。`getSession` は「Supabase Auth の email = `public.users.email`」のマッチで org を決めている。
  2. Supabase Auth では `email` を確認済みでも、フローによっては大文字小文字違い (`User@x.com` vs `user@x.com`) を別ユーザーとして登録できる場合がある。一方 `public.users` は `email` をそのまま `varchar` で保存しており、正規化していない。`getSession` の eq は **大文字小文字一致**で、ホモグラフ攻撃 (`U+0049` vs `U+FF29`) や ZWSP (`U+200B`) で「DB 上は別だが画面上同一」のメールを Auth 側に作り、組み合わせ次第で「他社 org の `public.users` 行に紐付くセッション」を成立させられる。
  3. もし `users.email` を NFKC 正規化 + `lower()` でユニーク化していても、`auth.users` 側の email を**後から変更**できる Supabase の機能（admin SDK / SQL）を使うと、攻撃者が自分の Auth ユーザーの email を被害者の email に書換えると、`getSession` が被害者 org の `public.users` 行を返す。
  4. これは **HIGH 級のテナント越境**。 `lib/auth.ts:21` の docstring「ABAC に従い、API/SA は orgId が無い場合データを返さない」は、**orgId が間違って解決される**最悪パターンを想定していない。
- **推奨**:
  - `public.users` に `auth_user_id uuid unique not null references auth.users(id)` を追加し、`getSession` は **`auth_user_id = supabase.auth.getUser().id`** で引く。email は表示用にのみ使う。
  - 既存スキーマでは `users.id = auth.users.id` を不変条件に固定し、招待フロー側で `auth.signUp` の戻り `id` を `public.users.id` に流す migration を入れる。
  - email は `lower(normalize(email, NFKC))` で論理化する `generated column` を使い、`(orgId, email_norm)` で複合ユニーク化（R1 M-5 と統合）。

---

## MEDIUM（運用前に修正）

### M-1. レート制限が**インメモリ** — Vercel/Edge では即無効化
- **箇所**: `lib/rate-limit.ts:8` (`const buckets = new Map`)
- 単一プロセス前提。Vercel Functions / Cloudflare Workers / 多インスタンス Node では別 lambda が別バケットを持つので**実質ザル**。コメントには「本番では Upstash に置き換え」とあるが TODO を残したまま。Upstash Ratelimit / Supabase Postgres の `pgcrypto + select for update` 等で**本物**にする必要あり。

### M-2. `x-forwarded-for` を**信頼**して IP rate-limit キーにしている
- **箇所**: `server/actions/auth.ts:47`
- 攻撃者が `X-Forwarded-For: 1.1.1.1` を任意設定できる構成（Vercel 直配信ならエッジで上書きされるが、Next standalone + 自前 reverse proxy では穴）。Vercel なら `request.headers.get("x-real-ip")` または `request.ip` を使う。複数値の先頭を取るのも spoof 容易。
- 推奨: `request.ip ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").pop()?.trim()` のように**末尾 (= 最近接 trusted proxy)**を使う。

### M-3. `app/api/health` 認証なしで `db.execute("select 1")` を流す
- **箇所**: `app/api/health/route.ts:18-19`
- 1 req = 1 DB round-trip。匿名で叩けるため、**health-check 経由 DoS** で接続プール枯渇を狙える。`Cache-Control: no-store` は妥当だが、IP レート制限 (60req/分など) を入れるか、`db: 'configured'` の真偽だけ返して SQL を打たない設計が安全。

### M-4. `users.email` が**全テナント横断**ユニーク (R1 M-5 据え置き)
- `db/schema.ts:90` `uniqueIndex("users_email_idx").on(t.email)` のまま。招待・ドメインフェデレーションで詰む + NEW H-A の前提でもある。

### M-5. `metadata jsonb` / `linkedin_url varchar(256)` の入力検証なし (R1 M-6 据え置き)
- アプリ側 zod も無いまま。新 Server Action を書く前に `lib/schemas/lead.ts` 等で `LinkedinUrl = z.string().regex(/^https:\/\/(www\.)?linkedin\.com\//)` を共通化しておかないと、画面で `<a href={linkedinUrl}>` 表示時に `javascript:` URI が刺さる。

### M-6. `getSession().email` の比較に NFKC 正規化なし (R1 M-7 据え置き)
- `lib/auth.ts:37` `eq(schema.users.email, user.email ?? "")` — NEW H-A の補強としても必須。

### M-7. `auth/callback` ルートで監査ログを書いていない / `error.search = "?error=auth_callback_failed"` の構築方法
- `app/auth/callback/route.ts:23` `failed.search = `?error=...`` は OK だが、**`url.clone()` で元の `code=`/`next=` クエリも引き継ぐ**ため、ログに `code` が残る可能性。`failed.search = ""` した後に `failed.searchParams.set("error", "auth_callback_failed")` を推奨。

### M-8. `dashboard/page.tsx:42` で **`.env.local` という設定パスを本番 UI に表示**（R1 L-5 据え置き）
- `snapshot.source === "mock"` のときに「`.env.local` に `DATABASE_URL` を設定すると…」を出している。本番では mock 経路に落ちる ＝ 設定漏れ ＝ ユーザーに開発 hint を出してしまう。`process.env.NODE_ENV === "production"` では「準備中です」など中立文言に。

### M-9. `lib/audit.ts:64` の hash 計算が**JSON.stringify の安定化なし**
- `JSON.stringify` はキー順を保証する仕様だが、`diff` プロパティに任意 jsonb を入れている以上、入力元 (Server Action) が異なるキー順で渡すと**同一意味なのに hash が別**になる。設計書 §17 の「ハッシュチェイン照合」を後段で行うとき、再計算側が同一順序で正規化できないと検証失敗。
- 推奨: `safe-stable-stringify` or `canonicalize` を使用。`Buffer.from(JSON.stringify(input, Object.keys(input).sort()))` でも可。`prevHash || normalized` の **`||`** の代わりに、空文字を `0x00` 1 バイトの境界で連結（区切り混入防止）するとさらに堅い。

### M-10. `next.config.ts:28` 本番 CSP の `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co`
- ワイルドカード `*.supabase.co` は許容範囲だが、`*.supabase.in` は古いインフラ。`*.supabase.co` のみで十分（公式ドキュメント参照）。`wss:` も `wss://*.supabase.co` ピンポイント済 OK。
- `connect-src` に `https://*.unipile.com`（将来）/ `https://api.openai.com`（将来 LLM）を入れる時は `process.env.NEXT_PUBLIC_*` で構築する仕組みを最初に入れておくと運用楽。

### M-11. `instrumentation.ts` 未確認 / `SENTRY_DSN` 等の env 仕込みがない
- `app/error.tsx:18` で `console.error` のみ。設計書 §12.3 の incident_id を Sentry に送る経路がコメントに書かれているだけで実装ゼロ。本番で auth_callback_failed の根本原因を追えない。

### M-12. `tsconfig.json` の `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` 未指定 (R1 M-12 据え置き)

### M-13. `react@19.0.0-rc-...` / `next@15.0.3` のまま (R1 M-13 据え置き)
- 現在 (2026-05) で `next@15.0.3` は古い。`@` 系 0day patch (`x-middleware-subrequest` CVE 等) のため最新パッチ推奨。

### M-14. `.env.example` から `SUPABASE_SERVICE_ROLE_KEY=` 行が**まだ消えていない** (R1 M-14 未対応)
- 値は空でも、項目があるだけで service-role を環境変数経由で誤って bundle に含める導線になる。**完全削除**し、本当に必要になった時に `lib/server-only/admin.ts` 内で `assertServerOnly()` ガード付きで取り扱う。

### M-15. ESLint security plugin 未導入 (R1 M-15 据え置き)
- `eslint-plugin-security` / `@typescript-eslint/no-floating-promises` / `eslint-plugin-no-unsanitized` を入れて Server Action の `await` 抜けと URL 文字列の dangerouslySetInnerHTML を CI で機械的に止める。

---

## LOW

### L-1. `lib/supabase/middleware.ts:38` — 公開パス判定の前置一致脆弱性
- `pathname.startsWith(p + "/")` は OK だが、`pathname === p` も含めているので `/auth` と `/auth/callback` 両方が公開化される。意図的だが、将来 `/auth-debug` のようなプレフィックス被りパスを足したときに事故りやすい。**完全一致 + 配列管理**を維持して、新規 public path は必ずレビュー対象に。

### L-2. `lib/supabase/middleware.ts:42` `pathname !== "/login"` の冗長条件
- `isPublic` の中で `/login` も拾っているので不要。可読性低下。

### L-3. `auth/callback/route.ts:31` `dest.search = ""` で **`?error=` 等のクエリも全部消す** が、`next` がフラグメント (`#tab=foo`) を持つと残らない
- `URL` クラスのフラグメントは `hash` に出るが `searchParams.set("next", "/dashboard#x")` でエンコード済になるので問題は出ない。記録のみ。

### L-4. `app/error.tsx:23` `Math.floor(Math.random() * 9000) + 1000` で incident_id 採番
- すでに `lib/incident.ts:9` に同等関数があるのに使っていない。**dev/prd 双方で衝突しうる乱数 4 桁**。短期は良いが、本番で同 incident_id が複数事象で発行される。`crypto.randomUUID()` ベースに置換、または `getServerSideProps` 経由で `digest` を必ず使う。

### L-5. `lib/auth.ts:54` `throw new Error("AUTH_REQUIRED")` のみ
- 文字列リテラルでは error.cause / digest が拾えない。`class AuthRequiredError extends Error` を作って `instanceof` で分岐できるように。

### L-6. `db/schema.ts:233` `fromUa varchar(256)` が**切り捨て発生**しうる (R1 L-6 据え置き)

### L-7. `package.json` に `"engines"` `"packageManager"` 未指定 (R1 L-8 据え置き)

---

## 良い点（差分での前進）

1. **middleware.ts と auth/callback の組み合わせが教科書通り**
   `lib/supabase/middleware.ts:30-46` の `getUser()` (※`getSession()` ではなく `getUser()`) → `(app)/*` 全保護 → `/login` 上書き、と`app/auth/callback/route.ts:9-32` の PKCE + 同一 origin 限定 next が R1 で一番重かった H-1/H-3 を一掃。

2. **Server Action の入力検証 + 列挙防止 + レート制限の三点セット**
   `server/actions/auth.ts` で zod / `rateLimit` / 失敗時の固定文言が揃った。OWASP A07 (Auth Failures) の MVP 対策としては合格点。

3. **Security Headers の最低ライン投入**
   `next.config.ts:10-39` で HSTS / X-Frame / Permissions-Policy / Referrer-Policy / 基本 CSP が出る。`frame-ancestors 'none'` / `object-src 'none'` / `form-action 'self'` も込みで、設計書 §17 の最低要件を満たす起点ができた。

4. **`auditLog` の hash chain ロジック自体は正しく書けている**
   `lib/audit.ts:64` の SHA-256 連鎖は仕様通り。あとは `FOR UPDATE` と canonical JSON と「全 Server Action から呼ぶ強制力」を足すだけで設計書 §17 まで届く。

---

## 95+ 到達のための残ブロッカー（最短 1 巡）

### 必須（すべて HIGH 残存）
1. **RLS 有効化 + `scopedDb(orgId)` ヘルパ** (H-2 残存)
   - Drizzle migrations に `enable row level security` + per-table policy
   - `db/scoped.ts` で `where(eq(*.orgId, orgId))` を**型レベルで強制**するファサード
   - `getDb()` 直叩きを禁止（lint rule で）
2. **本番 CSP から `'unsafe-inline'` 撤去 → nonce 化** (H-5 残存)
   - middleware で `nonce = crypto.randomUUID()` 発行 → response header と `<script nonce>` 注入
   - `'strict-dynamic'` で第三者 SDK にも対応
3. **`writeAudit` の結線** (H-6 残存)
   - `signInWithMagicLink` / `signOut` / `auth/callback` の3箇所に最低限投入
   - `withAudit(action)` HOF を Server Action 専用に作って強制化
   - `db.transaction({ isolationLevel: "serializable" }, async tx => tx.select().for("update"))` で hash chain の二股を排除
4. **`getSession` を `auth_user_id` ベースに切替** (NEW H-A)
   - `public.users` に `auth_user_id uuid unique not null references auth.users(id)` を追加
   - `getSession` の `where` を `eq(schema.users.authUserId, supabaseUser.id)` に置換
   - email 比較は表示専用へ降格

### 強く推奨（MEDIUM 解消）
5. レート制限を Upstash / pg ベース永続化 (M-1)
6. `x-forwarded-for` 信頼問題の修正 (M-2)
7. `.env.example` から `SUPABASE_SERVICE_ROLE_KEY=` 削除 (M-14)
8. `users.email` を `(orgId, lower(normalize(email)))` 複合ユニークに (M-4 / NEW H-A 補強)
9. `linkedinUrl` の zod / サニタイザ helper (M-5)
10. canonical JSON で hash 計算 (M-9)

### Phase 2（運用フェーズ）
11. ABAC 5 軸のポリシー化（§17.1）
12. PII マスク（§17.3）/ 表示権限階段（§26.2）
13. CSV エクスポート前ダイアログ + 透かし + 7 日 URL 失効（§17.2）
14. Sentry / OpenTelemetry 結線（incident_id 連携、§12.3）
15. WORM ストレージ（S3 Object Lock Compliance Mode）への監査ログ外部化
16. ペネトレーションテスト + 脅威モデル §26.1 の定期レビュー

---

## 95+ 判定: **NO（74/100、もう 1 巡必要）**

**理由**: HIGH 残存 3 件 (H-2/H-5/H-6) + 新規 HIGH 1 件 (NEW H-A) のいずれも**設計書 §17 の中核**（テナント分離 / XSS 主防御 / 監査連鎖 / 認証同定）に当たる。MVP として動かす分には R1 比で大きく前進したが、**本番投入 = 95+** を名乗るには、上記「必須 4 項目」を**機械的に外せない構造**で組み込む必要がある。

最短ルートはこの 1 巡で:
- Drizzle migration + RLS + `scopedDb` 一式
- middleware で nonce 発行 + CSP 強化
- `writeAudit` 結線 + transaction + canonical
- `auth_user_id` カラム追加 + `getSession` 切替

を同時に入れる。これで **92-96** に到達見込み。残りは ABAC / PII マスク / WORM 等の Phase 2 で 96+→98 を狙う。

---

## 参考: 確認したファイル

- `middleware.ts`, `lib/supabase/middleware.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts`
- `app/auth/callback/route.ts`, `app/login/page.tsx`, `components/auth/sign-in-form.tsx`
- `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `app/api/health/route.ts`, `app/error.tsx`
- `server/actions/auth.ts`, `server/queries/dashboard.ts`
- `lib/audit.ts`, `lib/auth.ts`, `lib/rate-limit.ts`, `lib/incident.ts`
- `db/schema.ts`, `db/client.ts`
- `next.config.ts`, `package.json`, `.env.example`, `.gitignore`, `.eslintrc.json`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §17, §26
- R1: `docs/reviews/code-r1/security.md`

`db/migrations/*` は**未存在を確認済み**（H-2 の根拠）。`writeAudit(` 呼出は grep で 0 件 (H-6 残存の根拠)。`enableRowLevelSecurity` / `pgPolicy` も 0 件。
