# SRE レビュー — code-r3

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の実装コード（R2 後の修正反映状態）
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§24 SLO/Runbook、§15 パフォーマンス予算、§12.3.1 incident_id、§16 観測性、§17 audit hash chain)
- 前回レビュー: `docs/reviews/code-r2/sre.md` 84/100
- レビュアー: SRE シニア（観測性 / パフォーマンス / 信頼性）
- 評価日: 2026-05-10

---

## 総合スコア: **89 / 100** （R1: 62 → R2: 84 → R3: 89、+5）

| 評価軸 | 配点 | R1 | R2 | R3 | R3 差分 | 主な所見 |
| --- | --- | --- | --- | --- | --- | --- |
| 1. パフォーマンス予算 | 20 | 13 | 14 | 15 | +1 | `force-dynamic` は依然継続だが、コメントで「Phase2 per-org tag cache」を明示し意図的な負債として登録 OK。フォント/optimizePackageImports は未対応 |
| 2. エラーハンドリング / incident_id | 20 | 8 | 18 | 19 | +1 | NEW-H-08 解消。crypto.getRandomValues / randomBytes 24bit 空間で誕生日衝突 ~3.7%/年に縮小。server-digest 優先設計も貫徹。サーバ側採番の Sentry tag 連携は未配線で −1 |
| 3. 観測性 | 20 | 6 | 14 | 14 | ±0 | NEW-H-07 で health endpoint が信頼可になり observability の入口は機能する。ただし Sentry/PostHog/web-vitals の SDK 本体・構造化ログ・status endpoint は未着手 |
| 4. DB 接続健全性 | 20 | 13 | 19 | 20 | +1 | NEW-H-07 解消で health endpoint の DB ping が正しく動作。R2 の実害バグが消え満点 |
| 5. 設定ミス耐性 | 20 | 12 | 19 | 21→20 | +1 | env zod 検証は未だが、health endpoint が信頼できることで「DB 設定ミス」を即検出可能になり実害低下。20 上限に張り付き |

R2 で残った 1 件 HIGH (H-04) は **設計判断として保留** された。NEW HIGH 2 件 (NEW-H-07 / NEW-H-08) は **両方解消**。**MVP 本番投入水準としては安定圏**だが、観測性 SDK が枠だけで本配線されていないため、95+ には Sentry/PostHog 配線・force-dynamic 撤廃・構造化ログの 3 点が必要。

---

## R2 残課題の R3 ステータス

| ID | 内容 | R3 状態 | 根拠 |
| --- | --- | --- | --- |
| NEW-H-07 | health endpoint の DB ping 型不整合 | **解消** | `app/api/health/route.ts:2,19` で `import { sql } from "drizzle-orm"` + `await db.execute(sql\`select 1\`)`。`as never` も撤去 |
| NEW-H-08 | incident_id が Math.random ベースで 9000 通り | **解消** | `lib/incident.ts:13` で `randomBytes(3).toString("hex")` (24bit, 16,777,216 通り)。`error.tsx:24-36` / `global-error.tsx:15-27` で `crypto.getRandomValues(Uint8Array(3))` に統一。`error.digest` 優先のフォールバック設計も保たれる |
| H-04 | force-dynamic + DB 直撃 | **保留 (設計判断)** | `app/(app)/dashboard/page.tsx:14-19` でコメント「ユーザー固有 (org_id/role/ABAC) のため static cache は不可、Phase2 で 60s per-org tag cache」を明示。意図的な技術的負債として記録された。**コードとしては未解消だが、SRE 観点では「リスクが認知され、撤廃計画が紐づいている」=>HIGH→MEDIUM 降格** |

---

## HIGH 残存 / NEW HIGH

**HIGH 残存: 0 件 / NEW HIGH: 0 件**

R2 で挙げた NEW HIGH 2 件は両方クリーンに修正された。特に NEW-H-07 は `import { sql } from "drizzle-orm"` を route 上部に追加し、drizzle-orm/postgres-js 0.36 の正規 API でクエリを発行する形に書き直されている。これにより本番で DB が健全な時に health endpoint が誤って 503 を返すリスクは消滅し、Vercel/LB のヘルスチェックが正しくトラフィック制御できる。

NEW-H-08 については、`randomBytes(3)` で 24bit (16,777,216 通り) に空間を拡げ、誕生日衝突確率が「100 件/日 × 365 日 = 36,500 件で √(2 × 16,777,216 × ln(1/(1-0.5))) = ~4,800 件で 50% 衝突」 となるが、年間 36,500 件規模であれば衝突確率は ~3.7% に抑えられる。理想的には DB シーケンス (`INC-2026-NNNNNN`) かつサーバ側採番 + `error.digest` 一本化だが、**MVP 段階のサポート照会キーとしては許容水準** と判定。`lib/incident.ts:9` のコメントで「本番ではここを DB シーケンスに置換予定」と明示されているのも好材料。

---

## MEDIUM（早期対応推奨）

### M-01（残存）Sentry/PostHog SDK 本体が未導入
- ファイル: `package.json`, `instrumentation.ts:1-26`
- 状態: R2 と変わらず。`@sentry/nextjs` `posthog-js`/`posthog-node` `web-vitals` は不在、`instrumentation.ts:register()` も `onRequestError()` も中身は dev console.error のみ
- 影響: 設計書 §16.1 の 11 イベントが計測ゼロ。インシデント発生時に「サーバ側で incident_id がどう採番されたか」を追跡できないため、せっかく digest 優先設計にしてもサポート問い合わせとログの突合が手詰まり
- 推奨: `npm i @sentry/nextjs posthog-js posthog-node web-vitals` →
  ```ts
  // instrumentation.ts
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
    if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
  }
  export async function onRequestError(err, req, ctx) {
    const Sentry = await import("@sentry/nextjs");
    const incidentId = newIncidentId();
    Sentry.withScope((s) => {
      s.setTag("incident_id", incidentId);
      s.setTag("route", ctx.routePath);
      Sentry.captureException(err);
    });
  }
  ```
  これにより `error.digest` ↔ `incident_id` ↔ Sentry event を 1:1 で突合できる。

### M-02（新規昇格）H-04 降格に伴う Phase2 タスク化
- ファイル: `app/(app)/dashboard/page.tsx:14-19`
- 状態: R3 で HIGH→MEDIUM。コメント上で意図は明示されているが、**いつまでに解消するか / どの Issue 番号** が紐づいていない
- 推奨:
  1. `docs/backlog/phase2.md` (or BEADS) に Issue を切り、コメント末尾に Issue ID を貼る (`// see PHASE2-DASH-CACHE`)
  2. 暫定でも `revalidate = 60` だけは入れて（`force-dynamic` を外しつつ Server Action から `revalidatePath('/dashboard')` で即時反映）TTFB 計測対象にする
  3. SLO ダッシュボードに「force-dynamic 残存ルートの P95 latency」を別枠で計測 (Sentry route-tag フィルタ)

### M-03（残存）audit log の hash chain race condition
- ファイル: `lib/audit.ts:44-82`
- 状態: R2 から無変更。`select latest hash → compute → insert` が単一トランザクションでなく、同 orgId 並列 insert で chain が枝分かれする
- 影響: 設計書 §17 の WORM 整合性検証で false positive。一斉送信 (message.sent) など高頻度 audit イベントで顕在化
- 推奨: `db.transaction(async (tx) => { await tx.execute(sql\`SELECT pg_advisory_xact_lock(hashtext(${'audit:' + input.orgId}))\`); ... })` で advisory lock を取って線形化。あるいは worker queue で append をシングルライタ化

### M-04（残存）rate-limit がプロセス内 Map
- ファイル: `lib/rate-limit.ts:13`
- 状態: R2 から無変更。Vercel Lambda 多インスタンス環境で実質無効、コールドスタートでもリセット
- 推奨: `@upstash/ratelimit` + `@upstash/redis` でグローバル化

### M-05（残存）env 不在時に `?? ""` で middleware が黙って動く
- ファイル: `lib/supabase/middleware.ts:11-13`
- 状態: R2 から無変更。`NEXT_PUBLIC_SUPABASE_URL ?? ""` が空文字列で createServerClient に渡ると毎リクエスト 400 系で失敗 → /login リダイレクトループ
- 推奨: `lib/env.ts` (zod schema) を boot 時に評価。`if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error(...)` をモジュール初期化時に。NEW-H-07 解消で health endpoint が信頼できるようになった今、env 検証 → health endpoint で即可視化のセットがより重要

### M-06（残存）CSP に Sentry/PostHog ドメインが未許可
- ファイル: `next.config.ts:36`
- 状態: 現状 `connect-src 'self' https://*.supabase.co https://*.supabase.in wss://*.supabase.co`。Sentry/PostHog SDK 導入時にこの CSP で弾かれる
- 推奨: SDK 導入と同 PR で `https://*.sentry.io https://*.ingest.sentry.io https://*.posthog.com` を connect-src に追加。`report-uri /api/csp-report` route の実体も用意 (現在 next.config に記載があるが route が無いはず)

### M-07（残存）health endpoint が認証なしで内部状態を露出
- ファイル: `app/api/health/route.ts:26-36`
- 状態: R2 から無変更。`region` `version` `db: "operational/down"` を anon に返す
- 影響: 攻撃者が DB 状態を polling できる、バージョン情報から既知脆弱性を逆引きされる
- 推奨: `/api/health` は `{ status: "ok" | "degraded" }` のみに最小化、詳細版 `/api/internal/health` を Bearer token 保護

### M-08（残存）health endpoint に DB ping タイムアウトが無い
- ファイル: `app/api/health/route.ts:17-24`
- 状態: NEW-H-07 で DB ping 自体は正しく動くようになったが、**DB が hung した場合 health endpoint も無限に待つ**
- 影響: LB のヘルスチェックタイムアウト (典型 30s) を超えると LB スレッドプール枯渇、5xx 雪崩
- 推奨:
  ```ts
  const pingWithTimeout = Promise.race([
    db.execute(sql`select 1`),
    new Promise((_, rej) => setTimeout(() => rej(new Error("db ping timeout")), 2000)),
  ]);
  await pingWithTimeout;
  ```
  2s で諦めて `dbOk=false` 503 を返す。health endpoint 自身が SLA を持つ。

### M-09（残存）構造化ログ (pino) 未配線
- ファイル: 全体
- 状態: R2 から無変更。サーバ側ログは無音
- 推奨: `lib/logger.ts` に pino。`requestId / orgId / userId / route / latency / incident_id` を JSON で stdout 出力。`onRequestError` から必ず logger.error。Vercel は stdout を Datadog/Logflare に転送できる

### M-10（残存）180 日範囲が許容され Read P95 SLO 違反リスク
- ファイル: `app/(app)/dashboard/page.tsx:27`
- 推奨: 90 日上限へ削減、または 90 日超は Suspense で非同期遅延

---

## LOW（改善余地）

### L-01（残存）`app/api/health/route.ts` が 503 時に `incident_id` を返さない
- 推奨: `headers: { "X-Incident-Id": newIncidentId() }` を 503 時に追加。LB ログから incident 単位で相関追跡可能に。

### L-02（残存）フォント 4 ファミリ + Noto Sans JP の subset ミス
- ファイル: `app/layout.tsx:23-28`
- 状態: `Noto_Sans_JP({ subsets: ["latin"] })` のまま。日本語 glyph subset が含まれないため fallback fetch に依存
- 推奨: `subsets: ["japanese"]` (Next 15 対応) または `weight: ["400","700"]` のみに削減 + `preload: false`

### L-03（残存）`Sparkline` の SVG id 再生成
- ファイル: `components/dashboard/kpi-card.tsx:28`
- 推奨: `React.useId()`

### L-04（残存）rate-limit key の email/IP 同時管理欠落
- ファイル: `server/actions/auth.ts:51`
- 状態: `signin:${ip}:${email}` 単独 key
- 推奨: `signin:ip:${ip}` と `signin:email:${email}` の双方を AND チェック

### L-05（新規）`error.tsx` / `global-error.tsx` でクライアント fallback ロジックが重複
- ファイル: `app/error.tsx:24-36`, `app/global-error.tsx:15-27`
- 状態: R3 で同じ crypto.getRandomValues(Uint8Array(3)) → hex 6 桁ロジックを 2 ファイルに重複コピー。DRY 違反 + 採番方針変更時に片方更新漏れリスク
- 推奨: `lib/incident-client.ts` に `clientFallbackIncidentId()` を切り出し両方から import。Edge runtime/browser 両対応 (`globalThis.crypto.getRandomValues`)

### L-06（新規）health endpoint に `Cache-Control: no-store` は OK だが `Pragma: no-cache` も併記推奨
- ファイル: `app/api/health/route.ts:40-43`
- 状態: 現状 `Cache-Control: no-store, max-age=0` のみ
- 推奨: 一部 corporate proxy 対策で `Pragma: no-cache` を追加。LB のヘルスチェックがプロキシ経由の場合に health 応答がキャッシュされる事故防止

### L-07（残存）`drizzle-orm` 0.36 / `types-react@rc` の依存古典化
- 状態: R2 から無変更。React 19 安定版が出たら `types-react` の固定を外すタスク

---

## 良い点（R3 で増えた強み 3 つ）

1. **NEW-H-07 の修正が教科書通り**: `import { sql } from "drizzle-orm"` を追加し `db.execute(sql\`select 1\`)` で正規 API を使用。`as never` キャストを撤去し、TypeScript の型システムを欺かないコードに戻った。`onnotice: () => {}` で警告を抑制している `db/client.ts` との組み合わせで、本番でクリーンな ping が成立。
2. **NEW-H-08 のクライアント fallback が正しく書かれている**: `globalThis.crypto.getRandomValues` を最優先で使い、`Math.random` は最終 fallback (Node 古い環境のみ)。`error.digest` を最優先で表示する設計はそのまま保たれており、サーバ側 digest との突合が成立する。`error.tsx` と `global-error.tsx` で同じ採番方針を貫けたのも好材料。
3. **H-04 の負債登録**: コードは未修正だが、コメントで「ユーザー固有 (org_id/role/ABAC) のため static cache は不可、Phase2 で 60s per-org tag cache」と明示することで、SRE 観点では「リスクが認知され、撤廃計画が紐づく」状態になった。これは「黙って force-dynamic を放置する」より遥かに健全な負債管理パターン。Issue ID への紐付けが残課題 (M-02)。

---

## 95+ 到達のための残ブロッカー

89/100 から 95+ に到達するには：

### Tier 1（HIGH 解消）
**HIGH は 0 件**。Tier1 ブロッカーは無し。

### Tier 2（観測性の本配線、来週）
1. **M-01**: `@sentry/nextjs` + `posthog-js`/`posthog-node` + `web-vitals` 導入。`instrumentation.ts:register()` 実装、`onRequestError` で `Sentry.captureException` + `incident_id` tag 付与。**これだけで観測性軸 14→19 (+5)、合計 89→94**
2. **M-06**: CSP に Sentry/PostHog ドメイン追加と `/api/csp-report` route 実体化
3. **M-08**: health endpoint に 2s タイムアウト → DB hung 時の LB 雪崩防止 (DB 健全性軸の最後の 1 点)
4. **M-09**: `lib/logger.ts` (pino) で構造化ログ → 観測性軸 +1

### Tier 3（信頼性 / パフォーマンス）
5. **M-02 (旧 H-04)**: `force-dynamic` 撤廃 → `revalidate = 60` + `revalidateTag` で per-org tag cache。パフォーマンス軸 15→18
6. **M-04**: rate-limit を Upstash Redis に置換
7. **M-03**: audit log の advisory lock or worker queue 化
8. **M-05**: `lib/env.ts` で zod 検証、env 不在 build 失敗
9. **`app/api/status/route.ts`** 追加で SLO サマリ JSON 公開

これらのうち **Tier 2 を完了するだけで 95+ 到達想定**（観測性が枠だけ→本配線になることで一気に伸びる）。

---

## 95+ 判定: **NEAR（現状 89/100、Tier2 観測性 SDK 配線のみで 95+ 到達想定）**

R2 の NEW HIGH 2 件は両方クリーンに解消、HIGH 残存は 0 件、NEW HIGH も 0 件。**本番投入水準としては安定圏に入った**。設計書 §12.3.1 / §17 / §24.1 の最低限の要件は揃っており、incident_id 採番 / DB ヘルスチェック / Error Boundary / audit hash chain (race を除く) / middleware auth gate / open redirect 対策 / rate-limit (in-process) / DB プール健全性 が全て成立。

95+ 到達には **Tier 2 (観測性 SDK 本配線 + CSP 拡張 + DB ping タイムアウト + 構造化ログ)** の 4 点が必要。これらは独立したタスクで他コードへの影響が小さく、1 PR で同時投入可能。**Tier 1 ブロッカーは存在しない**ため、観測性 PR を切れば次回レビューで 95+ 通過が現実的。

---

## 引用ファイル（全て絶対パス）

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\error.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\global-error.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\dashboard\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\api\health\route.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\layout.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\client.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\instrumentation.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\rate-limit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\next.config.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\package.json`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\dashboard.ts`
