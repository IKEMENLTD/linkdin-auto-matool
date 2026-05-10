# CTO Code Review — code-r3

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下 .ts / .tsx / .config.ts / .json
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §17 / §23 / §24
- 評価軸: Next.js 15 ベスプラ / 型安全 / 依存整合 / エラーハンドリング / コード構造
- 前回: `docs/reviews/code-r2/cto.md` (93 / 100, NEW HIGH 3 件)
- レビュー日: 2026-05-10

---

## 総合スコア — **94 / 100** (R2: 93, +1)

| 軸 | R1 | R2 | R3 | 差分 (R2→R3) | 主因 |
| --- | --- | --- | --- | --- | --- |
| 1. Next.js 15 ベストプラクティス | 14 | 18 | **18** | ±0 | middleware / `auth/callback` / `useActionState` / `instrumentation` / `error.tsx` / `loading.tsx` 揃う。一方 callback route で標準 `URL` に対して `.clone()` 呼び出し (= 実行時 TypeError) を新規混入 (-1)。Streaming 化未着手 (-1) |
| 2. 型安全 / Drizzle / TypeScript | 12 | 19 | **20** | +1 | `db.execute(sql\`select 1\`)` 化で `as never` を本リポから完全排除。`users.authUserId` (uuid + uniqueIndex) を schema に追加し、`getSession` を `eq(users.authUserId, user.id)` に切替。`Session` 型に `authUserId` フィールドを露出。drizzle 推論が一気通貫で通る |
| 3. 依存とバージョン整合 | 13 | 18 | **18** | ±0 | `@types/react@npm:types-react@rc` + overrides 維持。React 19 RC pin と Manrope/Geist/Geist Mono/Noto JP の 4 family は据置 (-2) |
| 4. エラーハンドリング / フォールバック | 15 | 19 | **19** | ±0 | health route の type-safe 化で外形監視の偽陰性は解消。一方 audit hash chain の race (NEW-M-2 R2) が未対応 / DB 障害 = mock fallback の SLO 矛盾 (NEW-M-1 R2) も据置 (-1) |
| 5. コード構造 / 再利用性 | 18 | 19 | **19** | ±0 | `getSession` が auth_user_id ベースの単一情報源に格上げ。一方 `server/actions/auth.ts:111` の `getCurrentUserSession` が `_email` を受けつつ常に null を返す死コードのまま放置 (-1) |

PASS (80+) 維持。**APPROVED (95+) 未達 (94)**。

---

## 1. R2 NEW HIGH 解消状況

| # | R2 NEW HIGH | 状態 | エビデンス |
| --- | --- | --- | --- |
| NEW-H-1 | `db.execute({sql,params} as never)` で型崩壊 + 実行時 TypeError | ✅ 完全解消 | `app/api/health/route.ts:2,19` `import { sql } from "drizzle-orm"` + `await db.execute(sql\`select 1\`)`。`as never` キャストは本リポ全域で 0 件 (`grep "as never"` 該当なし) |
| NEW-H-2 | Auth user → DB user 解決を email で行いクロステナント化けリスク | ✅ 完全解消 | `db/schema.ts:83` `authUserId: uuid("auth_user_id").notNull()` + `db/schema.ts:92` `uniqueIndex("users_auth_user_idx").on(t.authUserId)`。`lib/auth.ts:38` `where(eq(schema.users.authUserId, user.id))` に切替。`Session` 型に `authUserId` を露出 (`lib/auth.ts:8,45`)。コメントで「email ベース突合は禁止 (§17 ABAC)」を明文化 |
| NEW-H-3 | rate-limit がプロセス内 Map のためサーバレスで実質無効 | ✅ 解消 (条件付き) | `lib/rate-limit.ts:3-12` で「単一 Node プロセスでしか有効ではない」「Vercel / Cloudflare などサーバレス / 多インスタンス環境では効果が薄い」「本番では `@upstash/ratelimit` + Redis に置き換える (TODO: Phase2)」を冒頭で明記。実装は MVP として残置だが、出荷判断・運用判断の前提が文書化されたためレビュー観点では受容可 |

**R2 NEW HIGH 解消: 3 / 3** (NEW-H-3 はコード変更なしのコメント明記運用、設計書 §17 の MVP 段階判断と整合)。

---

## 2. R3 NEW HIGH (新規発見・出荷ブロッカー)

### NEW-H-1 (R3). `app/auth/callback/route.ts:10,21,28` — 標準 `URL` に対し存在しない `.clone()` を呼び実行時 TypeError

```ts
const url = new URL(request.url);   // ← 標準 URL (Web API)
...
const failed = url.clone();         // ← 標準 URL に .clone() は無い → TypeError
...
const dest = url.clone();
```

- Web 標準の `URL` には `.clone()` は存在しない (NextURL = `request.nextUrl` のみ独自実装)。**Magic Link の callback ルートで code 受領 → リダイレクト分岐の両方で TypeError が出てサインインフロー全体が破綻**する。本リポの auth ガードは middleware が前段で動くため、`/auth/callback?code=...` を踏む全ユーザがログインできない。
- 発火経路:
  1. ユーザがメールのマジックリンクをクリック → `/auth/callback?code=...&next=/dashboard`
  2. `exchangeCodeForSession` 成功 (or 失敗) → `url.clone()` を呼ぶ → `TypeError: url.clone is not a function`
  3. Next.js の `error.tsx` が表示され、ユーザは「インシデント番号」だけ見せられて永久にログインできない
- 推奨修正 (3 行):
  ```ts
  // 案 A: nextUrl を使う (NextURL は .clone() を持つ)
  const url = request.nextUrl;
  ...
  const failed = url.clone();

  // 案 B: 都度 new URL する
  const failed = new URL(request.url);
  failed.pathname = "/login";
  failed.search = `?error=${encodeURIComponent("auth_callback_failed")}`;
  return NextResponse.redirect(failed);
  ```
- 工数 0.05 day。CI に E2E (Playwright) で `/auth/callback` を踏むテストが無いことが根本原因。Phase2 で `playwright/auth.spec.ts` を追加すべき。
- なお `lib/supabase/middleware.ts:38,54,62` は `url = request.nextUrl` で NextURL を使っているため `.clone()` が成立する。ファイル間で `URL` と `NextURL` が混在しており、レビュアの見落としを誘発する形式。

---

## 3. R2 NEW MEDIUM の状況

| # | R2 項目 | 状態 | 備考 |
| --- | --- | --- | --- |
| NEW-M-1 | DB 障害時に 200 + mock を返し SLO 503 と矛盾 | ❌ 据置 | `server/queries/dashboard.ts:57` `if (!db || !orgId) return mockSnapshot()` のまま。`dashboard/page.tsx:46` の DEMO バナー追加で UX 上の透明性は確保 (+0.3) だが、`/api/health` は別系統で 503 を返すため監視不一致は残る |
| NEW-M-2 | audit hash chain が非トランザクション → race で分岐 | ❌ 据置 | `lib/audit.ts:44-82` の SELECT prev → INSERT が同一 `db.transaction` に入っていない。並列書き込みで chain 改竄耐性ゼロ |
| NEW-M-3 | `/api/health` を未認証で公開し DB 障害時刻を観測可能 | ⚠️ 部分改善 | body 構造は変えず、`X-Robots-Tag: noindex` と `Cache-Control: no-store` を追加。情報漏洩自体は解消していない |
| NEW-M-4 | CSP で `'unsafe-inline'` が production でも常時オン | ⚠️ 形式変更 | `Content-Security-Policy` → `Content-Security-Policy-Report-Only` に変更。enforcing が外れたため、**CSP は本番で何も止めない**状態。MVP 段階の段階的展開としては妥当だが、`X-Frame-Options: DENY` で clickjacking のみ enforce。なお `next.config.ts:29` の `isDev ? "...Report-Only" : "...Report-Only"` は両分岐同一の degenerate 三項演算子で意図不明 |
| NEW-M-5 | `PUBLIC_PATHS` の前方一致と `pathname !== "/login"` の重複判定 | ❌ 据置 | `lib/supabase/middleware.ts:50,53` |

---

## 4. R3 NEW MEDIUM

### NEW-M-1 (R3). `next.config.ts:29` — degenerate 三項演算子 `isDev ? "...Report-Only" : "...Report-Only"`

```ts
key: isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy-Report-Only",
```

- 両分岐とも同じ文字列を返しているため、`isDev` 分岐は意味を持たない。レビュアが「dev のみ Report-Only で本番は enforce」と読み違える原因。
- 推奨: 単に `key: "Content-Security-Policy-Report-Only"` にする。本番で enforce に切替える際は `isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"` を意図的に書く。

### NEW-M-2 (R3). `server/actions/auth.ts:75-91` — `getCurrentUserSession` が **死コード** で audit が常に書かれない

```ts
async function getCurrentUserSession(_email: string) {
  // MVP では信頼境界を保つため audit 書込みは「ログイン後」のみに集約。
  return null;  // ← 常に null
}
```

- 上位の呼び出し側 (`auth.ts:75-88`):
  ```ts
  const existing = await getCurrentUserSession(parsed.data.email);
  if (existing) {  // ← 常に false
    await writeAudit({ ... });
  }
  ```
- 結果として「signin_requested / signin_failed」の audit は **絶対に書かれない** (= 列挙攻撃の検知ログがゼロ)。R2 で「列挙攻撃を避けるためエラー文言を汎用化」する設計があるのに、攻撃検知側のログが落ちているのは矛盾。
- 推奨: `getCurrentUserSession` を削除し、callback route 側で `auth.signin_success` を 1 本書くように寄せる。または signin_requested 時点で IP+email_hash だけ別テーブル (`auth_attempts`) に書く方針に分離する。

### NEW-M-3 (R3). `db/schema.ts:83` `authUserId.notNull()` 但し既存 users 行のマイグレーション戦略が不在

- `auth_user_id uuid NOT NULL` をスキーマで宣言したが、`db/migrations/` には RLS 用 `0001_rls_phase2.sql` のみ。**既存環境への ALTER TABLE は drizzle-kit push 任せ**で、データ既在環境ではこの `notNull` が `NOT NULL violation` で失敗する。
- 推奨: `0002_users_auth_user_id.sql` を追加して以下を含める:
  1. `ALTER TABLE users ADD COLUMN auth_user_id uuid;`
  2. データバックフィル (`UPDATE users SET auth_user_id = (SELECT id FROM auth.users WHERE email = users.email);` のような Supabase 連携 SQL)
  3. `ALTER TABLE users ALTER COLUMN auth_user_id SET NOT NULL;`
  4. `CREATE UNIQUE INDEX users_auth_user_idx ON users(auth_user_id);`
- このマイグレーション無しで本番 deploy すると **users テーブルへの insert が即時失敗** する (新規シードを除く)。

---

## 5. LOW (仕上げ・据置)

- **NEW-L-1 (据置)** `app/login/page.tsx:91` / `components/dashboard/recent-campaigns.tsx:22` / `app/(app)/layout.tsx:3` で `React.ComponentType` / `React.ReactNode` を `import` なしで参照。`tsconfig.verbatimModuleSyntax: false` + Next.js 同梱型で辛うじて通るが、`true` 化した瞬間に死ぬ。`import type { ComponentType, ReactNode } from "react"` を明示。
- **NEW-L-2 (据置)** `app/(app)/layout.tsx` で `getSession()` を呼ばずに `Sidebar` 描画。`MobileSidebar` の `IK / IKEMENLTD` ハードコード残置。
- **NEW-L-3 (改善)** `lib/incident.ts:13` で `randomBytes(3)` (24bit) に変更。1日100件 6ヶ月想定で衝突率 ~0.1% まで低下。OK。
- **NEW-L-4 (据置)** `app/error.tsx:24-36` / `app/global-error.tsx:15-27` が IIFE で fallback ID を計算しているため、**毎レンダで異なる incident_id** になる。`useState(() => ...)` か `useMemo` 化してサポート照合可能に。
- **NEW-L-5 (据置)** `instrumentation.ts:18` の `request.headers` 直書き型。
- **NEW-L-6 (据置)** `db/client.ts:30` `__pg_shutdown__` の例外 swallow。
- **L-2 / L-4 / L-5 / L-6 / L-7 / L-8 / L-10 (据置)** R1 / R2 でも指摘済の sparkId / hydration / SSR 化 / verbatimModuleSyntax / images.remotePatterns。

---

## 6. 良い点 (R3 で進んだもの)

1. **`db.execute(sql\`select 1\`)`**: Drizzle の正しい API に揃え、`as never` を本リポから根絶。型安全軸で 19 → 20 にできた最大の要因。
2. **`users.authUserId` 導入と uniqueIndex**: Supabase Auth (`auth.users.id`) との UUID ベース紐付けが一意制約付きで実現。`getSession` 経由の参照が **クロステナントを物理的に作れない**形になった。設計書 §17 ABAC の subject = uuid 前提に整合。
3. **rate-limit 文書化**: 「単一 Node プロセスでしか有効ではない」「Phase2 で Upstash」を冒頭コメントに明記したことで、レビュアー / 運用者がコードを読んだ瞬間に MVP 制約を理解できる。コメントは契約。
4. **CSP Report-Only 化**: enforcing を一旦外して `report-uri /api/csp-report` で違反を集めにいく段階的な戦略は MVP として妥当 (Report-Only にする際は `Reporting-Endpoints` の併設 + report URI ハンドラの本実装が次の宿題)。
5. **incident_id を crypto 乱数 6 hex に**: 1/16M 衝突空間は MVP 段階の現実的妥協。

---

## 7. 95+ 到達のための残ブロッカー (優先順)

| # | ブロッカー | 軸 | 工数 |
| --- | --- | --- | --- |
| 1 | **NEW-H-1 (R3)** `auth/callback/route.ts` の `url.clone()` 修正 | Next.js | 0.05 day |
| 2 | NEW-M-1 (R3) CSP key の degenerate 三項を直す | Next.js | 0.02 day |
| 3 | NEW-M-2 (R3) `getCurrentUserSession` 死コード削除 + signin audit を callback 側に寄せる | エラー / Sec | 0.25 day |
| 4 | NEW-M-3 (R3) `0002_users_auth_user_id.sql` マイグレーション追加 | DB | 0.25 day |
| 5 | NEW-M-1 (R2) DB 障害を 503 化 (dev のみ mock) | エラー | 0.25 day |
| 6 | NEW-M-2 (R2) audit hash chain を `db.transaction` + `FOR UPDATE` | エラー / Sec | 0.25 day |
| 7 | M-1 / M-2 (R1) Streaming 化 (snapshot 4 分割 + Suspense + revalidateTag) | Next.js | 1.0 day |
| 8 | M-6 (R1) 4 family font → 2 family | 依存 | 0.25 day |
| 9 | NEW-L-1 〜 NEW-L-6 + L 残置 | 仕上げ | 0.25 day |

合計 **2.6 day** で 95-97 到達見込み。

特に **#1 (NEW-H-1 R3)** は出荷ブロッカー (Magic Link callback が 100% 失敗) で、**マージ前必須**。

---

## 8. 設計書 §23 整合チェック (差分)

| §23 項目 | R2 | R3 |
| --- | --- | --- |
| 23.1 ダッシュボード Streaming + revalidateTag 5min | ✗ | ✗ (据置) |
| 23.1 `/login` SSR | ✓ | ✓ |
| 23.2 キャッシュ命名 `tag:campaign:42` | ✗ | ✗ |
| 23.3 SSE | △ Phase2 | △ Phase2 |
| 23.5 状態管理 Zustand | △ | △ |
| 23.5 Lucide / date-fns | ✓ | ✓ |
| 23.5 Radix | △ | △ |
| 23.6 バンドル予算 180KB gzip | ✗ | ✗ (4 family font 据置) |
| §17 ABAC subject = uuid | ✗ | ✓ (`users.authUserId` で完全充足) |
| §17 監査改竄耐性 | ⚠️ | ⚠️ (hash chain 実装は正しいが race 残置) |

---

## 9. 95+ 判定

**判定: NEAR (94 / 100)**

- R2 で挙げた **NEW HIGH 3 件はすべて解消** (NEW-H-1 完全 / NEW-H-2 完全 / NEW-H-3 コメント明記運用)。型安全軸が 19 → 20 (満点) に到達したのは大きい。
- ただし **R3 で新規 NEW HIGH を 1 件発見** (auth callback の `url.clone()` 実行時 TypeError = Magic Link 100% 失敗)。これは **マージ前必須** 修正で、現状ではユーザがログインできない致命傷。修正コストは 0.05 day。
- これと NEW-M-1 〜 M-3 (R3) を 0.6 day で潰せば **R4 で 96-97 到達は確実**。
- マージ可否: NEW-H-1 (R3) 修正後ならば PASS (95+) を想定。現状単体では **NEAR**。

### 推奨アクション

1. **即時 (10分)**: `app/auth/callback/route.ts` の `url.clone()` を `request.nextUrl.clone()` か `new URL(request.url)` ベースに置換 → 再 push
2. **即時 (5分)**: `next.config.ts:29` の degenerate 三項を `key: "Content-Security-Policy-Report-Only"` に修正
3. **短期 (0.5 day)**: NEW-M-2 / NEW-M-3 (R3) + NEW-M-1 / NEW-M-2 (R2) を 1 PR で
4. **中期 (1.0 day)**: §23.1 Streaming 化 (M-1 / M-2 R1)
5. その後 R4 レビューで PASS 判定想定 (96-97 / 100)

---

## Verdict: **NEAR (94 / 100), マージ前 NEW-H-1 (R3) 必須対処**

R2 から +1 点。R2 NEW HIGH 3 件はすべて解消。一方 R3 で auth callback の runtime crash を新規発見。
これ単体を 5 分で塞げば PASS、塞がなければ Magic Link がそもそも動かないため出荷不可。
