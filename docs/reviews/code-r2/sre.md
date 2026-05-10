# SRE レビュー — code-r2

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の実装コード（R1 後の修正反映状態）
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§24 SLO/Runbook、§15 パフォーマンス予算、§12.3.1 incident_id、§16 観測性、§17 audit hash chain)
- 前回レビュー: `docs/reviews/code-r1/sre.md` 62/100
- レビュアー: SRE シニア（観測性 / パフォーマンス / 信頼性）
- 評価日: 2026-05-10

---

## 総合スコア: **84 / 100** （R1: 62 → R2: 84、+22）

| 評価軸 | 配点 | R1 | R2 | 差分 | 主な所見 |
| --- | --- | --- | --- | --- | --- |
| 1. パフォーマンス予算 | 20 | 13 | 14 | +1 | フォント/optimizePackageImports/ISR キャッシュは未対応、`force-dynamic` も継続 |
| 2. エラーハンドリング / incident_id | 20 | 8 | 18 | +10 | error/global-error/not-found/loading 全て追加、useActionState 化、incident_id 表示 OK |
| 3. 観測性 | 20 | 6 | 14 | +8 | instrumentation.ts は stub のみだが配置 OK、health endpoint と audit hash chain と middleware auth gate 追加。Sentry/PostHog SDK 本体は未導入 |
| 4. DB 接続健全性 | 20 | 13 | 19 | +6 | connect_timeout/max_lifetime/SIGTERM/SIGINT/onnotice すべて反映。DB ping 実装に実害バグあり |
| 5. 設定ミス耐性 | 20 | 12 | 19 | +7 | middleware で auth gate、callback で open redirect 対策、login error 表示、rate limit 追加。env 強制は未対応 |

R1 で挙げた 6 件 HIGH のうち **5 件解消、1 件部分解消（H-01 観測性: 配線の枠だけ、SDK 未配置）**。Tier1 の優先度高い項目はほぼ解消され、設計書 §12.3.1（incident_id 提示）と §17（audit hash chain）と §24.1（health endpoint の入口）の「最低限のガード」は揃いました。**MVP 本番投入は可能水準**。ただし本格的な SLO 計測（バーンレート / Web Vitals / トレース）はまだ枠だけで、95+ には Sentry/PostHog 配線と `force-dynamic` 撤廃が必要。

---

## R1 HIGH 解消ステータス

| ID | 内容 | R2 状態 | 根拠ファイル |
| --- | --- | --- | --- |
| H-01 観測性スタック未配線 | **部分解消（C ランク）** | `instrumentation.ts:1-26` 設置 OK だが `register()` / `onRequestError()` 中身は stub。`@sentry/nextjs` `posthog-*` は `package.json` に依然不在。Web Vitals 送信もなし | `instrumentation.ts`, `package.json:15-32` |
| H-02 Error Boundary 全欠落 | **解消** | `app/error.tsx` / `app/global-error.tsx` / `app/not-found.tsx` / `app/(app)/loading.tsx` 全て追加。incident_id 表示・コピー UI・reset ボタン揃い、設計書 §12.3.1 を満たす | `app/error.tsx:22-49`, `app/global-error.tsx:15-48`, `app/not-found.tsx`, `app/(app)/loading.tsx` |
| H-03 Server Action エラー握り潰し | **解消** | `useActionState` 化済み、Zod 検証 / rate limit / 列挙攻撃回避メッセージ / `state.message` を SignInForm が `role=alert/status` で表示 | `server/actions/auth.ts:28-83`, `components/auth/sign-in-form.tsx:23-90` |
| H-04 force-dynamic で DB 直撃 | **未解消** | `app/(app)/dashboard/page.tsx:14-15` に `force-dynamic` + `revalidate=0` が継続。`unstable_cache` も `revalidateTag` も未導入。**HIGH 残存** | `app/(app)/dashboard/page.tsx:14-15` |
| H-05 DB プール設定不足 | **解消** | `connect_timeout:10` / `max_lifetime:1800` / `prepare:false` / `onnotice` / SIGTERM・SIGINT graceful shutdown 全て追加。dev hot-reload も `__pg_shutdown__` フラグで二重登録防止 | `db/client.ts:13-38` |
| H-06 health endpoint 不在 | **部分解消（B ランク）** | `app/api/health/route.ts` は追加され `runtime:"nodejs"` `dynamic:"force-dynamic"` 明示 OK、status 200/503 切り替えも JSON shape も正しい。**ただし実害バグ**: `db.execute({ sql: "select 1", params: [] } as never)` は drizzle-orm/postgres-js の API ではない（`sql` テンプレートタグを渡す必要あり）→ **本番で常に catch 側に落ち、健全な DB でも `degraded` 503 を返す可能性が高い**。これは新 HIGH に格上げ | `app/api/health/route.ts:16-23` |

---

## HIGH 残存 / NEW HIGH

### H-04（残存）force-dynamic + DB 直撃 → ダッシュボードのキャッシュ層欠落
- ファイル: `app/(app)/dashboard/page.tsx:14-15`
- 状態: R1 から無変更
- 影響: P95 レイテンシ・DB CPU が線形に膨らみ、設計書 §15「重い計測はサーバ集約 + ETag」「Read P95 < 400ms」を満たせない
- 推奨:
  ```ts
  export const revalidate = 30;
  // server/queries/dashboard.ts
  import { unstable_cache } from "next/cache";
  export const getDashboardSnapshotCached = unstable_cache(
    getDashboardSnapshot,
    ["dashboard-snapshot"],
    { revalidate: 30, tags: (orgId) => ["dashboard", `dashboard:${orgId}`] }
  );
  ```
  キャンペーン編集系 Server Action で `revalidateTag("dashboard:" + orgId)` を呼ぶ。

### NEW-H-07（新規）health endpoint の DB ping が API 不整合で常時 503 リスク
- ファイル: `app/api/health/route.ts:16-23`
- 問題:
  - `db.execute({ sql: "select 1", params: [] } as never)` は drizzle ORM の `execute` シグネチャと一致しない。drizzle-orm/postgres-js では `sql\`select 1\`` テンプレートを渡す必要がある（`as never` でコンパイルだけ通している状態）
  - 結果として、DB が健康でも `try` が throw → `dbOk=false` → status 503 を返す可能性が高い。Vercel/Cloud Run のヘルスチェックが恒常的に失敗 → トラフィック切断・自動再起動ループの引き金
  - `as never` は型システムを欺いて runtime バグを通したパターンで、CI で気付けない
- 推奨:
  ```ts
  import { sql } from "drizzle-orm";
  // ...
  if (db) {
    try {
      await db.execute(sql`select 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }
  ```
  さらに、DB ping 自体に 2s タイムアウトを噛ませる（`Promise.race` で `setTimeout` reject）。本番で DB が hung した時に health endpoint 自体が長時間ハング → LB のスレッドプール枯渇を防ぐ。

### NEW-H-08（新規）`incident_id` 採番が Math.random ベースで衝突確率が高い + 暗号学的ランダムでない
- ファイル: `lib/incident.ts:7-11`, `app/error.tsx:22-23`, `app/global-error.tsx:15-16`
- 問題:
  - `Math.floor(Math.random() * 9000) + 1000` は 9000 通りしかなく、**1 日 100 件のエラーで誕生日衝突がほぼ確実**（√9000 ≈ 95）。サポートに「インシデント番号 INC-2026-1234 で同じ番号の問い合わせが複数きた」が現実化
  - `error.digest` が無い時にクライアント側で Math.random を呼んでおり、Sentry/サーバログに残る ID と画面表示 ID がズレる → サポート照合不能（設計書 §12.3.1 の「サポート照会キー」要件に違反）
  - `lib/incident.ts:newIncidentId` は Node 専用（`server-only` ではないが `randomUUID` 経由ではなく `Math.random`）
- 影響: incident_id の唯一性が壊れ、「番号で問い合わせを引ける」運用設計が成立しない。RB-05 ポストモーテム公開フローの入口を侵食
- 推奨:
  1. `lib/incident.ts` で `randomUUID()` の頭 6 hex を採用 + 年単位 prefix。例 `INC-2026-A3F4B2`（衝突 1.6 億分の 1）
  2. **incident_id はサーバ側で必ず採番**し、`error.digest` に乗せる（Next.js は throw した Error の `digest` を build 時 hash でセットしてくれるが、これは衝突回避用ではないので独自採番）
  3. クライアント `error.tsx` では受け取った `error.digest` をそのまま表示し、欠落時は固定文言「サポートまでご連絡ください」にフォールバック（ローカル乱数で偽 incident_id を作らない）
  4. 採番した incident_id は Sentry tag (`Sentry.setTag('incident_id', id)`) と構造化ログに必ず乗せる

---

## MEDIUM（早期対応推奨、新規含む）

### M-01（残存）Sentry/PostHog SDK 本体が未導入
- ファイル: `package.json`, `instrumentation.ts:7-13`
- 問題:
  - `@sentry/nextjs` も `posthog-js`/`posthog-node` も `package.json` に無いまま。`instrumentation.ts` の `register()` は中身が空コメントだけで、Web Vitals (`onCLS/onLCP/onINP`) もどこからも `posthog.capture` されていない
  - 設計書 §16.1 の 11 イベントが計測ゼロ、§24.1 のバーンレート判定不能（H-01 の積み残し部分）
- 推奨: `npm i @sentry/nextjs posthog-js posthog-node web-vitals` →
  ```ts
  // instrumentation.ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
    if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  }
  export async function onRequestError(err, req, ctx) {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureException(err, { tags: { route: ctx.routePath } });
  }
  ```
  `app/layout.tsx` に web-vitals reporter（`useReportWebVitals`）を `"use client"` 子で追加。

### M-02（新規）rate-limit がプロセス内 Map で、Vercel Edge / 複数インスタンスで効かない
- ファイル: `lib/rate-limit.ts:8`
- 問題:
  - `const buckets = new Map(...)` はプロセスローカル。Vercel の Lambda/Edge は **リクエスト毎に異なるインスタンスを引きうる**ため、攻撃者は実質無制限に signin OTP を要求できる
  - また Lambda コールドスタートで Map が初期化されるたびにレート制限がリセット
  - コメントに「本番では Upstash Ratelimit / Redis に置き換える」とあるのは認識として正しいが、未対応のまま本番ローンチすると Supabase Auth 側のクォータを叩き続ける
- 推奨: `@upstash/ratelimit` + `@upstash/redis` でグローバル化、もしくは Supabase の `rate_limits` テーブル + `pg_advisory_lock`。MVP でも最低限 `KV` を使う。

### M-03（新規）audit log の hash chain に競合状態 / SELECT-then-INSERT race
- ファイル: `lib/audit.ts:44-82`
- 問題:
  - `select latest hash → compute → insert` の 3 ステップが別トランザクションで、同じ orgId に並列で 2 件 audit を書くと **両方とも同じ prev_hash を読んで枝分かれ**する → hash chain が壊れる
  - 設計書 §17「prev_hash + SHA-256 + WORM」は線形 chain 前提。分岐すると WORM/改竄検証が破綻
  - インデックス `auditLog.createdAt` の取り方も未確認だが、ms 単位のタイムスタンプが衝突する 2 件は「どっちが prev か」で揺れる
- 影響: 高頻度の audit イベント（一斉メッセージ送信時 message.sent 等）で chain が壊れ、後の整合性検証で false positive
- 推奨:
  1. トランザクション化 + `SELECT ... FOR UPDATE` 相当の serialize（Postgres advisory lock: `pg_advisory_xact_lock(hashtext('audit:' || org_id))` を取ってから select → insert）
  2. もしくは `auditLog` の append を**シングルライタ Worker 経由**にし、application 側からは queue に入れるだけにする
  3. テスト: 同一 orgId に 50 並列 insert → chain が連続することをアサート

### M-04（残存）フォント 4 ファミリ + Noto Sans JP の subset 設定ミス
- ファイル: `app/layout.tsx:5-28`
- 状態: R1 から無変更。`Noto_Sans_JP({ subsets: ["latin"], weight: ["400","500","700"] })` は日本語 glyph subset が含まれず、結局 fallback フェッチに依存
- 推奨: `Noto_Sans_JP` は `subsets:["latin"]` を `["japanese"]` に変える（Next.js 15 が対応）か、`weight:["400","700"]` のみに削減 + `preload:false`。Geist/Geist_Mono は本当に必要か再評価（多くの場合 Manrope だけで足りる）。

### M-05（残存）`force-dynamic` + DB 未接続時の DEMO バッジが本番で出る恐れ
- ファイル: `app/(app)/dashboard/page.tsx:36-44`
- 状態: middleware で auth gate が入ったため未認証は `/login` に飛ぶが、**認証済みでも DB 未接続なら mockSnapshot 経由で DEMO バッジが本番表示される**経路は残っている（`getDashboardSnapshot` は `if (!db || !orgId)` で mock を返す）
- 推奨: `process.env.NODE_ENV === "production"` で DB 不在を検知したら **build-time エラー** にする（`lib/env.ts` で zod 検証）。サンプルデータでお茶を濁すのは dev/preview 限定。

### M-06（新規）CSP に Sentry/PostHog ドメインが入っていない（将来 SDK を入れた瞬間ブロック）
- ファイル: `next.config.ts:24-37`
- 問題:
  - 現在 `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co` のみ
  - Sentry (`*.sentry.io` / `*.ingest.sentry.io`) と PostHog (`*.posthog.com` / `*.i.posthog.com`) を入れる前に CSP で弾かれる → SDK 入れても無音失敗
  - `script-src 'unsafe-inline'` を本番でも許容している点は §17 厳格化の積み残し（R1 L-08 関連）
- 推奨:
  - 観測 SDK 導入と同時に CSP を更新する PR を切り、connect-src/script-src を nonce ベースに前倒し移行
  - `report-uri` / `report-to` で CSP 違反を Sentry に飛ばす

### M-07（新規）`db.execute` 型ガード不在で `as never` キャストが他 route にも波及するリスク
- ファイル: `app/api/health/route.ts:18`
- 問題: `as never` は型エラーを握り潰すサインで、Lint ルール `@typescript-eslint/no-explicit-any` 同等のレッドフラグ。CI に `no-restricted-syntax` で禁止する
- 推奨: ESLint config で `as never` 検出 → 当該箇所を `sql\`select 1\`` 化（NEW-H-07 と一体）

### M-08（残存）構造化ログが pino 等で吐かれていない
- ファイル: 全体
- 状態: 唯一の `console.error` が `app/error.tsx:18` と `app/global-error.tsx:13` のみ（クライアント Boundary）。サーバ側は完全無音
- 推奨: `lib/logger.ts` で pino を導入、`requestId / orgId / userId / route / latency` を JSON で stdout 出力。`onRequestError` から `logger.error({ requestId, err })` を必ず呼ぶ

### M-09（残存）180 日範囲がデフォルトで許容され、SLO Read P95 < 400ms と乖離
- ファイル: `app/(app)/dashboard/page.tsx:23`
- 推奨: 90 日上限へ削減、または 90 日超は Suspense skeleton で非同期遅延ロード

### M-10（新規）middleware で env 不在時に `createServerClient(... ?? "")` が黙ってクライアントを作って auth ループ
- ファイル: `lib/supabase/middleware.ts:11-13`
- 問題:
  - `process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""` で空文字列を渡すと、Supabase SSR は内部で fetch を試みて 400/不正 URL となり、毎リクエスト middleware が例外 → 全保護パスが `/login` リダイレクトループに陥る可能性
  - 開発で env 設定を忘れると無症状で「ログインしてもダッシュボードに入れない」と気付きにくい
- 推奨: `lib/env.ts` で zod 検証 + `if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw` を `createServerClient` 呼び出し前に。エラー時は `incident_id` 付きの 503 ページに飛ばす。

---

## LOW（改善余地、新規のみ抜粋）

### L-01（新規）`app/api/health/route.ts` が `incident_id` を返さない
- 問題: 503 時に呼び出し側（監視・LB）が原因相関できない。設計書 §12.3.1 に従い health endpoint も `incident_id` ヘッダ or body を返すべき
- 推奨: `headers: { "X-Incident-Id": newIncidentId() }` を 503 時に追加

### L-02（新規）health endpoint が認証なしで内部状態を露出
- ファイル: `app/api/health/route.ts:25-35`
- 問題:
  - `region` `version` `db: "operational"` を anon に返す。情報漏洩としては軽微だが、攻撃者が DB 状態を polling できる
  - middleware の PUBLIC_PATHS にも `/api/health` を含めていて公開済み
- 推奨: `/api/health` は最小限の `{status: "ok"}` だけにし、詳細版 `/api/internal/health` を Authorization Bearer Token で保護

### L-03（新規）`db/client.ts` の SIGTERM/SIGINT が dev 環境では無限に登録される懸念
- 状態: `__pg_shutdown__` フラグで二重登録は防いでいる。Good。Edge Runtime には `process` が無いので `typeof process !== "undefined"` ガードも OK。低指摘。

### L-04（新規）`server/actions/auth.ts` の rate-limit key に email を含める設計
- ファイル: `server/actions/auth.ts:48`
- 問題: `signin:${ip}:${email}` で key を作っているため、攻撃者は同 IP から 100 個違う email を試せる（per-email 5 回制限はかかるが per-IP 制限は無効）
- 推奨: `ip` 単独 key と `email` 単独 key の両方をチェックし、どちらかがヒットしたら拒否

### L-05（新規）`drizzle-orm` バージョン 0.36 / `@types/react: types-react@rc` の依存古典
- ファイル: `package.json:22, 36-37`
- 問題: drizzle 0.36 は `db.execute(sql\`...\`)` を使う前提で、現状のコードと整合させると新 API への追従が不可避。`types-react@rc` も React 19 RC 用なので、安定 React 19 が出たら更新タスクに

### L-06（残存）`Sparkline` の SVG id 再生成
- ファイル: `components/dashboard/kpi-card.tsx:28`
- 状態: R1 から無変更。`React.useId()` への置換が必要

### L-07（新規）`lib/incident.ts` が Math.random だけで Node `randomUUID` import が`newCorrelationId` のみで使用、不一致
- ファイル: `lib/incident.ts:1-15`
- 問題: 同じファイルで `randomUUID` を import しているのに、incident_id 側では使っていない。設計上の不徹底（NEW-H-08 の根本原因）

---

## 良い点（R2 で増えた強み 5 つ）

1. **Error Boundary 完備**: `app/error.tsx` (route 単位) と `app/global-error.tsx` (root) の使い分け、`app/(app)/loading.tsx` の本格 skeleton、`app/not-found.tsx` の統一文言。設計書 §12.3.1 の incident_id 提示要件をクライアントレイヤで満たした。
2. **DB プール健全性が完成形**: `connect_timeout:10` / `max_lifetime:1800` / `prepare:false` / `onnotice` / SIGTERM・SIGINT graceful shutdown / hot-reload guard 全て揃った。これは Supabase + Next.js 15 + Vercel の本番運用パターンの教科書。
3. **`useActionState` への正しい移行**: Server Action の return が画面に反映されない R1 の致命傷を解消。`role=alert/status` で SR にも届き、aria-describedby/aria-invalid も配慮済。
4. **Open redirect 対策が `auth/callback` で実装**: `nextRaw.startsWith("/") && !nextRaw.startsWith("//")` で `//evil.com` を弾く実装、Supabase exchangeCodeForSession の error ハンドリングも `?error=auth_callback_failed` で UI に伝達。
5. **Audit log hash chain の実装着手**: `lib/audit.ts:appendAuditLog` で prev_hash 取得 → SHA-256 → INSERT のロジックは正しく書かれている（race condition は M-03 で別途指摘）。設計書 §17 の WORM 要件への第一歩。

---

## 95+ 到達のための残ブロッカー

84/100 から 95+ に到達するには：

### Tier 1（HIGH 解消、今週中）
1. **NEW-H-07**: `db.execute(sql\`select 1\`)` への修正 + 2s タイムアウト → health endpoint が信頼できる
2. **NEW-H-08**: `incident_id` を暗号学的乱数 + 6 hex 桁化、サーバ側で採番してクライアントに digest 経由で渡す
3. **H-04**: `force-dynamic` 撤廃 → `unstable_cache` + `revalidateTag` で 30s ISR 化

### Tier 2（観測性の本配線、来週）
4. **M-01**: `@sentry/nextjs` + `posthog-js`/`posthog-node` + `web-vitals` 導入。`instrumentation.ts:register()` を実装、`onRequestError` で `Sentry.captureException`
5. **M-06**: CSP に Sentry/PostHog ドメイン追加、nonce ベースへ前倒し
6. **M-08**: `lib/logger.ts` (pino) で構造化ログ、`requestId`/`incident_id`/`orgId` を全 stdout 出力
7. **`app/api/status/route.ts`** 追加で SLO サマリ JSON 公開（設計書 §24.1）

### Tier 3（信頼性の最後の穴埋め）
8. **M-02**: rate-limit を Upstash Redis に置換
9. **M-03**: audit log の advisory lock or worker queue 化
10. **M-10**: `lib/env.ts` で zod 検証、env 不在 build 失敗

これらを満たせば、設計書 §12.3.1 / §15 / §16 / §17 / §24.1 の主要要件を全てクリアでき、95+ に到達可能。**現状は本番 MVP 投入は可能水準（84/100）だが、観測性 SDK 不在のままだとインシデント発生時に「何が起きたか追えない」状態に変わりはない**ため、Tier 2 を最優先。

---

## 95+ 判定: **NO（現状 84/100、Tier1 + Tier2 完了で 95+ 到達想定）**

R1 の HIGH 6 件のうち 5 件解消、1 件部分解消、新 HIGH が 2 件追加（health endpoint バグ・incident_id 衝突）。エラーハンドリングと DB 健全性はほぼ満点圏に到達したが、観測性軸は SDK 配線が枠だけ・パフォーマンス軸は force-dynamic が継続のため、95+ にはあと一歩。

---

## 引用ファイル（全て絶対パス）

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\error.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\global-error.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\not-found.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\loading.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\dashboard\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\api\health\route.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\auth\callback\route.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\login\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\layout.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\auth\sign-in-form.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\client.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\instrumentation.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\rate-limit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\server.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\next.config.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\package.json`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\dashboard.ts`
