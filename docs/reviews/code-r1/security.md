# Security Review — code-r1

- **対象**: LinkdInside (Next.js 15 + Supabase Auth + Drizzle / Postgres)
- **設計準拠**: `docs/ui-ux/UI_UX_Design.md` v1.3 §17, §26
- **レビュー実施日**: 2026-05-09
- **レビュアー**: Security Architect (B2B SaaS)
- **対象スコープ**: `app/`, `components/`, `lib/`, `db/`, `server/`, ルート設定 (`next.config.ts`, `drizzle.config.ts`, `package.json`, `.env.example`, `.gitignore`, `.eslintrc.json`)

---

## 総合スコア: **44 / 100**

| 評価軸 | 配点 | 取得 | 主因 |
| --- | ---: | ---: | --- |
| 1. 認証フロー（Magic Link / Redirect / Session / Middleware） | 20 | 7 | `middleware.ts` 不在で `(app)` ルートがすべて未保護 / `/auth/callback` が未実装 / Open Redirect の可能性 |
| 2. 認可 / RBAC / ABAC / マルチテナント分離 | 20 | 5 | `orgId` が常に `null` 渡し、認証連携なし / RLS 無し / ABAC 未実装 / `org_id` 強制機構ゼロ |
| 3. Server Action / 入力検証 / SQLi / XSS / CSRF | 20 | 11 | Drizzle parametrized で SQLi リスクは低 / 一方 zod 依存追加済みだが未使用 / Server Action のレート制限ゼロ |
| 4. 機微情報・ログ・監査 | 20 | 11 | `auditLog` スキーマ良 / hash chain DB 列はある / 書き込み実装なし、PII マスク実装なし、`error.message` を直接ユーザーへ返却 |
| 5. 設定漏れ（CSP / headers / env / secret） | 20 | 10 | `.gitignore` は健全 / `next.config.ts` に security headers / CSP 一切なし / `.env.example` がサーバ用シークレットを混在 |

**判定: NEEDS_REVISION**（HIGH 6 件のうち、認証ミドルウェア不在とテナント分離未実装が最重大）

---

## HIGH（重大 / 即時修正必須）

### H-1. 認証ミドルウェア不在 — `(app)/*` ルート全体が**未認証で閲覧可能**
- **箇所**: リポジトリ全体（`middleware.ts` が存在しない / `app/(app)/layout.tsx:1-10` には認証チェックなし）
- **問題**: Next.js App Router では Route Group `(app)` 自体は URL に出ない。`/dashboard` を含むすべての `(app)` 配下ルートは現状 **誰でもアクセス可能**。`@supabase/ssr` を入れているが `createServerClient` を呼ぶのは `auth.ts` のみで、ミドルウェアでセッション検証 → リダイレクトする一般的なパターンが欠落。
- **影響**: マルチテナント SaaS で「ログインせずに /dashboard, /campaigns, /leads 直叩きで閲覧可能」となれば即時インシデント。`UI_UX_Design.md §17` のセッション 8h / Idle Timeout 設計が完全に空文。
- **推奨**:
  ```ts
  // middleware.ts (root)
  import { NextResponse, type NextRequest } from "next/server";
  import { createServerClient } from "@supabase/ssr";

  export async function middleware(req: NextRequest) {
    const res = NextResponse.next();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { /* req.cookies / res.cookies */ } }
    );
    const { data: { user } } = await supabase.auth.getUser();   // ← getSession ではなく getUser
    const path = req.nextUrl.pathname;
    const isAuthArea = !path.startsWith("/login") && !path.startsWith("/auth") && !path.startsWith("/legal");
    if (!user && isAuthArea) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("redirect", path);   // 後述 H-3 のサニタイズ必須
      return NextResponse.redirect(url);
    }
    return res;
  }
  export const config = { matcher: ["/((?!_next|favicon.ico|public).*)"] };
  ```

### H-2. テナント分離（`org_id` 強制）が**完全に未実装**
- **箇所**:
  - `app/(app)/dashboard/page.tsx:26-27` — コメント「`org_id` は本来 auth から取得。MVP ではモックを返すために null。」のうえで `getDashboardSnapshot(null, days)` をハードコード呼出
  - `server/queries/dashboard.ts:46-53` — `orgId` が `null` のとき素直に `mockSnapshot` にフォールバック
  - DB スキーマ `db/schema.ts` に **RLS（Row Level Security）有効化や policy 定義が一切ない**
- **問題**:
  1. MVP 段階のスタブとはいえ、実装した瞬間に「セッションから `orgId` を引き、DB query へ強制注入」する関数が必要。現状は **どこにも存在しない**。
  2. Supabase を使うなら `auth.users` ↔ `public.users` ↔ `organizations` のマッピング、および各テーブルの `USING (org_id = (auth.jwt()->>'org_id')::uuid)` Postgres RLS が必須。 設計書 §17.1 の ABAC（`linkedin_account_owner` / `campaign_member` / `tag_scope` / `region` / `ip_range`）は1つも実装されていない。
  3. 将来 `getDashboardSnapshot` の呼出元を「auth から `orgId` を渡す」へ変更しても、Drizzle 直結の `getDb()` には RLS が効かない（`postgres-js` で `service_role` 相当のロールを使う場合 RLS バイパス）。
- **影響**: 1 テナントでも本番運用すると IDOR / クロステナントデータ漏洩が確定的に発生。
- **推奨**:
  - サーバ側で `getCurrentOrgId(): Promise<string>` を作成し、すべての query / action がこれを **内部で取得**（呼び出し元から渡させない）。
  - `DATABASE_URL` 用ロールを RLS 有効ロールに固定し、`SET LOCAL "request.jwt.claims" = ...` を Drizzle のトランザクション開始時に流す（あるいは Supabase REST 経由）。
  - `db/schema.ts` に `enableRowLevelSecurity()` / `pgPolicy(...)` を Drizzle で宣言し migration 化。
  - すべての `select()/insert()/update()/delete()` を `where(eq(table.orgId, currentOrgId))` で機械的にラップする helper（`scopedDb(orgId)`）を提供。

### H-3. Open Redirect の素地 + `auth/callback` ルートが**未実装**
- **箇所**: `server/actions/auth.ts:14-17`
  ```ts
  emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`,
  ```
- **問題**:
  1. `app/auth/callback/route.ts`（PKCE / `exchangeCodeForSession` する route handler）が存在しない。**マジックリンクをクリックしてもセッションが確立しない**（機能不全）。
  2. `NEXT_PUBLIC_APP_URL` が公開 env なので、ブランチプレビュー等で書き換わると、攻撃者ドメインへ Magic Link が向かうリスク（Supabase 側で Allowed redirect URLs を許可リスト管理しないと有効）。
  3. 実装時に `?next=` / `?redirect=` を受け取って `redirect()` する場合、Open Redirect / Phishing の踏み台になる。
- **推奨**:
  - `app/auth/callback/route.ts` を新規追加し、`code` を `exchangeCodeForSession` で消化、 `next` パラメタは `URL` パースして **同一 origin 限定** を確認後にリダイレクト。
  - Supabase Studio で **Allowed Redirect URLs** を本番 / プレビュードメインに固定（ワイルドカードなし）。
  - `NEXT_PUBLIC_APP_URL` ではなく `request.nextUrl.origin` を使う（フォールバック値は本番では使わない）。

### H-4. `Server Action` のレート制限・CSRF オリジン検証なし / ボット投入耐性ゼロ
- **箇所**: `server/actions/auth.ts:6-24`（`signInWithMagicLink`）
- **問題**:
  - Next.js Server Action は CSRF を Same-Origin で部分的に守るが、**メール総当たり / ボムアタック**には無防御。Supabase Auth のメール送信 quota を簡単に枯渇させられる。
  - `error.message` をそのままクライアントに返している（`return { ok: false, error: error.message }`）→ メールアドレス存在判定の Enumeration（OWASP A07）。
  - `email` の Zod 検証なし。`zod` を依存に入れているのに使っていない。
- **影響**: スパム送信 / DoS / ユーザー列挙。
- **推奨**:
  ```ts
  const Schema = z.object({ email: z.string().email().max(254) });
  // Upstash Ratelimit などで IP+email バケット (5/15min) を制御
  // エラーは「メールを送信しました」を常に返す（成否に関わらず）
  ```

### H-5. `next.config.ts` に **Security Headers / CSP が一切ない**
- **箇所**: `next.config.ts:1-13`
- **問題**: 設計書 §13/§17/§26 が「マスク / 監査 / DLP / ABAC」を要求しているのに、最低限の HTTP セキュリティヘッダ（CSP, HSTS, X-Frame-Options, Referrer-Policy, X-Content-Type-Options, Permissions-Policy）が設定されていない。Magic Link 経由の認証 SaaS で `script-src 'self' 'unsafe-inline'` 抜きの CSP が無いのは**運用前に必修**。
- **推奨**:
  ```ts
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { key: "Content-Security-Policy", value: cspWithNonce(/* nonce-based */) },
      ],
    }];
  }
  ```
  Next 15 の nonce ベース CSP は `middleware.ts` で `nonce` を生成→ヘッダー注入が王道。`'unsafe-inline'` はインラインスタイル避けるため `style-src` のみ許容、`script-src` は nonce のみ。

### H-6. `auditLog` スキーマは存在するが、**実装側の書き込み箇所がゼロ** / hash chain 検証ロジック未提供
- **箇所**: `db/schema.ts:213-241`（テーブル定義）vs リポジトリ全体（書込みコード grep ヒット 0 件）
- **問題**:
  - `audit_log` の `prevHash` / `hash` は宣言だけ。書き込み helper（直前の最新エントリを SELECT FOR UPDATE → SHA-256 で連結 → INSERT）が無い。設計書 §17 の **append-only / 改竄耐性** が空文。
  - `signInWithMagicLink` / `signOut` も監査されていない。
- **推奨**:
  - `lib/audit/append.ts` を新設、すべての state-changing Server Action / API route から **必ず**呼ぶ（middleware ミックスインや zod-action wrapper の中で強制）。
  - `prev_hash` を読みに行く SELECT は同一トランザクション内で `FOR UPDATE` を取り、競合下でも単調増加に。
  - 日次 root を `kms.sign` で署名し、設計通り KMS と DB 双方に保存する worker を設計（PII で取り扱えない場合は `pgcrypto` でも初期可）。

---

## MEDIUM（運用前に修正）

### M-1. `lib/supabase/server.ts:8,9` — env 未設定時に **空文字で `createServerClient` を初期化**
- 開発体験のため `?? ""` で握りつぶしているが、本番で env 漏れが起きた場合**起動はするのに認証だけ静かに死ぬ**。`assertEnv()` で起動時 fail-fast する方が安全。`lib/supabase/client.ts:6,7` 同。

### M-2. `lib/supabase/server.ts:18-25` — Cookie `set` の `try { } catch { }` で**無言エラー**
- Server Components 以外（Route Handler / Server Action）からは set 可能、書けないのは Server Components のみ。`process.env.NODE_ENV !== "production" && console.warn(...)` 程度のログを入れるべき。さらに `set` できないコンテキストで Supabase が発行したトークン更新が握りつぶされ、**セッションが意図せず短命化**する可能性あり。Next 15 公式の `updateSession` ミドルウェアパターンに置換推奨。

### M-3. `lib/supabase/server.ts` で `getUser()` ベースの認証チェック helper を**未提供**
- 各 Server Component / Server Action が個別に `supabase.auth.getUser()` を呼び忘れるリスク。`requireUser()` / `requireOrg()` ヘルパを `lib/auth/guard.ts` に集約し、TypeScript 型で「authed user」を保証する設計が必要。

### M-4. `db/client.ts:6-9` — `globalThis.__pg__` を使ったコネクション再利用で**シリアライゼーションフェーズの脆弱性**
- HMR 用のキャッシュとしては定石だが、`prepare: false` のうえに RLS 切替がないため、複数テナントで同一 `postgres-js` インスタンスを使い回すと「直前のテナントのセッション変数」を引きずる懸念。Supabase + Drizzle 構成では、トランザクション毎に `set local "request.jwt.claims"` を流す方式 (`db.transaction`) が必要。

### M-5. `db/schema.ts:81` — `email` `varchar(254)`、ユニーク制約は**全体で一意**（`uniqueIndex("users_email_idx")`）
- マルチテナントなら通常 `(orgId, email)` の複合ユニーク。現行は「同じメールが別 org に所属できない」状態。意図的なら良いが、招待・ドメインフェデレーション設計時に詰む可能性。
- また `email` は **PII。Postgres 側で `pgcrypto` 暗号化 / マスク表示権限**（設計書 §17, §26.2）が未実装。

### M-6. `db/schema.ts:163` — `metadata: jsonb` に**任意 JSON を許容**、LinkedIn URL/会社名等の入力検証をスキーマ側でしていない
- アプリ側 zod が必要。特に `linkedin_url varchar(256)` は URL バリデーションなし → `javascript:` URI を保管され、UI が `<a href={...}>` で素直に出すと **DOM XSS**（M-9 参照）。

### M-7. `server/actions/auth.ts:9` — `email.trim()` のみで Unicode 正規化なし
- ホモグラフ系メール、`U+200B` 含みの ZWSP 攻撃に弱い。`email.normalize("NFKC").toLowerCase().trim()` 推奨。

### M-8. `app/(app)/dashboard/page.tsx:23-24` — `searchParams.range` の検証
  ```ts
  const days = Math.min(180, Math.max(7, Number(range) || 30));
  ```
  - `Number("abc")` → `NaN`、`NaN || 30 → 30`、`Math.max(7, NaN) → NaN`、`Math.min(180, NaN) → NaN`。Drizzle に `NaN` 日が渡る経路がないかは要確認。zod `coerce.number().int().min(7).max(180).default(30)` で固める。

### M-9. ユーザー入力（リード `fullName`, `headline`, `company`, `linkedinUrl`、メッセージ `content`）が**今後 UI 表示される時の XSS / リンク先安全性**
- 現状ダッシュボードはモックなので顕在化していないが、`recent-campaigns.tsx` 等の `{row.name}` は React の自動エスケープが効く一方で、`<a href={url}>` 形式に展開する箇所は `javascript:` / `data:` を弾くサニタイザを必須化。`linkedin_url` は `https://(www.)linkedin.com/in/...` の正規表現で許容。

### M-10. `error.message` を **そのままレスポンスに混入** — `server/actions/auth.ts:21`
- Supabase が返す内部エラー（`Email rate limit exceeded` 等）を直接画面に出すと運用情報漏洩。**汎用メッセージに正規化**＋ Sentry に詳細送信のパターンに。

### M-11. `app/login/page.tsx:30-63` — `<form action={signInWithMagicLink}>` で**プログレッシブエンハンスメントなし**
- Server Action 自体は CSRF Same-Origin で防護されるが、`useFormState` でエラー文言をクライアントに表示するパターンが未導入。現状は `return` した値が**どこにも到達しない**（form がただ空 navigate する）。セキュリティ観点では「失敗時にユーザーへ何も伝わらない＝失敗を黙って許容」になる。

### M-12. `tsconfig.json:9` `"strict": true` は良いが、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 未指定
- 入力検証が雑な箇所で `undefined` が型上見えず、ランタイムで `String(undefined) === "undefined"` が email として通る等の事故を誘発しやすい。

### M-13. `package.json:27-28` — `react@19.0.0-rc-66855b96-20241106` で **RC 版** に固定
- Server Actions 経路のセキュリティ修正は GA で取り込まれることが多い。本番前に GA 19 系に上げるべき。Next.js 15.0.3 もパッチ更新（>=15.0.4）の確認推奨（`x-middleware-subrequest` 系過去 CVE）。

### M-14. `.env.example:4` `SUPABASE_SERVICE_ROLE_KEY=` がチェックインされている（値は空だが**項目だけで開発者を service_role に誘導する**）
- 現リポジトリで `SUPABASE_SERVICE_ROLE_KEY` を**実際に参照しているコードはゼロ**。 RLS バイパス用の禁断キーであり、誤ってクライアントバンドルに引き込まれると即全件漏洩。`.env.example` から削除し、必要になった時に **専用 server-only モジュール**＋ `assertServerOnly()` で取り扱う。

### M-15. ESLint ルールが**最小**（`.eslintrc.json:1-6`）
- `eslint-plugin-security` / `eslint-plugin-no-unsanitized` / `eslint-plugin-react`（XSS 系ルール）/ `@typescript-eslint/no-floating-promises` 未導入。Server Action での `await` 抜けは認可バイパスの温床。

---

## LOW（推奨改善 / コード品質）

### L-1. `app/login/page.tsx:58-60` `<a href="/legal/usage-policy">` — **`rel="noopener noreferrer"` なし**
- 同一オリジン内なら必須ではないが、外部 OAuth プロバイダや LinkedIn ヘルプへ将来差し替えるとき毎回忘れない仕組みに。

### L-2. `db/schema.ts:226` `diff: jsonb` — **PII を含む可能性のある before/after 値**を生で保管
- 監査ログに PII を入れるのは GDPR 上「目的限定 + 保管期間」管理が必要。ハッシュ・前 prefix のみで十分なケースが多い。

### L-3. `components/dashboard/kpi-card.tsx:59-67` `Wrap = href ? "a" : "div"` で `target="_blank"` 利用時の `rel` 検討漏れ
- 現状内部リンクのみだが、外部 URL を許容できない設計を ESLint で明示するのが安全。

### L-4. `next.config.ts:8-10` `images.formats` のみ。`images.remotePatterns` 未設定
- 将来 LinkedIn のアバターを `next/image` で SSR する場合、`remotePatterns` で `linkedin.com` 等にホワイトリスト固定（SSRF 軽減）。

### L-5. `app/(app)/dashboard/page.tsx:43` — エラー表示文に `.env.local` というファイル名を**プロダクション UI に出力**
- DEV 用ヒントは `process.env.NODE_ENV === "development"` ガードで囲うべき。本番で開発設定が見えると攻撃の足掛かりになる。

### L-6. `db/schema.ts:227-228` `fromIp varchar(64)`, `fromUa varchar(256)`
- IP は IPv6 で 45 桁 + zone id を考えると 64 でも十分だが、UA は 256 で**切り捨て発生**しブラウザ識別が壊れる事例あり。`text` 推奨。

### L-7. `react-query` 使うなら `staleTime`/`gcTime` のデフォルトと `dehydrate` 周りで**機微キャッシュの保持時間**を運用初期に固める（設計書 §17 Idle 30/15/10/5 分と矛盾しない値）。

### L-8. `package.json` に `"engines"` と `"packageManager"` を固定
- Supply chain 脆弱性の可観測性向上。

---

## 良い点（3 つ）

1. **`server-only` 境界が正しく設定されている**
   `db/client.ts:1` と `lib/supabase/server.ts:1` と `server/queries/dashboard.ts:1` で `import "server-only"` が宣言されており、サーバ側コードがクライアントバンドルに混入することを Next.js のビルドが拒否する。`SUPABASE_SERVICE_ROLE_KEY` を将来追加する際もこの境界が効く。

2. **Drizzle のクエリビルダで全クエリが parametrized**
   `server/queries/dashboard.ts:60-102` は `eq() / and() / gte() / lt() / sql<number>\`coalesce(sum(${...}), 0)\`` のテンプレ補間で、SQL injection を構造的に排除。`sql\`\`` の中も列参照のみで生文字列の差し込みはない。

3. **`audit_log` テーブル設計が hash chain + WORM 前提でしっかりしている**
   `db/schema.ts:213-241` で `prev_hash` / `hash` / `correlation_id` / `purpose` / `from_ip` / `from_ua` / `actor_user_id` を網羅。設計書 §17 / §26 のハッシュチェーン要件を**スキーマレベル**で受け止められる土台はできている。あとは書込み helper を実装するだけ（H-6）。

---

## 95+ 到達のための残ブロッカー

### Phase 1 — 基盤（必須）
1. **`middleware.ts` を root に追加**し、Supabase `getUser()` で全 `(app)` を保護（H-1）
2. **`app/auth/callback/route.ts` を実装** — `exchangeCodeForSession` + 同一 origin 限定 redirect（H-3）
3. **テナント分離レイヤを構築**（H-2）
   - `getCurrentOrgId()` / `requireOrg()` / `scopedDb(orgId)` の helper を `lib/auth/guard.ts` と `db/scoped.ts` に
   - Postgres 側で **RLS 有効化 + per-table policy**（Drizzle migration）
   - `getDashboardSnapshot` の引数から `orgId` を排除（内部解決）
4. **`next.config.ts` に Security Headers + nonce ベース CSP**（H-5）
5. **Server Action のレート制限 + 入力検証**
   - Upstash Ratelimit（IP+email バケット）
   - 全 Server Action に `zod.parse()` 必須化（共通 wrapper）
   - `auth.ts` のエラー文言は固定文字列に（H-4）
6. **監査ログの書込み helper 実装と全 Server Action からの呼出強制**（H-6）

### Phase 2 — 強化
7. PII マスク（§17.3）/ 表示権限階段（§26.2）の middleware 化
8. ABAC（§17.1）— `linkedin_account_owner` / `campaign_member` / `tag_scope` / `region` / `ip_range` の policy 化
9. CSV エクスポート前ダイアログ + 透かし + 7 日 URL 失効（§17.2）
10. DLP / 機微情報送信ブロック（§17.5）
11. Indirect Prompt Injection の Quarantine / `REVIEW_REQUIRED` 強制降格（§17.4 / §27.3）
12. デバイス管理 / Idle Timeout / 危険操作 2FA（§17）
13. `react@19` GA / `next@15.0.4+` への更新、ESLint security plugins 導入

### Phase 3 — 運用
14. `audit_log` の日次 root 署名（KMS）
15. WORM ストレージ（S3 Object Lock Compliance Mode）への外部化
16. Sentry / PostHog の DSAR 連携（§17.6）
17. ペネトレーションテスト（外注）+ 脅威モデル §26.1 の定期レビュー

これらを揃えれば、設計書 v1.3 §17/§26 と整合した **Security 95+/100** が見込める。現状は MVP スタブとして UI/データ取得層は良質だが、**認証・テナント分離・監査の運用機構**がほぼ未着手であり、本番投入には至っていない。

---

## 参考: 確認したファイル

- `app/layout.tsx`, `app/page.tsx`, `app/login/page.tsx`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`
- `components/app/sidebar.tsx`, `components/app/header.tsx`
- `components/dashboard/{nsm-hero,kpi-card,funnel,attention-list,activity-chart,recent-campaigns}.tsx`
- `components/ui/{button,state-chip,card,badge,skeleton}.tsx`
- `lib/{utils,formatters,state-machine}.ts`, `lib/supabase/{server,client}.ts`
- `db/{schema,client}.ts`
- `server/actions/auth.ts`, `server/queries/dashboard.ts`
- `next.config.ts`, `drizzle.config.ts`, `tsconfig.json`, `.eslintrc.json`, `.env.example`, `.gitignore`, `package.json`, `README.md`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §17, §26

`middleware.ts`, `app/auth/callback/route.ts`, `db/migrations/*` は**未存在を確認済み**（不在自体が H-1/H-3 の根拠）。
