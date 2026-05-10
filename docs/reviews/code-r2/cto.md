# CTO Code Review — code-r2

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下 .ts / .tsx / .css / .json / .config.ts
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §17 / §23 / §24
- レビュー観点: Next.js 15 ベスプラ / 型安全 / 依存整合 / エラーハンドリング / コード構造
- 前回: `docs/reviews/code-r1/cto.md`(72/100, HIGH 9件)
- レビュー日: 2026-05-10

---

## 総合スコア — **93 / 100**（R1: 72 / +21）

| 軸 | R1 | R2 | 差分 | 主因 |
| --- | --- | --- | --- | --- |
| 1. Next.js 15 ベストプラクティス | 14 | **18** | +4 | middleware による auth ガード / `auth/callback` route + PKCE / `useActionState` 化 / SignInForm Client 分割 / `instrumentation.ts` / `error.tsx` / `loading.tsx` / `health` route まで実装。Streaming は依然弱い (-2) |
| 2. 型安全 / Drizzle / TS strict | 12 | **19** | +7 | `as never` 全廃、`primaryKey({columns})` 化、`Skeleton`/`Badge` で `import * as React` 復帰、`mode:"date"` 型キャスト健全化、`SignInState` で Action 戻り値が型契約。`/api/health` の `db.execute({sql,...} as never)` のみ残 (-1) |
| 3. 依存とバージョン整合 | 13 | **18** | +5 | `@types/react@npm:types-react@rc` + `overrides`、Tailwind v4.1.0 GA、`typedRoutes:false` で型導線整合。React 本体は依然 RC pin (-1) / 4 family font は未削減 (-1) |
| 4. エラーハンドリング / フォールバック | 15 | **19** | +4 | `error.tsx` / `global-error.tsx` / `not-found.tsx` / `(app)/loading.tsx` / `instrumentation.onRequestError` / `incident.ts` / `audit.ts` (hash chain) / rate-limit / Server Action zod safeParse + 列挙耐性 / Open Redirect 対策。Sentry 未配線 (-1) |
| 5. コード構造 / 再利用性 | 18 | **19** | +1 | `SignInForm`/`SubmitButton` の責務分割が綺麗、`getSession`/`requireSession` で auth が一元化。`activityCurr` の集計手法の不統一は残置 (-1) |

PASS (80+) 達成、APPROVED (95+) **未達** (93)。

---

## 1. R1 HIGH の解消状況

| # | R1 HIGH | 状態 | エビデンス |
| --- | --- | --- | --- |
| H-1 | `/auth/callback` 未実装 + auth ガード皆無 | ✅ 解消 | `app/auth/callback/route.ts` で `exchangeCodeForSession` 実装、`next` 同一 origin 限定の Open Redirect 対策あり / `middleware.ts` + `lib/supabase/middleware.ts` で `(app)` 配下を未認証時 `/login?next=...` へ |
| H-2 | Server Action 戻り値が UI に来ない | ✅ 解消 | `components/auth/sign-in-form.tsx:24` `useActionState<SignInState, FormData>` + `useFormStatus` で pending / message / field を画面表示。状態型 `SignInState` 明示 |
| H-3 | `typedRoutes:true` × `as never` で型破壊 | ✅ 解消 | `next.config.ts:45` `typedRoutes: false` に統一、`sidebar.tsx` から `as never` 全削除 |
| H-4 | `dailyMetrics` 複合 PK 欠落 | ✅ 解消 | `db/schema.ts:14, 212` `primaryKey({ columns: [t.orgId, t.day] })`、`day` も `date("day", { mode: "date" })` に変更（旧 timestamp から date 型へ）|
| H-5 | `mode:"date"` カラムを `as unknown as string` | ✅ 解消 | `server/queries/dashboard.ts:197` `r.day instanceof Date ? r.day : new Date(r.day as string)` で型ガード化、formatISO に Date を渡す |
| H-6 | DB 未接続と orgId 未取得を同一視 | ⚠️ 部分解消 | `app/(app)/dashboard/page.tsx:25` `getSession()` から実 `orgId` を渡す形に変更、middleware で `(app)` 配下は未認証なら `/login` 強制。一方 `dashboard.ts:57` の `if (!db || !orgId) return mockSnapshot()` 自体は据置。本番で middleware 通過後は `orgId` が必ず入るため副作用は減ったが、「DB 障害 = mock fallback」の設計上の歪みは残（後述 NEW-M-1）|
| H-7 | `Skeleton`/`Badge` 等で `React` 名前空間未 import | ✅ 解消 | `skeleton.tsx:1` `import * as React from "react"`、`badge.tsx:1` 同。`login/page.tsx:91` の `Trust` が `React.ComponentType` を参照しているが、`recent-campaigns.tsx:22` でも同パターンで未 import。後述 NEW-L-1 |
| H-8 | `@types/react@18` × React 19 RC | ✅ 解消 | `package.json:36-37` `npm:types-react@rc` / `npm:types-react-dom@rc`、`overrides` で他 lib への伝播もカバー。`useActionState` import が解決可能 |
| H-9 | Tailwind v4 alpha pin | ✅ 解消 | `package.json:34, 42` `tailwindcss@^4.1.0` / `@tailwindcss/postcss@^4.1.0` GA 系へ昇格 |

**HIGH 解消: 9 / 9 (うち 1 件は部分解消)**

---

## 2. NEW HIGH（R2 で発見・マージ前必須）

### NEW-H-1. `app/api/health/route.ts:18` — `db.execute({ sql, params } as never)` の型崩壊と実行時エラー

```ts
await db.execute({ sql: "select 1", params: [] } as never);
```

- Drizzle の `db.execute()` は `SQLWrapper`（`sql\`select 1\``）を期待する。`{ sql, params }` オブジェクト形式は postgres-js のクライアント API であり、Drizzle の wrapper を介すと runtime で `TypeError: query.toSQL is not a function` を投げる可能性が高い。`as never` で型検査をすり抜けているため、ユニットテスト不在のまま本番投入されると **`/api/health` が常に 503** を返す（外形監視がフォールスアラート）。
- 推奨:
  ```ts
  import { sql } from "drizzle-orm";
  await db.execute(sql`select 1`);
  ```
- 同時に `NEXT_PUBLIC_REGION` を **public 露出**しているのは設計書 §17 の最小公開原則と矛盾（リージョンは `process.env.REGION` server only で十分）。

### NEW-H-2. `lib/auth.ts:37` — Supabase user → DB user の解決を **email** で行っている（衝突 / なりすましリスク）

```ts
.where(eq(schema.users.email, user.email ?? ""))
```

- Supabase Auth のユーザ識別子は `auth.users.id`（uuid）。**email ベース join はテナント間の email 重複時に別 org のユーザに化ける**（特に Magic Link は `shouldCreateUser:true` のため、別 org の同一 email がぶつかる）。
- 加えて Supabase 側で email change が走ると、DB `users.email` と乖離して **誰でもなくなる**。Auth レイヤと業務 DB の唯一の紐付けが email 文字列なのは ABAC §17 の前提（`subject = uuid`）に反する。
- 推奨:
  - `db/schema.ts users` に `auth_user_id uuid` カラム（`unique`、Supabase auth.users.id を保持）を追加
  - `lib/auth.ts` で `eq(users.authUserId, user.id)` に切替
  - 既存 email カラムは表示用 / 通知用に残す
- マイグレーションを伴うので 0.5 day。

### NEW-H-3. `lib/rate-limit.ts` — プロセス内 Map のため Vercel/サーバレスで実質無効

```ts
const buckets = new Map<string, ...>();
```

- Next.js を Vercel / Cloudflare Pages / Render(serverless) で動かす前提なら、各インスタンスが独立した Map を持つ。**`signIn 5 / 5min` は最悪 N インスタンス × 5 = N×5 まで通る**。Magic Link 連打スパム / 列挙攻撃の防御線として機能しない。
- ファイル冒頭 (`lib/rate-limit.ts:4`) で「本番では Upstash に置換」と但し書きはあるが、`server/actions/auth.ts:48` の本番パスから既に呼ばれている。**本番 to do を本番コードに据えたままレビューを通すのは出荷不可**。
- 推奨:
  - Upstash Redis の `@upstash/ratelimit` を入れる、または
  - Supabase Auth 側のレート制限（`gotrue` の rate limit 設定）にも依存させる二重防御
  - 短期的には `process.env.UPSTASH_REDIS_REST_URL` 必須チェック → 未設定なら警告ログ + メモリへフォールバック（dev only）

---

## 3. R1 残置 MEDIUM の状況

| # | R1 項目 | 状態 |
| --- | --- | --- |
| M-1 | `force-dynamic` + `revalidate=0` 冗長 + revalidateTag 不在 | ❌ 据置（`dashboard/page.tsx:14-15`）|
| M-2 | Suspense が NSM hero しか包まない / Streaming 不全 | ❌ 据置（KPI/Funnel/Activity/Recent は同期 await のまま）|
| M-3 | Supabase cookie set 例外を無音 catch | ❌ 据置（`server.ts:24` / `middleware.ts` ともに silent）|
| M-4 | `globalThis.__pg__` シングルトン NODE_ENV ガード | ⚠️ 改善（`__pg_shutdown__` ガード、`max_lifetime` 追加で接続漏れ抑止）。 dev/prod 分離コメントは未 |
| M-5 | activity 集計手法の不統一 | ❌ 据置（`activityCurr` は明細 + JS reduce、`activityPrev` は SUM）|
| M-6 | 4 family font | ❌ 据置（`app/layout.tsx:5-28`）|
| M-7 | 未使用 dep (zustand/motion/react-query) | ❌ 据置 |
| M-8 | `numeric` import 死蔵 | ✅ 解消（`db/schema.ts` に `numeric` import なし）|
| M-9 | `<a href>` の `next/link` 化 | ✅ 解消（`recent-campaigns.tsx:1` / `attention-list.tsx:1` Link 使用）|
| M-10 | live モードの `recent` / `attention` 空配列 | ✅ 解消（`dashboard.ts:138-170, 234-292` で実 SQL 実装）|
| M-11 | `organizations` に `updatedAt` 無し | ❌ 据置 |
| M-12 | tone soft / strong が同色に collapse | ❌ 据置（`state-machine.ts:78-91`）|
| M-13 | `app/page.tsx` の auth チェック | ✅ 解消（middleware が前段で処理）|

解消: 4 / 13。Streaming・Cookie ロギング・Font 軽量化が次スプリントの主要債務。

---

## 4. NEW MEDIUM（R2 で発見）

### NEW-M-1. `server/queries/dashboard.ts:57` — DB 障害時に 200 + mock を返す設計が 503 SLO と矛盾

```ts
if (!db || !orgId) return mockSnapshot(rangeDays);
```

- middleware で auth 強制になったため、`(app)/dashboard` 到達時 `orgId` が null になるのは事実上「セッション期限切れ + middleware 通過のレースコンディション」のみ。実運用上は `!db`（= `DATABASE_URL` 未設定）が主に発火する。
- 設計書 §24.1（API 可用性 99.9%）は **DB 障害を 503 として観測**することを前提にしている。200 + mock を返すと SLO 監視が緑のまま、ユーザにはサンプル値が出る = **信頼破壊**。
- 推奨: 
  ```ts
  if (!orgId) redirect("/login");
  if (!db) {
    if (process.env.NODE_ENV !== "production") return mockSnapshot(rangeDays);
    throw new Error("DB unavailable"); // → app/(app)/error.tsx で 5xx 表示
  }
  ```

### NEW-M-2. `lib/audit.ts:64` — hash chain が **非トランザクション**で race condition

- `select prev_hash → compute hash → insert` の 3 段が同一 `BEGIN/COMMIT` に入っていない。並列リクエストが走ると、2 つの insert が同じ `prev_hash` を参照して挿入され、**チェーンが分岐** する（hash chain の改竄耐性がゼロ）。
- 推奨:
  ```ts
  await db.transaction(async (tx) => {
    const [prev] = await tx.select(...).for("update");  // SELECT FOR UPDATE
    ...
    await tx.insert(...);
  });
  ```
- 加えて `audit_log` に `(orgId, createdAt) DESC` を `for update skip locked` で取りに行く際、`createdAt` だけだとミリ秒衝突で順序が揺れる。**単調増加 `seq bigserial`** を別カラムに持つほうが堅い。

### NEW-M-3. `app/api/health/route.ts` — Auth check 不在で外部から DB 状態を観測可能

- `/api/health` は middleware の `PUBLIC_PATHS` に含まれており、認証なしで `degraded`/`operational` を返す。攻撃者は **DB 障害発生のタイミングをポーリング監視**してターゲット時刻を特定できる。
- 推奨: 公開する body は `{ status: "operational" | "degraded" }` のみに削り、`services.db` の詳細は `?token=...` か内部 IP からのみ。

### NEW-M-4. `next.config.ts:24-38` CSP — `'unsafe-inline'` が production でも常時オン

```ts
`script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'unsafe-inline'"}`,
```

- 設計書 §17 / §26 は MVP で `'unsafe-inline'` を許容する旨が書いてあるが、これは React 19 + Next.js 15 では **本来 nonce で解消できる**（`next.config.ts` の `experimental.serverActions` + `headers.nonce`、または `unstable_after` で nonce 注入）。
- かつ `style-src` の `'unsafe-inline'` は Tailwind v4 の `@theme` 解決には不要（Next.js が CSS を hash して提供）。
- 推奨: Phase2 で nonce 化、本 PR では `Content-Security-Policy-Report-Only` で先行レポート → `Reporting-Endpoints` を併設して mode 移行の準備。

### NEW-M-5. `lib/supabase/middleware.ts:38` — PUBLIC_PATHS の前方一致が緩く `/loginabc` も許可

```ts
const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
```

- これ自体は正しいが、`pathname !== "/login"` の重複判定（行 42）と整合が取れておらず、未来の編集で容易に矛盾する。
- 推奨: `PUBLIC_PATHS` を `Set` 化し `pathname.startsWith(p + "/")` のみにそろえる。または regex `/^(\/login|\/auth\/callback|\/legal|\/api\/health|\/_next|\/favicon)(\/.*)?$/` で 1 行化。

---

## 5. LOW（仕上げ）

- **NEW-L-1** `app/login/page.tsx:91`、`components/dashboard/recent-campaigns.tsx:22`、`app/error.tsx:11` — `React.ComponentType` / `React.ReactNode` を参照しているが `import` していない。`tsconfig.json` の `verbatimModuleSyntax:false` と Next.js の types で **辛うじて通る** が、`true` 化した瞬間に死ぬ。`import type { ComponentType, ReactNode } from "react"` を明示。
- **NEW-L-2** `app/(app)/layout.tsx` — `getSession()` を呼ばずに `Sidebar` を描画。`MobileSidebar` が `org name` をハードコード（`IK / IKEMENLTD`）。実セッション値を渡す導線を立てる。
- **NEW-L-3** `lib/incident.ts:9` — `Math.floor(Math.random() * 9000) + 1000` で連番を擬似発番しているが、衝突確率 1/9000 は本番 6 ヶ月で必ず重複する。`createId()`（cuid2）か `auditLog` に `INC-` 連番テーブルを別建てに。
- **NEW-L-4** `app/error.tsx:23` / `global-error.tsx:16` — `digest` が無いとき毎レンダで `Math.random()` を呼ぶ。同じエラーが 2 回描画されると **異なるインシデント番号**になり、サポート窓口で照合不能。`useMemo(() => digest ?? newId(), [digest])` 化。
- **NEW-L-5** `instrumentation.ts:18` — `onRequestError` の `request.headers` 型が `Record<string, string | string[] | undefined>` 直書き。Next.js 公式型 `import type { Instrumentation } from "next"` から取るほうが版管理に強い。
- **NEW-L-6** `db/client.ts:30` — `globalThis.__pg__?.end({ timeout: 5 })` の例外を全部 swallow。`process.exitCode = 1` を明示しないと `node` プロセスが exit しないケースあり。
- **L-2 残置** `kpi-card.tsx:84` `sparkId = \`spk-${label.replace(/\s+/g, "-")}\`` がサーバ複数描画で衝突する可能性。日本語ラベルを ID にしているため CSS escape も必要。`useId()` 化。
- **L-4 残置** `login/page.tsx:54` `© {new Date().getFullYear()}` の hydration mismatch リスク（年末年始）。
- **L-5 残置** `funnel.tsx:1` `"use client"` だが `onClick` 等なし。SSR 化で bundle 削減可。
- **L-6 残置** `recent-campaigns.tsx` のモバイル grid 崩れ。
- **L-7 残置** `formatters.ts:32` `previous === 0` の delta UX。なお `kpi-card.tsx:75-77` で「新規」表示の対応が入った（部分解消）。
- **L-8 残置** `verbatimModuleSyntax: false`。
- **L-10 残置** `images.remotePatterns` 未定義。

---

## 6. 良い点

1. **`middleware.ts` + `lib/supabase/middleware.ts` の auth ガード**: `getAll/setAll` の新 API を正確に踏襲、`PUBLIC_PATHS` で公開パスを集中管理、`next` query で deep link 復帰可。Next.js 15 + Supabase ssr 0.6 の現代的な実装。
2. **`SignInForm` の責務分離**: `useActionState` + `useFormStatus` で React 19 のフォーム制御を素直に使い、`SubmitButton` を **別 component** に切ることで `useFormStatus` の親再描画を避けている。`SignInState` が action 戻り値型を契約化、`INITIAL_SIGN_IN_STATE` をエクスポート。教科書的に綺麗。
3. **`server/actions/auth.ts` の防御的設計**: zod で `email` を `trim/min/max(254)/email()` 検証、レート制限を `signin:${ip}:${email}` で IP+メール複合キー、Supabase エラーを **列挙攻撃を避けるため汎用文言で返す** という意図がコメントに明記。CTO 観点で意図が読める。
4. **`auth/callback/route.ts` の Open Redirect 対策**: `nextRaw.startsWith("/") && !nextRaw.startsWith("//")` で同一 origin の path 限定。`exchangeCodeForSession` 失敗時は `/login?error=auth_callback_failed` に飛ばす UX 配慮あり。
5. **`db/client.ts` の運用配慮**: `connect_timeout` / `max_lifetime` / `prepare:false` のコメント付与（Supabase pooler）/ SIGTERM/SIGINT 終了処理。MVP 段階で本番運用知見が織り込まれている。
6. **`app/error.tsx` / `global-error.tsx` / `not-found.tsx` / `(app)/loading.tsx`** が一式揃った: incident_id をユーザに提示 + コピー導線。設計書 §12.3.1 の要件を充足。
7. **`lib/audit.ts` の hash chain 設計**: `prev_hash || normalized JSON` を SHA-256 する append-only。コンセプトは正しい（実装の race だけ NEW-M-2 で指摘）。
8. **`db/schema.ts` の `primaryKey({ columns })` 移行 + `date("day", { mode: "date" })`**: Drizzle の正しい書法。`auditLog` に `prevHash` / `hash` / `correlationId` を持つのも改竄耐性の主旨に合致。

---

## 7. 95+ 到達のための残ブロッカー（優先順）

| # | ブロッカー | 軸 | 工数 |
| --- | --- | --- | --- |
| 1 | NEW-H-1 `db.execute(sql\`select 1\`)` 修正 | 型 / Next.js | 0.1 day |
| 2 | NEW-H-2 `users.authUserId` 追加 + email→uuid join 切替 | 型 / Sec | 0.5 day |
| 3 | NEW-H-3 Upstash Ratelimit 導入 | エラー / Sec | 0.5 day |
| 4 | NEW-M-1 DB 障害を 503 化（dev のみ mock） | エラー | 0.25 day |
| 5 | NEW-M-2 audit hash chain を `db.transaction` + `FOR UPDATE` | エラー / Sec | 0.25 day |
| 6 | M-1 / M-2 Streaming 化（snapshot 4 分割 + Suspense 4 箇所 + revalidateTag） | Next.js | 1.0 day |
| 7 | M-3 Supabase cookie set 例外をログ化 | エラー | 0.1 day |
| 8 | M-6 4 family font → 2 family（Manrope + Noto JP）+ Geist 削除 | 依存 | 0.25 day |
| 9 | M-7 未使用 dep（zustand/motion/react-query）削除 or Phase2 lock | 依存 | 0.1 day |
| 10 | M-12 tone soft/strong の濃淡分離 | UX | 0.1 day |
| 11 | NEW-L-1 〜 NEW-L-6 + L 残置 | 仕上げ | 0.25 day |

合計: **3.4 day** で 95+ 到達見込み（93 → 96-97）。

---

## 8. 設計書 §23 整合チェック（差分）

| §23 項目 | R1 | R2 |
| --- | --- | --- |
| 23.1 ダッシュボード Streaming + revalidateTag 5min | ✗ | ✗（M-1/M-2 据置）|
| 23.1 `/login` SSR | ✓ | ✓ |
| 23.2 キャッシュ命名 `tag:campaign:42` | ✗ | ✗ |
| 23.3 SSE | △ Phase2 | △ Phase2 |
| 23.5 状態管理 Zustand | △ | △ |
| 23.5 Lucide / date-fns | ✓ | ✓ |
| 23.5 Radix | △ | △ |
| 23.6 バンドル予算 180KB gzip | ✗ | ⚠️ Manrope/Geist/Geist Mono/Noto JP の 4 family が残るので未達 |
| §17 ABAC subject = uuid | △ | ✗（NEW-H-2 で email join に依存）|
| §17 監査改竄耐性 | △ | ⚠️（hash chain は実装、トランザクション境界欠落）|

---

## Verdict: **NEEDS REVISION（条件付き）**

- R1 HIGH 9 件中 **9 件解消**（うち H-6 は半解消）。+21 点で **93 / 100** に到達。
- 一方 R2 で **NEW HIGH 3 件**（DB health の `as never`、Auth join の email キー、rate-limit のメモリ実装）を新規発見。これらは設計書 §17 ABAC / §24 SLO に直結する出荷ブロッカー。
- 上記 3 件 + Streaming 化（M-1/M-2）を片付ければ **95-97 / 100** が確実。残工数 **約 3.4 day**。
- 結論: **マージ前に NEW-H-1 / NEW-H-2 / NEW-H-3 の 3 件のみ必須対処**、それ以外は MEDIUM 整理の上 r3 で APPROVED 想定。
