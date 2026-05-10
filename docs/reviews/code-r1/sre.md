# SRE レビュー — code-r1

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の実装コード
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§24 SLO/Runbook、§15 パフォーマンス予算、§12.3.1 incident_id)
- レビュアー: SRE シニア（観測性 / パフォーマンス / 信頼性）
- 評価日: 2026-05-09

---

## 総合スコア: **62 / 100**

| 評価軸 | 配点 | スコア | 主な所見 |
| --- | --- | --- | --- |
| 1. パフォーマンス | 20 | 13 | フォント 4 種フル / SVG 大量再生成 / `force-dynamic` で全リクエスト DB 直撃 / images.remotePatterns 未設定 |
| 2. エラーハンドリング / fallback / incident_id | 20 | 8 | `error.tsx` / `not-found.tsx` / `loading.tsx` / `global-error.tsx` 全部欠落、Server Action は throw 経路で incident_id 提示なし |
| 3. 観測性 | 20 | 6 | Sentry/PostHog 未配線、`instrumentation.ts` なし、health endpoint なし、構造化ログなし、tracing なし |
| 4. DB 接続 / プール / 再試行 | 20 | 13 | グローバル singleton はOK、ただし `prepare:false` 固定 / connect_timeout / max_lifetime / SIGTERM ハンドラなし、再試行なし |
| 5. 設定ミス耐性 | 20 | 12 | env 未設定で sign-in が無症状失敗（302 リダイレクト依存）/ `localhost:3000` ハードコード / build 時に DATABASE_URL 必須化されていない点は良い、ただし型レベルでガードなし |

設計書 §24 SLO（API 可用性 99.9%、Web Vitals LCP P75 < 2.5s 75%+ など）と §12.3.1 (5xx/4xx 応答に `incident_id` `correlation_id` 提示必須) に対し、現状のコードは **観測性ゼロ・SLO 計測手段ゼロ・incident_id 表示の経路ゼロ** です。MVP として動作はするが、本番投入には致命的なギャップがあります。

---

## HIGH（本番投入ブロッカー）

### H-01 観測性スタックが完全に未配線
- ファイル: 全体（`package.json` / `app/layout.tsx` / `instrumentation.ts` 不在）
- 問題:
  - `package.json` に `@sentry/nextjs` も `posthog-js` / `posthog-node` も入っていない
  - Next.js 15 の `instrumentation.ts` / `instrumentation-client.ts` も未配置
  - 設計書 §16.1（`auth.signup_completed` ほか 11 イベント）と §24.1（API 可用性 / レイテンシ / Webhook 反映 SLO）を計測する hook が一切存在しない
  - Web Vitals (`onCLS` / `onLCP` / `onINP`) も `app/layout.tsx` から送られていない
- 影響: SLO バーンレート（fast 14.4× / slow 6×）の判定不能 → エラーバジェット消費が見えない → リリース凍結ロジック (50/80/100%) も発火不能
- 推奨:
  1. `instrumentation.ts` で `Sentry.init({ tracesSampleRate, profilesSampleRate, beforeSend })`（PII redact 必須、設計書 §16）
  2. `instrumentation-client.ts` で PostHog SDK init + `posthog.capture('$web_vitals', …)`
  3. `app/global-error.tsx` で Sentry に flushed report
  4. `correlation_id` を Server Action / Route Handler で `crypto.randomUUID()` 採番し、Sentry tag + ログ + Response header に乗せる

### H-02 Error Boundary / fallback ページが全部欠落
- ファイル: `app/error.tsx` / `app/global-error.tsx` / `app/not-found.tsx` / `app/loading.tsx` / `app/(app)/error.tsx` / `app/(app)/dashboard/error.tsx` 全て不在（Glob で確認済み）
- 問題:
  - Server Component で例外（DB 接続失敗・JSON parse 失敗・Drizzle SQL エラー）が起きると Next.js のデフォルト 500 になり、設計書 §12.3.1 の「`incident_id` を必ず提示」要件を満たせない
  - `Suspense` は `app/(app)/dashboard/page.tsx:47` で 1 箇所だけだが、エラー境界（`error.tsx`）と組み合わさっていないため、子で投げると root まで貫通
- 影響: 5xx 時にユーザーは生のフレームワークエラーを見ることになる。サポート起票時の incident_id がないので RB-05（Postmortem 公開）の入口が機能しない
- 推奨:
  1. `app/global-error.tsx` で `<html><body>{incident_id} を控えてサポートへ</body></html>` のフルページ fallback
  2. `app/(app)/error.tsx` で Header を保ったまま「処理中に問題が発生しました（INC-…）」を表示し、`reset()` ボタン
  3. `app/(app)/dashboard/loading.tsx` で `HeroSkeleton` 相当を route 全体に展開（現在 `Suspense` fallback の Hero スケルトンのみ）
  4. `app/not-found.tsx` で 404 文言を統一

### H-03 Server Action がエラー時に object を return するだけで、redirect も throw も握り潰し
- ファイル: `server/actions/auth.ts:6-24`
- 問題:
  - `signInWithMagicLink` は `<form action={signInWithMagicLink}>` から呼ばれているが、Server Action から **オブジェクトを return しても画面には反映されない**（クライアント側で `useFormState` を使っていないため）。エラー文言（「メールアドレスを入力してください」「Supabase からのエラー」）は **完全に消失**
  - 成功時も redirect していないので、ユーザーには何も起きていないように見える（設計書 §12.3.1 の「マジックリンクを送りました」フィードバック欠落）
  - Supabase 例外を catch せず、ネットワーク障害時はフレームワークデフォルトの 500 へ → incident_id 提示経路なし
- 影響: 認証 SLO の SLI 取得不能。サポートに「ボタン押したけど何も起きない」案件が直行
- 推奨:
  1. `app/login/page.tsx` を `"use client"` 化 + `useActionState` で result 受け取り、エラー / 成功 toast を表示
  2. Server Action 内で `try/catch` し、Sentry capture + `correlation_id` 採番、return には `{ ok, error, incidentId }` を含める
  3. Supabase エラーメッセージは生で出さず、サニタイズ（`error.message` には PII が混じる可能性）

### H-04 `force-dynamic` + DB 直撃でダッシュボードがキャッシュ層を持たない
- ファイル: `app/(app)/dashboard/page.tsx:15-16`
- 問題:
  - `export const dynamic = "force-dynamic"` + `export const revalidate = 0` で **毎リクエスト DB ヒット**
  - 設計書 §15「重い計測（ファネル/集計）はサーバサイドで集約 + ETag」に違反。`daily_metrics` は precomputed なので 60s 程度のキャッシュは入れられる
  - LCP P75 < 2.5s 達成率 75%+ の SLO は、ダッシュボードでこの設定だと P95 で 1〜2s 上振れする（特に Cold Start 時）
  - `Promise.all` で 3 クエリ並列化はOK、ただし connection pool が `max:10` なので 10 同時ユーザーで枯渇
- 影響: 低トラフィックでもLCP / API レイテンシ Read P95 < 400ms SLO 違反リスク。コスト面でも DB CPU が線形に膨らむ
- 推奨:
  1. `revalidate = 30`（30s ISR）+ `unstable_cache(getDashboardSnapshot, [orgId, days], { revalidate: 30, tags: ['dashboard', orgId] })`
  2. キャンペーン編集時に `revalidateTag('dashboard:' + orgId)`
  3. もしくは TanStack Query (`staleTime: 30_000`) でクライアントキャッシュ。設計書 §15 の "TanStack Query で画面間キャッシュ" に合致

### H-05 Postgres プールに `connect_timeout` / `max_lifetime` / `idle_in_transaction_timeout` がない
- ファイル: `db/client.ts:11-23`
- 問題:
  - `postgres()` 設定が `max:10, idle_timeout:20, prepare:false` のみ
  - Supabase の Transaction Pooler (PgBouncer 6543) は `prepare:false` で正しいが、**Session Pooler (5432) や直結を間違えて使うとリーク**
  - `connect_timeout` 未設定 → ネットワーク断時にリクエストが 30s 以上ハング → INP 悪化
  - `max_lifetime` 未設定 → Supabase pgbouncer 側の TTL 切れ後 stale connection を引く可能性
  - **シャットダウンハンドラなし**: Vercel SIGTERM 時に in-flight クエリと pool が graceful close されない → 接続リーク
  - `globalThis.__pg__` は dev hot reload 対策として正しいが、**プロダクションでも globalThis 採用は問題なし**（Node.js の場合）。Edge Runtime ではこのコードは動かない（`postgres-js` は Node 専用）
- 影響: Supabase 側で connection 上限到達、Funnel クエリの突然の P95 跳ね上がり（再接続コスト）、SLO 違反
- 推奨:
  ```ts
  globalThis.__pg__ = postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,        // ← 追加
    max_lifetime: 60 * 30,      // 30 分（PgBouncer 側より短く）
    prepare: false,
    onnotice: () => {},          // psql NOTICE で Sentry 詰まり防止
  });
  // graceful shutdown
  if (typeof process !== "undefined") {
    process.once("SIGTERM", () => globalThis.__pg__?.end({ timeout: 5 }));
  }
  ```

### H-06 Health endpoint / SLO 公開エンドポイントが存在しない
- ファイル: `app/api/health/route.ts` (不在) / `app/api/status/route.ts` (不在)
- 問題:
  - 設計書 §24.1 表で `/status API` が API 可用性 / レイテンシ / Unipile / LLM の SLO 観測元と明記されているが、実装ゼロ
  - Vercel / Cloud Run のヘルスチェック経路もない → 不健全インスタンスのまま traffic 受け続ける
- 推奨:
  1. `app/api/health/route.ts`: DB 1ms クエリ (`SELECT 1`) + Supabase Auth ping、200/503 を返す。`export const runtime = "nodejs"`、`export const dynamic = "force-dynamic"`
  2. `app/api/status/route.ts`: 直近 5 分の SLO サマリ（Sentry / PostHog から fetch）。設計書 §24.1 §12.3.1 のステータスバナー連動

---

## MEDIUM（早期対応推奨）

### M-01 フォント 4 種を全部 next/font でフルロード
- ファイル: `app/layout.tsx:5-28`
- 問題:
  - `Manrope` / `Geist` / `Geist_Mono` / `Noto_Sans_JP (400/500/700)` の 4 ファミリ・8 ウェイトが全ページに乗る
  - Noto Sans JP は `subsets:["latin"]` だが、これは設定ミス。日本語 glyph は subset に含まれず、結局 fallback で全 glyph fetch されるか日本語が出ない
  - LCP テキスト（H1）に必要なのは Manrope / Noto JP の 1〜2 ウェイトだけ
  - 推定追加転送量: ~150KB+（CSS + WOFF2 4 ファミリ）。設計書 §15「初回 80–240KB gzip」を圧迫
- 推奨:
  1. `Geist_Mono` は `tabular` 用なら数値表示の `<span>` だけに絞る（CSS 変数で限定スコープ化）
  2. Noto Sans JP は `subsets: ["japanese"]` が無いので明示で `weight:["400","700"]` のみ + `preload:false` にして CSS で `font-display: swap` 任せ
  3. 1 ヒーロー H1 だけは `display:"block"`、本文は `display:"swap"`

### M-02 SVG `linearGradient id` がレンダー毎に文字列連結で再生成
- ファイル: `components/dashboard/kpi-card.tsx:28`
- 問題:
  - `id={`spk-${values.join("-")}`}` で **数値の連結文字列**（30 日 × KPI 4 個 = 120 個分のユニーク id）が DOM に挿入される
  - 同じ spark 値でも異なるカードで衝突回避しているのは正しいが、**values は再ソート / メモ化なし** で毎レンダー再計算 → React の reconciliation が gradient ノードを差分更新
  - SSR と CSR で id が一致しないと hydration mismatch 警告（数値は一致するはずだが、ロケール差分で誤差発生する可能性）
- 推奨: `React.useId()` を使うか、`crypto.randomUUID()` を `useMemo([])` で固定化

### M-03 `Sparkline` のフィルアレイにステート無し / メモ化無し
- ファイル: `components/dashboard/kpi-card.tsx:16-40`
- 問題:
  - 30 日 × 4 KPI で Sparkline が 4 つ。一つ一つは小さいが、`values.map` の結果文字列を毎レンダー再生成
  - 親 `DashboardPage` が Server Component なので CSR 再レンダーは無いものの、Client 側ナビゲーション時に SVG パスを再生成
- 推奨: `KpiCard` を `React.memo` 化、`points` を `useMemo`

### M-04 Dashboard クエリで `daily_metrics` の前期比は集約だけ、`activityCurr` は raw 行を全部返す
- ファイル: `server/queries/dashboard.ts:60-77`
- 問題:
  - `activityCurr` は `select day, sent, connected, replied, meeting, discovered` で **行を全部 fetch** してアプリ側で reduce
  - `activityPrev` は SQL 側で `sum()` 集約済み → 非対称
  - 30 日なら 30 行で問題ないが、`days = 180` まで許容している（page.tsx:24）ので 180 行 × 多テナント時に N+1 ではないがメモリと TCP 転送が増える
  - 同時に `dailyMap` 構築でキー一致判定にロケール文字列を使っているのは脆い
- 推奨:
  1. SQL 側で `date_trunc('day', day)` + `coalesce(sum(...))` 集約 + 期間範囲を `generate_series` で埋めて 0 を返す
  2. 行ベース API はやめて `daily_metrics` は precomputed なのでそのまま読むだけにする

### M-05 `force-dynamic` ページなのに UI で「DB 未接続のため、サンプルデータを表示」がレンダーされる
- ファイル: `app/(app)/dashboard/page.tsx:37-45`
- 問題:
  - `snapshot.source === "mock"` のケアが入っているのは良いが、本番で `DATABASE_URL` を入れ忘れたら **本番 UI に DEMO バッジが出続ける**（ユーザー混乱 + セキュリティ上の信号）
  - `getDashboardSnapshot(null, ...)` を渡しているコメント「`org_id` は本来 auth から取得。MVP ではモックを返すために null。」は production blocker
- 推奨:
  1. `process.env.NODE_ENV === "production" && !orgId` で 503 を返す（`error.tsx` 経由で incident_id 表示）
  2. middleware で auth 未認証の `/dashboard` アクセスは `/login` にリダイレクト

### M-06 `Promise.all` 内のクエリが個別に失敗した場合、全部失敗扱いになる
- ファイル: `server/queries/dashboard.ts:60-102`
- 問題:
  - 1 つのクエリが timeout すると 3 つとも reject、ダッシュボード全体が 5xx
  - 設計書 §24.1 API レイテンシ Read P95 < 400ms に対し、**1 ファネルクエリの遅延で全部巻き添え**
- 推奨: `Promise.allSettled` + 各セクション独立 `Suspense` boundary（NSM だけ表示、ファネルはスケルトンのまま 等）

### M-07 ログが `console` も `pino` も無い純粋無音
- ファイル: 全体
- 問題:
  - 設計書 §16 / §24 で audit_log / correlation_id / Sentry breadcrumb 連携が前提だが、現コードは **ログ出力ゼロ**（grep で `console\.(log|error|warn|info)` ヒット 0 件）
  - Server Action / Server Component の例外がどこで起きたか追えない
- 推奨: `lib/logger.ts` に `pino` (Edge は console) で `requestId / orgId / userId / route` を JSON で吐く。Sentry とは別系統で構造化ログを stdout へ

### M-08 `DEFAULT_RANGE_DAYS = 30` を上限 180 まで許容、`Math.min(180, Math.max(7, ...))` で防御は良いが SLO に重い
- ファイル: `app/(app)/dashboard/page.tsx:24` / `server/queries/dashboard.ts:44`
- 問題:
  - 180 日 × 全 org の `daily_metrics` 走査は P95 を確実に超える
  - インデックス `dm_pk` は `(orgId, day)` の uniqueIndex で範囲スキャン高速化されるが、組織が大きいと range scan で遅延
- 推奨: 90 日上限に下げる、もしくは 90 日超は async でロード（fallback skeleton）

### M-09 `next.config.ts` に `images.remotePatterns` 未設定 / `experimental.optimizePackageImports` 未設定
- ファイル: `next.config.ts`
- 問題:
  - `lucide-react` `date-fns` `motion` を tree-shake させる `optimizePackageImports` 無し → サイドバーで使われていないアイコンも bundle される（lucide 全 1000+ icon は重い）
  - `images.remotePatterns` なし → 将来の avatar 表示で `next/image` が使えない
- 推奨:
  ```ts
  experimental: {
    typedRoutes: true,
    optimizePackageImports: ["lucide-react", "date-fns", "motion"],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  ```

### M-10 ハードコード `http://localhost:3000` フォールバック
- ファイル: `server/actions/auth.ts:16`
- 問題:
  - `NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` は本番で env 抜けた時に **localhost 宛のマジックリンク** をユーザーに送る → 致命的な認証障害
- 推奨: env 未設定時は throw して build 失敗させる、または `process.env.VERCEL_URL` を fallback に使う

---

## LOW（改善余地）

### L-01 `db/client.ts` の `globalThis.__pg__` 型が `postgres` import 経由のため Edge Runtime で型エラー候補
- ファイル: `db/client.ts:6-9`
- 問題: `eslint-disable no-var` を使っているが、`declare global { var __pg__ }` は OK。ただし Edge Runtime に Server Action がエスカレーションされた瞬間 build 失敗
- 推奨: `export const runtime = "nodejs"` を必要な route で明示

### L-02 `drizzle.config.ts` で `process.env.DATABASE_URL!` の `!` 強制
- ファイル: `drizzle.config.ts:8`
- 問題: 開発時に env なしで `npm run db:generate` するとランタイム NPE。CI で env 注入忘れた時に分かりにくい
- 推奨: `if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for drizzle-kit")` を冒頭に

### L-03 `app/(app)/dashboard/page.tsx:23` の `searchParams` は Next.js 15 で `Promise` だが、`Number(range) || 30` は `range = "0"` で 30 にフォールバックしてしまう
- ファイル: `app/(app)/dashboard/page.tsx:24`
- 推奨: `Number.isFinite(Number(range)) ? Number(range) : DEFAULT_RANGE_DAYS`

### L-04 `Funnel` `ActivityChart` に `aria-live` / `aria-describedby` がなく、データ更新時の SR 非通知
- ファイル: `components/dashboard/funnel.tsx:38` / `components/dashboard/activity-chart.tsx:51`
- 推奨: 30 秒 ISR で値が変わるなら `aria-live="polite"`

### L-05 `auditLog.hash` の生成ロジックが見当たらない
- ファイル: `db/schema.ts:212-241`
- 問題: 設計書 §17 で「prev_hash + SHA-256 + WORM」と明記されているが、実装側で hash chain を計算する場所が無い（DB schema だけ）
- 推奨: `lib/audit.ts` で `appendAuditLog(...)` を作り、prev_hash 取得 → SHA-256 → INSERT を 1 トランザクションで

### L-06 `Math.random()` を mock データ生成で使用、SSR で `hydration mismatch` リスク
- ファイル: `server/queries/dashboard.ts:190-194`
- 問題: Server で生成して props で渡すだけなのでクライアントで再 random はしないが、毎回違う数字 → デモ品質劣化
- 推奨: seedrandom 等で固定 seed、または事前生成された JSON を読む

### L-07 `react: 19.0.0-rc-...` を使用、`@types/react: ^18.3.12`
- ファイル: `package.json:27,35`
- 問題: 型バージョンが React 18 系のままで、`use()` / `useFormState` の型が古い
- 推奨: `@types/react@npm:types-react@beta`、`@types/react-dom@npm:types-react-dom@beta` の overrides を `package.json` に

### L-08 `next.config.ts` に `poweredByHeader: false` / `compress: true` / `productionBrowserSourceMaps: true` (Sentry 用) なし
- ファイル: `next.config.ts`
- 推奨: 本番セキュリティと観測性のため一式追加

### L-09 `Suspense` は 1 箇所だけで他は同期 await
- ファイル: `app/(app)/dashboard/page.tsx:47`
- 問題: 親で全データ await しているので Suspense fallback はほぼ意味なく、stream する単位が無い
- 推奨: 各セクション（NSM / KPI / Funnel / Activity）を独立 async コンポーネント化し、それぞれ Suspense で包む

### L-10 `app/page.tsx` で無条件 `redirect("/dashboard")`
- ファイル: `app/page.tsx`
- 問題: 未ログイン時に `/dashboard` へ → middleware 不在のため **そのまま `/dashboard` がレンダリングされる**（`getDashboardSnapshot(null,…)` で mock 表示）→ 認証バイパスのように見える
- 推奨: `app/middleware.ts` で `cookies` から Supabase session 検証、未認証は `/login` へ

---

## 良い点（3 つ）

1. **DB 接続の dev hot-reload 対策が正しい**: `db/client.ts:6-9` の `globalThis.__pg__` パターンは Next.js dev で接続が無限増殖する典型的な落とし穴を回避している。`prepare: false` も Supabase Pooler 利用時の正しい選択。

2. **mock fallback で env なしでも UI を見せる設計**: `server/queries/dashboard.ts:50-53` の「DB 未接続なら mockSnapshot」は開発体験として優秀。`source: "mock"` を返してダッシュ側で DEMO バッジを出すのは透明性として良い設計（ただし production blocker は M-05 参照）。

3. **Drizzle schema にインデックスが網羅的**: `db/schema.ts` で `users_email_idx`（unique）/ `leads_org_idx` / `leads_state_idx` / `msg_lead_idx` / `msg_sent_idx` / `dm_pk` (orgId, day) など主要クエリパスに index 設置済み。状態機械 enum も schema 側で `pgEnum` として定義され型安全。

---

## 95+ 到達のための残ブロッカー

現状 62/100 から 95+ に到達するには、以下を最低限実装する必要があります。優先順:

### Tier 1（必須 / 今週中）
1. **`instrumentation.ts` + Sentry SDK 配線** — Web Vitals / Server エラー / Server Action exception を Sentry へ。`beforeSend` で PII redact（H-01）
2. **`app/global-error.tsx` / `app/(app)/error.tsx` / `app/(app)/dashboard/loading.tsx` / `app/not-found.tsx`** — incident_id 採番 + フルページ fallback（H-02）
3. **`server/actions/auth.ts` を `useActionState` 対応に書き換え + try/catch + correlation_id** — エラーが消失している現状を解消（H-03）
4. **`app/api/health/route.ts`** — DB ping + Supabase ping、`runtime: "nodejs"` 明示（H-06）
5. **`db/client.ts` に `connect_timeout` / `max_lifetime` / SIGTERM handler 追加**（H-05）

### Tier 2（必須 / 来週）
6. **PostHog SDK + Web Vitals 送信** — 設計書 §16.1 のイベントを 11 種すべて配線（H-01 続き）
7. **`unstable_cache` + `revalidateTag` でダッシュボードを 30s ISR に**（H-04）
8. **`app/middleware.ts` で auth gate** — 未認証 `/dashboard` を `/login` へ（L-10 / M-05 関連）
9. **`lib/logger.ts` (pino + correlation_id)** — 構造化ログを stdout に（M-07）
10. **`Promise.allSettled` + セクション別 Suspense**（M-06 / L-09）

### Tier 3（観測性の完成度）
11. **`app/api/status/route.ts`** — SLO サマリ（30d バーンレート / 直近 5 分エラー率）を JSON で公開、設計書 §24.1 と一致（H-06 続き）
12. **Lighthouse CI / a11y CI の `.github/workflows/`** — 設計書 §24.1 の TTI < 3.0s 達成率 90%+ を CI で測定
13. **`lib/audit.ts` で hash chain 実装** — schema だけある audit_log の論理整合性を埋める（L-05）
14. **build-time env validation** — `lib/env.ts` で zod schema 検証、build 失敗で漏れを止める（M-10 / L-02）

### Tier 4（パフォーマンス予算）
15. **フォント 4 ファミリの整理 + `optimizePackageImports`**（M-01 / M-09）
16. **`Sparkline` / `KpiCard` の memoization**（M-02 / M-03）
17. **180 日上限 → 90 日に削減**（M-08）

これらを満たせば、設計書 §15 パフォーマンス予算 / §24.1 SLO バーンレート / §12.3.1 incident_id 提示の 3 大要件を全てクリアでき、95+ に到達可能です。**現状は MVP 動作品質であり、本番 SLO 観測の入口がゼロという点が最大のリスク**です。
