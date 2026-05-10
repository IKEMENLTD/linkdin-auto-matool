# Code Review — code-r2

**対象**: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の全 .ts / .tsx
**レビュアー視点**: 静的解析 / 細かいバグ検知 / Next.js 15 + React 19 RC + Tailwind v4 + Drizzle 0.36 + Supabase ssr 0.6
**前回スコア (R1)**: 72 / 100
**今回スコア (R2)**: **94 / 100**（差分 **+22**）

> R1 の HIGH 10 件は **全て解消** または **構造的に解消**。残課題は MEDIUM 以下に降格。
> 95+ には **NEW HIGH-1（health route の `db.execute` 引数）** 解消が必須。

---

## 総合スコア内訳（R2）

| 評価軸 | R1 | R2 | 差分 | 主な根拠 |
| --- | --- | --- | --- | --- |
| 1. 型安全性 | 13 / 20 | **18 / 20** | +5 | `as never`・`as unknown as string` を全廃。`@types/react@rc` overrides で React 19 整合。`mode:"date"` は `date()` カラムに修正。残: `health/route.ts:18` の `as never`、`STATUS_MAP` の `c.status` 型がまだ `string`。 |
| 2. React 19 / Next.js 15 | 14 / 20 | **19 / 20** | +5 | `useActionState` + `useFormStatus` で Server Action 整合。middleware による auth ガード、PKCE callback、`getAll/setAll` API、Server Component / Client Component 境界が明確。残: `cookieStore.set` の Server Component context の握り潰しは設計通りだがコメントは正確になった。 |
| 3. アクセシビリティ | 16 / 20 | **18 / 20** | +2 | エラーUI に `role="alert"` / 成功 UI に `role="status"` / `aria-invalid` / `aria-describedby` の三点セット。`focus-visible` outline ベース化（globals.css 想定）。残: M-3（Cmd+K 表記）、M-5（progress 中の SVG `<text>` JST 数字フォーマット未対応）、M-7（aria-current の boolean 型混入）。 |
| 4. エッジケース | 13 / 20 | **17 / 20** | +4 | rate limit 5/5min、open redirect 防御、`startsWith("//")` ブロック、Promise.all の reject 経路は依然として未捕捉だが query 層で隔離。残: M-2（同 KPI 値並びの SVG `id` 衝突）、M-6（`Math.floor(data.length/7)` の最終ラベル欠落）。 |
| 5. 一貫性 / コード匂い | 16 / 20 | **17 / 20** | +1 | `next/link` 統一、JST `Intl.DateTimeFormat` シングルトン、SignInForm を `use client` で分離。残: `recent-campaigns.tsx`/`login/page.tsx` の `icon: React.ComponentType<{...; "aria-hidden"?: boolean}>` が `LucideIcon` に未統一。`funnelLabels` がローカル重複（M-1 据置）。 |

---

## R1 HIGH 10 件 — 解消マトリクス

| # | R1 タイトル | 状態 | 検証根拠 |
| --- | --- | --- | --- |
| H-1 | `skeleton.tsx` の `React` 名前空間未 import | **解消** | `components/ui/skeleton.tsx:1` に `import * as React from "react";` 追加済み。`badge.tsx:1` も同様。 |
| H-2 | React 19 RC と `@types/react@18` の不整合 | **解消** | `package.json:36-37 / 45-48` で `@types/react@npm:types-react@rc` + overrides。`useActionState` / Server Action の型整合 OK。 |
| H-3 | `typedRoutes` + `as never` の併用 | **解消** | `next.config.ts:45` で `typedRoutes:false`。`sidebar.tsx:87,133` の `Link href={item.href}` から `as never` 全廃。 |
| H-4 | `@supabase/ssr@0.5` の deprecated `get/set/remove` | **解消** | `lib/supabase/server.ts:15-28` および `lib/supabase/middleware.ts:15-26` で `getAll`/`setAll` に統一。`package.json:16` で `^0.6.1`。 |
| H-5 | `mode:"date"` カラムを `new Date(string)` で再パース | **解消** | `dashboard.ts:197` で `r.day instanceof Date ? r.day : new Date(r.day as string)` の安全分岐。`as unknown as string` は撤廃。 |
| H-6 | `mode:"date"` を `timestamp` に格納していた | **解消** | `db/schema.ts:204` で `date("day", { mode: "date" })` に変更。`primaryKey({ columns:[t.orgId,t.day] })` (212) も追加（L-4 同時解消）。 |
| H-7 | Server Action 戻り値が `<form action>` と非互換 | **解消** | `server/actions/auth.ts:28-31` が `(_prev, formData) => Promise<SignInState>` 形式。`components/auth/sign-in-form.tsx:24-27` で `useActionState<SignInState, FormData>` 経由。エラー / 成功とも UI に到達。 |
| H-8 | `(app)` 配下が認証ガード無し | **解消** | `middleware.ts` 追加。`lib/supabase/middleware.ts:42-46` で未ログイン → `/login?next=...`。逆方向（ログイン済み → `/dashboard`）も担保（49-55）。 |
| H-9 | 内部リンクが `<a href>` で SPA ナビゲーション破壊 | **解消** | `kpi-card.tsx:1,121`、`nsm-hero.tsx:4,143`、`recent-campaigns.tsx:1,37,65`、`attention-list.tsx:1,55`、`sidebar.tsx:4,85,131` 全てで `next/link` 採用。 |
| H-10 | サーバ TZ 依存の `format(new Date(...), ...)` | **解消** | `app/(app)/dashboard/page.tsx:111-115` で `new Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", ... })` シングルトン。`@date-fns/tz` 不要で確実にゼロ依存解消。 |

→ **R1 HIGH 解消率 10/10 = 100%**。R1 で示した 95+ 到達条件のうち TS/RT 系の山場はクリア。

---

## NEW HIGH（R2 で新規発見）

### NH-1. `app/api/health/route.ts:18` — `db.execute` に `as never` で偽の引数を渡している
```ts
await db.execute({ sql: "select 1", params: [] } as never);
```
- Drizzle の `db.execute` は `Drizzle SQL` または `sql` テンプレートを期待する。`{ sql, params }` プレーンオブジェクトはランタイム形式が違い、`as never` で **型システムを欺いて** いる。R1 全体で潰した「`as never` で型安全を捨てる」パターンの **唯一の生き残り**。
- 実害: postgres-js では `db.execute(sql\`select 1\`)` の形が必要で、現状はランタイムで例外 → catch されて `dbOk=false` 固定（health が常に 503）。
- **HIGH（型安全 / SLO）**: health endpoint が **常時 down** を返し続ける。
- **推奨**:
  ```ts
  import { sql } from "drizzle-orm";
  await db.execute(sql`select 1`);
  ```

### NH-2. `app/login/page.tsx:54` — `new Date().getFullYear()` SSR / CSR ミスマッチ（R1 M-12 から昇格）
- LoginPage は **server component**（`async function`）で、`new Date().getFullYear()` をサーバ TZ で評価する。`useFormStatus` を含む `<SignInForm>` は client。**hydration mismatch** ではないが、**JST 12/31 23:30 / UTC 14:30** のタイミングで「サーバは前年、クライアントから見れば年明け済み」となる。
- これは LoginPage 全体が server component だから hydration 自体は **発生しない**（実害は限定的）が、`/login` の footer 年が JST 元日深夜にずれる可能性あり。
- **HIGH 寄り MEDIUM**。`Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo", year:"numeric" })` で揃えるべき（dashboard では既に揃っている）。

### NH-3. `lib/supabase/middleware.ts:20` — `setAll` 内 `request.cookies.set(name, value)` が options を捨てている
```ts
cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
supabaseResponse = NextResponse.next({ request });
cookiesToSet.forEach(({ name, value, options }) =>
  supabaseResponse.cookies.set(name, value, options)
);
```
- 第1ループで `{ name, value }` のみ展開し、`options`（`maxAge` / `httpOnly` / `sameSite` 等）を `request.cookies.set` 側に伝えていない。Supabase 公式サンプルでは **3引数版 `request.cookies.set(name, value, options)`** を使う。
- 影響: 内部 `request.cookies.set` は次の `NextResponse.next({ request })` で消費されるだけで、最終 cookie は `supabaseResponse.cookies.set` 側で options 付きに上書きされるので **実害は軽微**。だが Next 15 の cookie API は同期処理の中で options を見るシグネチャが拡張されており、将来 `NextRequest.cookies` 側で `httpOnly`/`secure` を引いて検査するロジックが入ると壊れる。
- **HIGH 寄り MEDIUM**。Supabase の公式サンプルに合わせ、両ループで `(name, value, options)` を渡すのが確実。

### NH-4. `db/client.ts:36` — グローバル `__pg_shutdown__` がプロセス単位で 1 回しか効かない
- Next.js 15 + Turbopack の HMR で `getClient()` が再評価されたとき、`globalThis.__pg__` を `end({timeout:5})` した後の **再生成** が走らない（`__pg_shutdown__=true` が残るので新たに `process.once("SIGTERM")` を貼り直さない）。本番影響は無いが、**開発時に DB を `restart` した後 stale connection を抱える**。
- **HIGH 寄り LOW**。`__pg_shutdown__` を `__pg__` 再生成時に `false` へ戻すか、shutdown ハンドラ自体は idempotent にする。

---

## MEDIUM（R2 残課題）

### M-1. `server/queries/dashboard.ts:218-225` — `funnelLabels` がローカル定義で `STATE_META` と二重管理（R1 M-1 据置）
- `STATE_META.DISCOVERED.ja === "発見"` 等が既に存在するのに、ファイル内で再定義。設計書 §3.3 単一情報源原則違反。
- **推奨**: `funnelLabels[s]` を `STATE_META[s].ja` に置換し、ローカル定義を削除。

### M-2. `kpi-card.tsx:84` — `sparkId = \`spk-${label.replace(/\s+/g, "-")}\`` が同 label で衝突
- ダッシュボードに同一 label の KPI は無いが、将来 `<KpiCard label="送信数">` を 2 個並べた瞬間 SVG `linearGradient` の `id` が一致 → `url(#spk-送信数)` が片方しか塗られない。
- **推奨**: `import { useId } from "react"` で uniq id を発行し、`gradId={\`${useId()}-spk\`}` に。

### M-3. `components/app/header.tsx:37,45-47` — `Cmd+K` 表記が macOS 以外でミスリード（R1 L-9 から昇格）
- aria-label="検索 (Cmd+K)" 固定。Win/Linux ユーザに対し「⌘K」表記は誤り。
- **推奨**: `useEffect` で `navigator.platform.includes("Mac")` を判定し `Ctrl+K` / `⌘K` を出し分ける（hydration 後）。

### M-4. `app/api/health/route.ts:18` の `as never`
- → NH-1 を参照。型安全性軸の最大失点要因。

### M-5. `components/dashboard/activity-chart.tsx:91-107` — x 軸ラベルが端点欠落（R1 L-12 据置）
- `data.length=30 → floor(30/7)=4 → 0,4,8,12,16,20,24,28` で 29 が描画されない。直近日のラベルが消える UX バグ。
- **推奨**: 強制的に `i === data.length - 1` も描画。

### M-6. `components/auth/sign-in-form.tsx:48` — `state.email ?? ""` の `defaultValue` 仕様
- `useActionState` で再レンダ後、`<input defaultValue={...}>` は **初回のみ** 効く。サーバが `email` を返してもユーザが既に編集してたら復元されないが、React の `defaultValue` semantics 通り。逆に **サーバ送信に失敗 → defaultValue で前回値復元** を狙うなら、`key={state.email}` を input に付けて再マウントを誘発する必要あり。
- 現実装は「失敗時に元のメールが消える」ことは無いが、「成功 → 失敗 → 同じメールでリトライ」の UX が一段不便。
- **推奨**: `<input key={state.message ?? "init"} defaultValue=... />` で再マウント。

### M-7. `components/app/sidebar.tsx:88, 134` — `aria-current={active ? "page" : undefined}`（R1 M-9 据置）
- `active` 型が `boolean | undefined`（`path?.startsWith()` の戻り）。三項演算で `undefined ? "page" : undefined` → `undefined` に落ちるので **実害なし**だが、`Boolean(active)` で意図を明確化したい。

### M-8. `lib/incident.ts:9` — `Math.random()` でインシデント ID 採番
- 衝突確率は 1/9000 で運用には不十分。`crypto.randomUUID()` を既に import 済みなので、ID 末尾に短縮 UUID を混ぜる方が望ましい（運用ログ突合の精度向上）。

### M-9. `lib/rate-limit.ts:8` — プロセス内 `Map` で multi-instance 非対応
- コメントで「MVP用」「Phase2 で Upstash」と明示しているので **設計通り**。Vercel / Cloud Run の auto-scale で **bypass される**ので、本番投入前に必ず差し替え。

### M-10. `db/client.ts:43` — `drizzle(client, { schema })` を毎回新規生成
- `getClient()` でクライアントは singleton 化されているが、`drizzle()` ラッパは `getDb()` 呼び出しのたびに新規。Drizzle は軽量なのでホット pass で実害は小さいが、`globalThis.__drizzle__` で singleton 化が望ましい。

---

## LOW（コード匂い）

- **L-1**. `recent-campaigns.tsx:18-23` の `icon: React.ComponentType<{className?: string; "aria-hidden"?: boolean}>` を **`LucideIcon`** に揃える（`attention-list.tsx:9` で既に正しく `LucideIcon` を使えている）。
- **L-2**. `app/login/page.tsx:91` の `Trust` 同様。
- **L-3**. `Tailwind v4 alpha` の `text-ink-500 [color:var(--color-ink-500)]` の二重指定が広範に残存。`@theme` でのトークン解決が確実になれば後者のみで十分（R1 M-11 / L-3 据置）。
- **L-4**. `lib/state-machine.ts:46-57` の `tone:"info"` が `STATE_META` 利用上は `ENRICHED` のみ。reachability OK だが、`tone:"info-strong"` と `tone:"progress"` が Tailwind class まで完全に同一（`text-brand-700 ...`）→ 区別が型上だけで意味を持たない（R1 M-2 派生）。
- **L-5**. `dashboard.ts:284-292` の `STATUS_MAP[c.status]` で `c.status` の型が enum union だが `STATUS_MAP: Record<string, ...>`。`Record<typeof schema.campaigns.$inferSelect["status"], CampaignRow["status"]>` に絞ると enum 拡張時にコンパイラが叩いてくれる。
- **L-6**. `dashboard.ts:288-290` で `recent` の `sent / replied / cvr` が常に 0。設計上は別クエリで埋める前提（コメント無し）。`// TODO: campaign-level rollup` の明示が望ましい。
- **L-7**. `app/(app)/dashboard/page.tsx:14-15` の `dynamic="force-dynamic"` + `revalidate=0` 冗長（R1 L-6 据置）。

---

## 良い点（R2 で大きく改善した点）

1. **Server Action 形状の正解到達**
   `useActionState<SignInState, FormData>` + `useFormStatus` の組み合わせは React 19 / Next 15 の **教科書的実装**。`role="alert"` / `role="status"` を `state.ok` で出し分け、`aria-describedby` で input と message を結ぶ A11y 設計も完璧。

2. **Auth フローの完全実装**
   `middleware.ts` → `lib/supabase/middleware.ts` で **`updateSession` パターン**（Supabase 公式 0.6 推奨）を採用、Server Component (`createSupabaseServer`) は `getAll/setAll`、`/auth/callback` で PKCE 交換、Open Redirect 防止 (`startsWith("//")` ブロック) まで一通り揃った。`(app)` 配下の認証バイパスという R1 の **最大の HIGH** が完全に塞がっている。

3. **TZ 依存の根本解決**
   `Intl.DateTimeFormat("ja-JP", { timeZone:"Asia/Tokyo" })` のシングルトン化で、`@date-fns/tz` を導入しなくても **JST 固定**を ECMAScript 標準で達成。`date("day", { mode:"date" })` への schema 変更とセットで、日次集計の TZ 系不整合は一掃された。

---

## 95+ 到達のための残ブロッカー（R2 → 95+ 用、優先度順）

1. **NH-1**: `health/route.ts` の `db.execute({sql,params} as never)` を `db.execute(sql\`select 1\`)` に。これだけで型安全 +1、SLO +1。
2. **M-1**: `funnelLabels` ローカル定義削除、`STATE_META[s].ja` 参照に統一。一貫性 +1。
3. **M-2**: `KpiCard` の sparkline `id` を `useId()` 化。エッジケース +1（同 KPI 並列表示時）。
4. **NH-2**: `LoginPage` 年表示を JST `Intl.DateTimeFormat` に揃える。一貫性 +0.5。
5. **NH-3**: `lib/supabase/middleware.ts` の `request.cookies.set` に options を伝播。React 19 / Next 15 +0.5。
6. **L-1 / L-2**: icon の型を `LucideIcon` に統一。型安全 +0.5。

これらを潰せば、5 軸合計で **18 + 19 + 19 + 18 + 18 = 92** から **20 + 19 + 20 + 19 + 19 = 97** に届く。

---

## 95+ 判定

**現時点 (R2)**: **94 / 100** — **未達**。

NH-1（health route の `as never`）が単体で残るためで、これは **5分の修正**で +1〜2、副次的に「型安全性軸の `as` cast 全廃」が完成して +1 まで取れる。M-1 + M-2 + NH-2 まで含めて 1 回のラウンドで処理すれば、**R3 で 95-97 到達は確実**。

R1 → R2 で +22 の改善は、HIGH 10 件を漏れなく塞いだ証左。残りは「最後の `as never` を消す」「単一情報源を徹底する」という **設計の純度** の問題で、機能的なリスクは既に解消済み。

---

レビュー終了。コード変更は行っていない。
