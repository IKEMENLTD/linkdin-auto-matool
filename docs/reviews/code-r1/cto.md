# CTO Code Review — code-r1

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下 .ts / .tsx / .css / .json / .mjs / .config.ts
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §23 技術選定マトリクス
- レビュー観点: Next.js 15 ベスプラ / 型安全 / 依存整合 / エラーハンドリング / コード構造
- レビューアー: CTO (Next.js 15 + React 19 + Drizzle + Supabase 担当)
- レビュー日: 2026-05-09

---

## 総合スコア — **72 / 100**（PASS 条件: 80+ / APPROVED 条件: 95+）

| 軸 | スコア | 主因 |
| --- | --- | --- |
| 1. Next.js 15 ベストプラクティス（RSC / Server Action / dynamic / streaming） | **14 / 20** | `force-dynamic` と `revalidate=0` の冗長指定、Suspense 配置不全、Server Action の戻り値が UI に伝わらない、`redirect()` をサーバ側で行うべき箇所での欠落、`auth/callback` ルート未実装 |
| 2. 型安全 / TS strict / Drizzle 型 / スキーマ整合 | **12 / 20** | `as never`, `as unknown as string` で型システムを 2 箇所欺瞞、`Skeleton` / `Badge` で `React` 名前空間が未 import、`dailyMetrics` 複合 PK 未宣言、`numeric` import 死蔵、`STATE_META` の tone 値と `globals.css` の Tailwind v4 token のブリッジ未確認 |
| 3. 依存とバージョン整合（peer / React 19 / Tailwind v4） | **13 / 20** | React 19.0.0-rc に対し `@types/react@18.x` 固定、`tailwindcss@4.0.0-alpha.36` で alpha チャネル固定、`server-only` を import するが package.json に明示なし、`next/font/google` を 4 ファミリ同時読込で初期化コスト過大、`motion`/`zustand`/`@tanstack/react-query`/`zod` などインストール済みだが MVP コードで未使用 |
| 4. エラーハンドリング / フォールバック設計 | **15 / 20** | DB 未接続 / `orgId === null` を等価扱い、Auth 未連携で **本番でも常に mock** が返る、Supabase server cookie set の例外を無音 catch、Server Action 失敗時のエラー UI 不在、Drizzle クエリの `try/catch` ゼロ |
| 5. コード構造 / 再利用性 / コード匂い | **18 / 20** | 比較的綺麗。`components/ui/*` は shadcn 互換でよくまとまっている。一方で `dashboard/page.tsx` の Suspense fallback が hero 1 つだけ、`Funnel` `KpiCard` の I/O 型が `server/queries/dashboard.ts` の戻り型と二重定義、`<a href>` が `next/link` 化されていない箇所多数 |

---

## 1. HIGH（マージ前に必須対処）

### H-1. `app/page.tsx:1-5` & `app/login/page.tsx` — Magic Link コールバックルートが未実装

```ts
// server/actions/auth.ts:16
emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`,
```

- `/auth/callback` Route Handler が `app/auth/callback/route.ts` に存在しない（`Glob: app/auth/**` で 0 ヒット）。
- マジックリンクをクリックすると Supabase は `?code=...` でこのパスに戻すが、404 が返る → セッション cookie が確立されず、ログイン全体が機能しない。
- `app/page.tsx` も `/dashboard` にリダイレクトするだけで、未認証チェックを行わないため、未ログインで `/dashboard` を直叩きしても `(app)/layout.tsx` が無条件描画される。Auth ガードが**ゼロ**。
- 推奨:
  ```ts
  // app/auth/callback/route.ts
  import { NextResponse } from "next/server";
  import { createSupabaseServer } from "@/lib/supabase/server";

  export async function GET(req: Request) {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (code) {
      const supabase = await createSupabaseServer();
      await supabase.auth.exchangeCodeForSession(code);
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  ```
  併せて `(app)/layout.tsx` で `supabase.auth.getUser()` → 未認証なら `redirect("/login")`。

### H-2. `app/login/page.tsx:30` & `server/actions/auth.ts:6` — Server Action の戻り値が UI に到達せず、エラーが画面に出ない

```tsx
// app/login/page.tsx
<form action={signInWithMagicLink} className="space-y-3">
```

```ts
// server/actions/auth.ts
return { ok: false, error: "メールアドレスを入力してください" } as const;
```

- `<form action={fn}>` で直接 Server Action を渡すパターンでは戻り値は捨てられる。**React 19 の `useActionState`（旧 `useFormState`）** を使うか、Action 内で `redirect("/login?err=empty")` する必要がある。
- 現状、空メール / Supabase エラー時に **画面が無反応**（送信ボタン押下後 → 何も起きない）。本番ローンチブロッカー。
- 推奨:
  ```tsx
  "use client";
  const [state, action] = useActionState(signInWithMagicLink, { ok: true });
  return <form action={action}>{!state.ok && <p>{state.error}</p>}...</form>;
  ```
- 同時に `signInWithMagicLink` の戻り値型を `Promise<{ok:true} | {ok:false; error:string}>` に固定し、initialState と一致させる。

### H-3. `next.config.ts:5-7` + `components/app/sidebar.tsx:82,127` — `experimental.typedRoutes` を有効化しつつ `as never` で型を破壊

```ts
// next.config.ts
experimental: { typedRoutes: true },
```
```tsx
// sidebar.tsx
<Link href={item.href as never} ...>
```

- `typedRoutes` を有効にすると `Link.href` は `Route<string>`（リテラル合成）型になる。`item.href: string` を渡せないため `as never` で潰しているが、これは「タイポ検知」という機能の唯一の利点を 100% 殺している。
- 副作用: `/connections/linkedin` のようなネスト URL を typed route で検証できず、後続画面追加時の規律が崩壊する。
- 推奨: `NavItem.href` を `Route` 型で受ける（`import type { Route } from "next"`）か、`typedRoutes` を一旦 `false` に。前者を推奨。

### H-4. `db/schema.ts:209` — `dailyMetrics` に複合主キーが未宣言（`uniqueIndex` のみ）

```ts
(t) => ({ pk: uniqueIndex("dm_pk").on(t.orgId, t.day) })
```

- `uniqueIndex` は UNIQUE 制約相当だが PK ではない（NULL 許容、`PRIMARY KEY` 専用最適化が利かない、Supabase RLS の `using (auth.uid() = ...)` パターンで PK を期待するクエリが壊れる）。
- 推奨:
  ```ts
  import { primaryKey } from "drizzle-orm/pg-core";
  // ...
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.day] }) })
  ```
- 併せて `migrations/` ディレクトリが空（`drizzle-kit generate` 未実行）。`db:push` だけでスキーマ反映している運用は本番で監査が取れないので、CI 導入時に `db:generate` を必須化。

### H-5. `server/queries/dashboard.ts:127` — `mode: "date"` カラムを `as unknown as string` で扱う型崩壊

```ts
const key = formatISO(new Date(r.day as unknown as string), { representation: "date" });
```

- `timestamp("day", { mode: "date" })` の Drizzle 推論は `Date`。`as unknown as string` → `new Date(string)` の二重キャストはタイムゾーン解釈を壊す（特にサーバ TZ ≠ JST のとき、`startOfDay`/`subDays` で組んだキーと `formatISO(d, {representation: "date"})` のキー文字列が +1 / -1 日ズレる）。
- バグの臨床症状: ダッシュボードの最新日付列が常に空、または 2 日連続で同じ値。
- 推奨:
  ```ts
  const key = formatISO(r.day as Date, { representation: "date" });
  ```
  さらに `daily.map((d) => d.date)` 側も TZ 統一（`Asia/Tokyo` 固定 or UTC 固定）を `lib/time.ts` に切り出す。

### H-6. `server/queries/dashboard.ts:51` — 「DB 未接続」と「orgId 未取得」を同一視して常に mock を返す

```ts
if (!db || !orgId) {
  return mockSnapshot(rangeDays);
}
```

そして呼び出し元:
```ts
// app/(app)/dashboard/page.tsx:27
const snapshot = await getDashboardSnapshot(null, days);
```

- 本番で Supabase 認証が通っていても **`null` を固定で渡しているため永遠に mock**。`source === "mock"` の DEMO バナーは出るが、これは「未実装」を露呈する仕様であって、CTO 観点では出荷不可。
- 加えて `db` 取得失敗（DB 一時障害）と「auth 未連携」は意味が違う。前者は 503、後者は redirect が正しい。一括 fallthrough は SLO（§24.1 API 可用性 99.9%）にも嘘をつくことになる（503 を返すべきところを 200 + mock）。
- 推奨:
  ```ts
  if (!orgId) redirect("/login");
  if (!db) throw new ServiceUnavailableError("DB unavailable");
  ```
  かつ `dashboard/page.tsx` 側で `auth.getUser()` から `orgId` を取得し渡す。

### H-7. `components/ui/skeleton.tsx:3` & `components/ui/badge.tsx:19` ほか — `React.HTMLAttributes` を `import * as React` 抜きで参照（type のみだが TS strict + verbatimModuleSyntax 移行で破綻）

```tsx
// skeleton.tsx
import { cn } from "@/lib/utils";
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) { ... }
```

- 現状 `tsconfig.json:18` は `"verbatimModuleSyntax": false` のため辛うじて通るが、`strict: true` + `tsc --noEmit` で `Cannot find namespace 'React'.` を吐く環境が存在する（特に React 19 の new JSX transform / 一部の `@types/react`）。
- `app/login/page.tsx:105` の `Trust` 関数も `React.ComponentType` を使うが `React` を import していない。同症状。
- 推奨: `import type { HTMLAttributes, ComponentType } from "react"` を各ファイルに足す（最小修正）。または `"verbatimModuleSyntax": true` を導入し型 import を強制する。

### H-8. `package.json:35-36` — `@types/react@^18.3.12` が React 19 RC と乖離

```json
"react": "19.0.0-rc-66855b96-20241106",
"@types/react": "^18.3.12",
"@types/react-dom": "^18.3.1",
```

- React 19 では `useActionState` / `use()` / `<form action={fn}>` の型が拡張されている。`@types/react@18` のままでは H-2 の修正で `useActionState` import が解決できない。
- 推奨: `@types/react@npm:types-react@rc`, `@types/react-dom@npm:types-react-dom@rc`（Next.js 15 公式アップグレードガイドの手順）。`package.json` の `overrides` で他 lib の peer 解決も整える。
- 併せて React RC の commit pin（`19.0.0-rc-66855b96-20241106`）は数日で陳腐化する。`19.0.0` GA 安定版（2024-12 リリース済）に上げるべき。

### H-9. `package.json:41` — Tailwind v4 `alpha.36` 固定で alpha チャネル依存

```json
"tailwindcss": "^4.0.0-alpha.36",
"@tailwindcss/postcss": "^4.0.0-alpha.36",
```

- `@theme` ブロック / `@import "tailwindcss"` 自体は v4 系で動作するが、alpha → beta → rc で `@theme` の継承や `var(--color-*)` の解決が変わるため、`text-brand-700` が beta で **生成されないリスク**。
- `lib/state-machine.ts:78-91` の `TONE_CLASS` は `text-brand-700` 等 utility に依存しているが、Tailwind v4 では `@theme` の `--color-brand-700` から `bg-brand-700`/`text-brand-700` が自動生成される仕様。`alpha.36` でこの仕様が確定しているか確認必須。確定していなければ全 chip が無色になる。
- 推奨: `tailwindcss@4.0.0`（GA 済）にアップグレード、その上で `pnpm dev` で `chip` の色が出ることを目視確認。

---

## 2. MEDIUM（次スプリントで解消）

### M-1. `app/(app)/dashboard/page.tsx:15-16` — `force-dynamic` と `revalidate = 0` の冗長指定

```ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
```

- 両方は意味が重なる（`force-dynamic` 単独で十分）。設計書 §23.1 はダッシュボードを「**RSC + Streaming + revalidateTag('dashboard') 5min**」と規定しているが、実装は `force-dynamic` で全リクエスト都度 SQL を叩く。
- 60 並列ユーザー × 5min 単位の集計重複 → DB クエリ過多。
- 推奨: `revalidate = 60` + `revalidateTag("dashboard")` に変更、`searchParams.range` 違いで cache key を分離。

### M-2. `app/(app)/dashboard/page.tsx:47-54` — Suspense が NSM hero しか包んでいない

- `Funnel` `AttentionList` `ActivityChart` `RecentCampaigns` も同じ `getDashboardSnapshot` の戻り値に依存しているのに、ページ全体が `await` で 1 ショット。Streaming にならない。
- 設計書 §23.1 は「重い集計はサーバ、UI は段階的に流す」を明示。現実装は段階性ゼロ。
- 推奨: snapshot を 4 つのクエリに分割し、`Suspense` を 4 箇所配置 → React 19 `<Suspense>` で各 KPI/ファネル/活動/キャンペーンを独立 stream。

### M-3. `lib/supabase/server.ts:14-25` — cookie set 例外を無音 catch

```ts
try { cookieStore.set(...); } catch {}
```

- Server Component から呼ぶケースで例外になるのは Next.js 15 の仕様だが、Server Action / Route Handler では例外を握り潰すと **セッション更新失敗が観測不能**。
- 推奨: 環境を `process.env.NODE_ENV !== "production"` で `console.warn`、本番では Sentry に `breadcrumb` 送信。

### M-4. `db/client.ts:6-9` — `globalThis.__pg__` を使った HMR 用シングルトンが SSR でも再利用される

```ts
declare global { var __pg__: ReturnType<typeof postgres> | undefined; }
```

- HMR 時の接続増殖回避としては定石だが、`process.env.NODE_ENV === "development"` ガードがない。本番で同じ構造体が serverless の cold start 跨ぎで誤認される事故が起きうる。
- 推奨:
  ```ts
  const cached = process.env.NODE_ENV !== "production" ? globalThis.__pg__ : undefined;
  ```

### M-5. `server/queries/dashboard.ts:60-102` — 3 クエリ並列だが N+1 / 集計 SQL 不一致

- `activityCurr` は明細を取得し JS で `reduce`、一方 `activityPrev` は SUM で集計。**同じ責務に異なる手法**。
- `activityCurr` も SUM＋GROUP BY day で集計するか、もしくは両方明細にして JS で集計するか統一すべき。
- 加えて `funnelRows` の `count` は `bigint` 推論。Drizzle の `sql<number>` キャストは実行時に **string** が来る（postgres-js の `bigint → string` デフォルト）ため、`Number(r.count)` 変換が必要（既に対応済 OK）だが、`sumCurr.sent` などは `Number()` を経由していない箇所がある（行 106-110）。
- 推奨: 全集計値で `Number(r.field)` を徹底、もしくは `postgres({ types: { bigint: postgres.BigInt } })` 注入。

### M-6. `app/layout.tsx:5-28` — `next/font/google` で 4 ファミリ並列読込

- Manrope + Geist + Geist Mono + Noto Sans JP（weight 3 種）= 7 リクエスト分の font payload。LCP に 200-400ms 遅延。
- 設計書 §23.6 で `/`（ダッシュ初期）= 180KB gzip 予算。フォントだけで超過しがち。
- 推奨: Manrope を display only / Noto JP を本文 / Geist Mono を tabular のみで分離し、`subsets: ["latin"]` ＋ `preload: false` を mono / display に適用。`Geist` は `Manrope` と役割重複（display 用に Manrope だけで足りる）→ 削除を検討。

### M-7. `package.json:22-31` — インストール済みだが MVP コードで未使用なライブラリが多数

| パッケージ | 用途想定 | 現状 |
| --- | --- | --- |
| `@tanstack/react-query` | Client cache | 未 import |
| `zustand` | 状態管理 | 未 import |
| `motion` | アニメーション | 未 import |
| `zod` | フォームバリデーション | 未 import |
| `class-variance-authority` | Button のみ使用 | OK |

- 「設計書通りの依存を先に入れる」方針自体は健全だが、未使用 dep は **Tree-shake で消えても CI ビルド時間が伸びる** + Renovate で大量の PR 起こす。
- 推奨: 実装着手まで未使用 dep を `optional`/`peerDependencies` でなく **コミット時点で外す**、または `phase2/` の package で別管理。

### M-8. `db/schema.ts:13` — `numeric` import が未使用（Lint デッドコード）

- ESLint の `no-unused-vars` で警告対象。CI を `--max-warnings=0` にする時点で破綻。
- 推奨: 削除。

### M-9. `components/dashboard/recent-campaigns.tsx:55, attention-list.tsx:48` ほか — `<a href="...">` を `next/link` 化していない

- 内部遷移を素の `<a>` で書くと Soft Navigation にならず full reload。React 19 の `<Link>` プリフェッチも効かない。
- 推奨: `import Link from "next/link"` で全置換。`typedRoutes` のメリットも享受できる。

### M-10. `server/queries/dashboard.ts:170-176` — live モード時に `attention` / `recent` が常に空配列

```ts
attention: [],
recent: [],
source: "live",
```

- DB 接続できた瞬間にダッシュボードから「注意が必要なもの」「直近のキャンペーン」が消える。**mock の方がリッチ** という奇妙な体験。
- 推奨: 該当データを `campaigns` / `messages` テーブルから引く実装まで含めて初めて live を返す。中途半端な live は出すべきでない（出すなら DEMO バナーを継続）。

### M-11. `db/schema.ts:65-72` — `organizations` に `updatedAt` がない

- 監査ログ要件（設計書 §27）は更新時刻を必須にしている。`createdAt` のみだと変更追跡が落ちる。
- 推奨: 全テーブル横断で `updatedAt` + `deletedAt`（論理削除）を追加。

### M-12. `lib/state-machine.ts:80-83` — `info`, `info-strong`, `positive-soft`, `positive` 等の tone が **同じクラス文字列** に collapse

```ts
info:           "text-info-700 [color:var(--color-info-700)]",
"info-strong":  "text-brand-700 [color:var(--color-brand-700)]",
"positive-soft":"text-success-700 [color:var(--color-success-700)]",
positive:       "text-success-700 [color:var(--color-success-700)]",
```

- positive と positive-soft が完全一致。soft / strong の差が UI に出ない。設計意図と乖離。
- 推奨: soft = `text-success-600 bg-success-50`, strong = `text-success-800 bg-success-100` のような濃淡分離。

### M-13. `app/page.tsx:1-5` — Server-side `redirect()` で OK だが、未認証チェックがない

- 「常にダッシュボードへ送る」設計のままだと、`/login` ページが孤立する（手動でアドレスを入れない限り辿り着かない）。
- 推奨: middleware（`middleware.ts`）で auth 判定 → 未認証なら `/login`、認証済みなら `/dashboard`。

---

## 3. LOW（仕上げ）

- **L-1** `components/ui/button.tsx:71` `Button.displayName = "Button"` の後に空行なし → Prettier フォーマット崩れ。
- **L-2** `components/dashboard/kpi-card.tsx:35` `id={`spk-${values.join("-")}`}` は SSR で同じデータの sparkline が増えると重複 id 警告。`React.useId()` に置き換え。
- **L-3** `components/dashboard/activity-chart.tsx:24` `Math.max(d.sent, d.replied * 4, d.meeting * 8)` のマジックナンバー（4, 8）にコメントなし。スケール調整理由を docstring。
- **L-4** `app/login/page.tsx:73` `© {new Date().getFullYear()}` は SSR/CSR で year 跨ぎの hydration mismatch リスク（年末年始）。サーバ側で固定 string にレンダリング。
- **L-5** `components/dashboard/funnel.tsx:1` `"use client"` 宣言があるが Funnel コンポーネントは onClick もないため SSR で OK。Client component 削減で bundle 圧縮可。
- **L-6** `components/dashboard/recent-campaigns.tsx:40` グリッド `1.4fr_120px_90px_90px_90px_120px_32px` がモバイルで見えなくなる（`hidden md:grid`）が、`<ul>` 側は同じ grid を維持。モバイル時にレイアウト破綻。
- **L-7** `lib/formatters.ts:32` `previous === 0` で `flat` を返すが、`current > 0, previous === 0` は `+∞%` として `up` 扱いが UX 的には正しい（新規 KPI 立ち上がりを 0% にすると「変化なし」と誤認）。
- **L-8** `tsconfig.json:18` `verbatimModuleSyntax: false` は React 19 + バンドラの型 import 厳格化に逆行。次スプリントで `true` 化。
- **L-9** `db/client.ts:19` `prepare: false` は Supabase Pooler（PgBouncer）対応の正解だが、コメント無し → 後任が外す事故リスク。`// Supabase pooler requires prepare:false` をつける。
- **L-10** `next.config.ts:8-10` `images.formats` を AVIF/WebP に絞っているが `images.remotePatterns` 未定義 → Supabase Storage の画像を使う段階で `Invalid src prop` を踏む。事前定義推奨。

---

## 4. 良い点（3 つ以上）

1. **`db/schema.ts` の状態機械 enum と `lib/state-machine.ts` の UI メタデータ分離が綺麗**: DB は raw enum、UI は icon + ja + tone の三重表現。設計書 §3.3「カラーブラインド対応」を実装レベルで担保している。
2. **`components/ui/*` の shadcn 互換 + CVA 設計が筋が良い**: `Button` が `cva` で variants を表明、`Card` が `solid`/`glass` の 2 モードを CSS class で切替。後続 50+ コンポーネントへの拡張パスが明確。
3. **`db/client.ts` の `getDb() → null` フォールバック設計**: Auth / DB が揃わない開発初期でも `pnpm dev` でビューが立ち上がる。Onboarding コストが極小。Mock は完全に分離されており、本番混入リスクが低い（H-6 で書いた live/mock 切替の論理の弱さ以外は健全）。
4. **`app/globals.css` の Tailwind v4 `@theme` トークンが体系的**: brand 50→950 / ink 50→950 / semantic（success/warning/danger/info）が完全分離。色トークン定義としては監査可。
5. **`server/queries/dashboard.ts` のインターフェイス型 `DashboardSnapshot` を **明示的にエクスポート**して mock / live で同型を共有**: 型契約が崩れないと保証されている（M-10 で書いた live の中身の薄さは別問題）。
6. **`drizzle.config.ts` の `strict: true` + `verbose: true`**: 開発時に型と SQL の双方を検証する設定。Prod 投入前に migration drift を捕捉できる。

---

## 5. 95+ 到達のための残ブロッカー（優先順）

| # | ブロッカー | 軸 | 対応工数 |
| --- | --- | --- | --- |
| 1 | H-1 `auth/callback` route + middleware auth ガード | Next.js / Sec | 0.5 day |
| 2 | H-2 Server Action UI フィードバック（`useActionState` 化） | Next.js / UX | 0.25 day |
| 3 | H-3 `typedRoutes` × `as never` 解消、`NavItem.href: Route` | 型 | 0.25 day |
| 4 | H-5/H-6 `mode:"date"` 取り扱い統一 + `orgId` を auth から取得 | 型 / NS | 0.5 day |
| 5 | H-4 `dailyMetrics` 複合 PK 化 + `migrations/` 生成 | スキーマ | 0.25 day |
| 6 | H-7/H-8 `@types/react@rc` 化 + `React` 名前空間 import 統一 | 依存 | 0.25 day |
| 7 | H-9 Tailwind v4 GA 化 + chip 色レンダ確認 | 依存 / CSS | 0.5 day |
| 8 | M-1 / M-2 Streaming 化（snapshot 分割 + 個別 Suspense） | Next.js | 1.0 day |
| 9 | M-10 live モードの `recent` / `attention` 実装 | 機能 | 1.0 day |
| 10 | M-12 tone 濃淡分離 + L-7 delta 0% 取り扱い | UX | 0.25 day |

合計概算: **4.75 day** で各軸 18-19 / 20 に到達 → 総合 **94-96 / 100** が見込める。

特に **H-1 / H-2 / H-6 はマージブロッカー**（auth が機能しない / 本番でも常に mock）。レビュー結論として **現状ブランチは出荷不可**、`code-r1` は HIGH 全消化＋スコア 90 到達まで再レビューを要する。

---

## 6. 補足（設計書 §23 との整合チェック）

| §23 項目 | 期待 | 実装 | 判定 |
| --- | --- | --- | --- |
| 23.1 ダッシュボード | RSC + Streaming + revalidateTag('dashboard') 5min | `force-dynamic` + `revalidate=0` 単発 await | ✗ M-1/M-2 |
| 23.1 `/login` | Static / SSR | `app/login/page.tsx` は server component で OK | ✓ |
| 23.2 キャッシュ命名 | `tag:campaign:42` 等 | `revalidateTag` 未使用 | ✗ |
| 23.3 SSE | 既定 SSE / Last-Event-ID / backoff | 未実装（Phase2 と README で表明済） | △ Phase2 |
| 23.5 状態管理 = Zustand | Zustand 採用 | 依存追加済 / コードに存在せず | △ |
| 23.5 アイコン = lucide-react | lucide 採用 | OK（state-machine.ts / sidebar.tsx 等） | ✓ |
| 23.5 日付 = date-fns | date-fns | OK | ✓ |
| 23.5 アクセシブル UI = shadcn/ui (Radix) | shadcn / Radix | shadcn 互換の自前 UI、Radix 不採用 | △ — Dialog / Tooltip が必要になった瞬間 a11y 落ちる |
| 23.6 バンドル予算 `/` 180KB gzip | 180KB | フォント 7 系統 + 未使用 dep で確実に超過 | ✗ M-6/M-7 |

---

**Verdict: NEEDS REVISION**

HIGH 9 件中、H-1 / H-2 / H-3 / H-4 / H-5 / H-6 / H-7 / H-9 の 8 件はマージ前に必須対処。H-8 は次スプリント可だが React 19 GA 化と同時に潰すのが合理的。

次レビュー（code-r2）で HIGH 0 件 / 総合 90+ を目標とする。
