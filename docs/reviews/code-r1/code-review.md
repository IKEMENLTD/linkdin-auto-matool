# Code Review — code-r1

**対象**: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の全 .ts / .tsx
**レビュアー視点**: 静的解析 / 細かいバグ検知 / Next.js 15 + React 19 RC + Tailwind v4 alpha + Drizzle 0.36 + Supabase ssr 0.5 + date-fns v4
**スコア**: **72 / 100**

---

## 総合スコア内訳

| 評価軸 | 点数 | 講評 |
| --- | --- | --- |
| 1. 型安全性（any / as cast / Drizzle 型 / infer 型） | **13 / 20** | `as never` の `Link href` 抜け道、`React` 名前空間の暗黙参照、`mode: "date"` カラムの string 扱い、`as unknown as string` 型変換の欠落、tone union の `info` が `STATE_META` に未定義など複数の compile-error 候補。 |
| 2. React 19 / Next.js 15 の使い方 | **14 / 20** | `searchParams: Promise<...>` は正しいが、Header / Sidebar が `"use client"` でありながら server-only な props を受け取る前提が曖昧。`<a href>` での内部遷移が複数あり Server Component の prefetch を捨てている。 |
| 3. アクセシビリティ | **16 / 20** | `aria-label`、`role`、`aria-current`、`aria-valuenow` の三重表現は良好。一方で focus ring が Tailwind v4 の box-shadow 上書きで消える、SVG `<text>` の locale 数字未対応、検索ボタンの kbd 表記など改善余地。 |
| 4. エッジケース | **13 / 20** | 空配列 `Math.max(...[])` 防御は概ね有り。NaN 連鎖（`prev.sent` が文字列の場合）、SVG path id のコリジョン、`-Infinity` ガード漏れ、IME composition 未制御、Promise reject パスなし。 |
| 5. 一貫性 / コード匂い | **16 / 20** | 命名は概ね統一。一方で Mock と Live の戻り値が部分的に乖離（`attention`/`recent` が live で常に空）、内部リンクの href 直書きと `next/link` の混在、`React` 側の import 揺れ、未使用 import なし。 |

---

## HIGH（コンパイル / ランタイムで実害が出る可能性が高い）

### H-1. `components/ui/skeleton.tsx:3` — `React` 名前空間が未 import
```ts
export function Skeleton({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
```
- 同ファイルは `import * as React from "react"` を行っていない（他の `card.tsx` / `button.tsx` / `state-chip.tsx` は import している）。
- `tsconfig.json` の `"jsx": "preserve"` + 新 JSX transform 環境では、グローバル `React` は **存在しない**。`@types/react@18` でも `JSX.IntrinsicAttributes` は global 解決されるが、`React.HTMLAttributes` は **モジュール参照が必要**。
- **HIGH**: `tsc --noEmit` で `Cannot find namespace 'React'.` になる可能性が極めて高い。
- 推奨: `import * as React from "react";` を追加する。または `import type { HTMLAttributes } from "react"` で受け取る。

### H-2. `package.json:27 / 35` — React 19 RC と `@types/react@18` の不整合
```json
"react": "19.0.0-rc-66855b96-20241106",
"@types/react": "^18.3.12",
```
- React 19 では `forwardRef` の挙動・`use()` API・`Action` 型・`form` action prop の型などが変わる。`@types/react@18` ではこれらが追跡されておらず、`forwardRef<HTMLButtonElement, ButtonProps>` の戻り型推論が壊れる、もしくは `<form action={signInWithMagicLink}>`（`app/login/page.tsx:30`）でユーザーランド型が `(formData: FormData) => void | Promise<void>` を期待され、現在の `Promise<{ ok: false, error: string }>` 戻り値で型エラーになる。
- **HIGH**: Server Action を form action に直接渡している以上、`@types/react@19.0.0-rc.x` への移行は必須。
- 推奨: `@types/react`/`@types/react-dom` を React 19 RC 系に揃える。`pnpm overrides` / `npm overrides` で固定。

### H-3. `next.config.ts:5-7` — `experimental.typedRoutes` と `Link href as never` の併用
```ts
experimental: { typedRoutes: true },
```
```tsx
// components/app/sidebar.tsx:82 / 127
<Link key={item.href} href={item.href as never} ...>
```
- `typedRoutes` を有効にしている場合、`href` は `Route<string>` 型で受ける。`item.href` は `string`（NavItem.href: string）。これを `as never` でキャストするのは「型システムを欺く」コードであり、レビュー観点で **NG**。
- 加えて `/connections/linkedin?tab=safety` のようなクエリ付き href が後で `attention` 等に登場するが、`typedRoutes` 配下では `?tab=safety` 部分の型推論が効かないため、実体としての路線も崩れる。
- 推奨:
  - NavItem.href を `Route` 型で持たせる（`import type { Route } from "next"`）。
  - `as never` を撤廃し、`href={item.href as Route}` にするか `string` に asserts するヘルパで境界を明示。

### H-4. `lib/supabase/server.ts:11-26` — `@supabase/ssr@0.5` で deprecate された API
```ts
cookies: {
  get(name) { ... },
  set(name, value, options) { ... },
  remove(name, options) { ... },
},
```
- `@supabase/ssr@0.5` は **`getAll` / `setAll`** を推奨し、`get`/`set`/`remove` 個別 API は deprecate。Next 15 の async cookies 環境では `setAll` でないと middleware からの cookie set が壊れるケースがある（公式 0.5.x のリリースノート）。
- さらに、`cookies()` が `Promise<ReadonlyRequestCookies>` を返す Next 15 で、`cookieStore.set(...)` を Server Component から呼ぶと **必ず** throw する（try/catch で握り潰しているが、Server Action 経由では Server Component context ではないため別経路）。
- **HIGH**: 実際に Magic Link の callback で session cookie が永続化されない可能性。
- 推奨:
  ```ts
  cookies: {
    getAll: () => cookieStore.getAll(),
    setAll: (toSet) => {
      try { toSet.forEach(({name, value, options}) => cookieStore.set(name, value, options)); }
      catch {}
    },
  }
  ```

### H-5. `server/queries/dashboard.ts:127` — `mode: "date"` カラムを `new Date(string)` で再パース
```ts
const key = formatISO(new Date(r.day as unknown as string), { representation: "date" });
```
- Drizzle の `timestamp(..., { mode: "date" })` は **JS Date** を返す型推論。`r.day` の型は `Date` のはず。それを `as unknown as string` で文字列にキャストしてから `new Date(...)` するのは二重に誤り。
- **HIGH**: `drizzle-orm@0.36` で `mode: "date"` の戻りは `Date` のはず。仮に postgres-js の生値（string）を経由していても、`as unknown as string` は型システムを欺いており、TZ 解釈が UTC ↔ ローカルでずれる温床。
- 推奨: `r.day` を `Date` として扱い、`formatISO(r.day, { representation: "date" })` のみで完結させる。

### H-6. `server/queries/dashboard.ts:202` — `mode: "date"` カラムなのに timestamp に値を入れる前提のクエリ
```ts
day: timestamp("day", { withTimezone: true, mode: "date" }).notNull(),
```
- スキーマで `withTimezone: true` + `mode: "date"` は **動作はするが警告**。`gte(schema.dailyMetrics.day, from)` で渡す `from` は `startOfDay(new Date())` の Date（ローカル深夜0時）。これを timestamptz と比較するため、JST 深夜0時 → UTC 15:00 となり、**前日のレコードを誤ってヒット** する可能性がある。
- **HIGH**: 日次集計の Off-by-1 day。
- 推奨: `mode: "date"` を使うなら `date` 型カラムにする（`pg-core` の `date` ヘルパ）か、`startOfDay` 計算を UTC で揃える。

### H-7. `server/actions/auth.ts` — Server Action の戻り値が `<form action={...}>` と非互換（React 19）
```ts
// page.tsx:30
<form action={signInWithMagicLink} className="space-y-3">
```
```ts
// auth.ts
export async function signInWithMagicLink(formData: FormData) {
  ...
  return { ok: false, error: "メール..." } as const;
}
```
- React 19 + Next 15 では、`<form action>` に渡す Server Action は **`void | Promise<void>`** または `useActionState` 経由で `(prevState, formData) => state` が標準。値を返しても UI に反映されない上、戻り値を `as const` で union 化しているため呼び出し側で受けられない。
- 結果としてエラーが UI に出ず、ユーザー体験は **silent fail**。
- 推奨: `useFormState`（React 19 では `useActionState`）に置き換え、`(prevState, formData) => state` 形に。

### H-8. `app/page.tsx:1-5` — `redirect("/dashboard")` が `(app)` ルートグループ前提
```ts
import { redirect } from "next/navigation";
export default function HomePage() { redirect("/dashboard"); }
```
- 機能上は問題ないが、`/dashboard` は `app/(app)/dashboard/page.tsx` にある。`(app)` ルートグループ自体は URL に出ないので OK。ただし **未認証ユーザーの redirect** ロジックがどこにも無く、誰でも `/dashboard` に直アクセスできる。**Supabase Auth の middleware が無い**（`middleware.ts` 自体が repo に存在しない）。
- **HIGH**: 認証バイパス。`signInWithMagicLink` は実装されているのに、ガードする middleware がない。
- 推奨: `middleware.ts` を作成し、`(app)` 配下を `supabase.auth.getUser()` で守る。

### H-9. `components/dashboard/kpi-card.tsx:59` — `Wrap: React.ElementType = href ? "a" : "div"`
```ts
const Wrap: React.ElementType = href ? "a" : "div";
```
- 内部リンク `/campaigns` 等を `<a>` で出している。**`next/link` が使われていない** ため、Next 15 のクライアントナビゲーションと prefetch が効かない。SPA 体験を捨てている。
- 同件は `nsm-hero.tsx:86`（`<a href="/campaigns">`）、`recent-campaigns.tsx:33,56`、`attention-list.tsx:48` にもある。
- **HIGH（UX/性能）**: ダッシュボード→詳細遷移のたびにフルリロード。
- 推奨: `next/link` の `Link` で wrap する。`typedRoutes` を考慮するなら `Route` 型に揃える。

### H-10. `app/(app)/dashboard/page.tsx:33` — `format(new Date(snapshot.range.from), "M月d日")` のサーバ TZ 依存
```tsx
subtitle={`${format(new Date(snapshot.range.from), "M月d日", { locale: ja })} ...`}
```
- `snapshot.range.from` は ISO 文字列で `from.toISOString()` から作られているが、**サーバの TZ** で `format` される。Vercel など UTC サーバで実行されると、JST 深夜帯で日付が 1 日ずれる。
- date-fns v4 では `toZonedTime`（旧 `utcToZonedTime`）を **`@date-fns/tz`** から import する形に変わっている。**`date-fns` 本体には timezone API がない**。
- **HIGH**: 日付が 1 日ズレる。
- 推奨: `@date-fns/tz` を導入し `tz('Asia/Tokyo')` で format する。

---

## MEDIUM（バグ予備軍 / 仕様逸脱）

### M-1. `server/queries/dashboard.ts:145-156` — `funnel` の状態と STATE_META が未一致
- `funnelLabels` をローカルで定義しているが、`STATE_META.DISCOVERED.ja === "発見"` 等とラベルが完全に重複している。**lib/state-machine.ts の単一情報源**を捨てており、将来の表記変更時に同期漏れが起きる。
- 推奨: `STATE_META[s].ja` を直接参照する。

### M-2. `lib/state-machine.ts:46 / 78` — `tone: "info"` が STATE_META に存在しない
```ts
tone: "neutral" | "info" | "info-strong" | ...
```
- 型上 `info` を許容しているが、`STATE_META` のどの state も `info` を指定していない。一方で `TONE_CLASS.info` は定義済み。**実害はない** が、`StateMeta["tone"]` の reachable union と実利用 union が乖離。
- 推奨: 使わない tone は union から除く、もしくは "info" を使う state を 1 つ用意する。

### M-3. `components/dashboard/kpi-card.tsx:28,35` — SVG `<linearGradient id>` がコリジョン
```ts
<linearGradient id={`spk-${values.join("-")}`}>
```
- 同じ KPI 値（例: `[0,0,0,...]` の sparkline）が 2 個並ぶと **同一 id** になり、SVG の `url(#...)` 解決が壊れて片方の塗りが消える。
- 推奨: `useId()`（React 18+）で uniq id を生成。

### M-4. `components/dashboard/activity-chart.tsx:24` — `Math.max(... d.replied * 4 ...)` のスケーリングが不透明
- スケール統一のために `d.replied * 4` / `d.meeting * 8` を使っているが、tooltip も legend も無いため **視覚的に誤解を招く**（実際は値ではない）。アクセシビリティ的にも `aria-label="日次活動量チャート"` だけで内容が伝わらない。
- 推奨: 値そのものではなく per-axis スケールにするか、`<title>`/`<desc>` で系列ごとの値を読み上げ可能に。

### M-5. `components/dashboard/funnel.tsx:42` — `prev` 0 件時に `cvr=null` 表示「—」
- 良い処理だが、`steps` が空配列のときに `Math.max(...[],1)` で `max=1` になり OK。一方 `steps[0]` のみ存在で `count=0` のとき、`widthPct=0` なので `Math.max(widthPct, 8)` で常に最小 8% 描画される。**0 と 1 件が見分けつかない**。
- 推奨: `step.count === 0` のとき `liquid-bar` を出さず空表示。

### M-6. `app/login/page.tsx:30-63` — `<form action>` でクライアント側エラー UI が無い
- Magic Link 送信失敗時、Server Action は `{ ok: false, error: ... }` を返すが、**クライアントは何も表示しない**（H-7 と関連）。
- 推奨: `useActionState` を使う Client Component に切り出し、`error` をフィードバック。

### M-7. `lib/formatters.ts:21` — 日本語数字単位の閾値定数が読みづらい
```ts
if (n >= 1_0000_0000) return ...
```
- 機能は正しい（億 = 10^8、万 = 10^4）が、`1_0000_0000` を **1 億** とすぐ読める人は限定的。コメントで `// 1億` と添えるべき。
- 推奨: `const OKU = 100_000_000; const MAN = 10_000;`。

### M-8. `db/client.ts:6-9` — `globalThis.__pg__` の型注入が `var` で eslint-disable
- 機能は OK。Next.js の HMR で connection pool を 1 つに保つ常套テクニック。
- ただし `process.env.DATABASE_URL` 未設定時に `null` を返す → `getDashboardSnapshot(null, ...)` で `mockSnapshot` に逃げる流れは **デモ用としてしか動かない実装** で、本番では「ただの sentinel」になっている。
- 推奨: `getDb()` が null になる経路を本番ビルドでは disallow にする（`process.env.NODE_ENV === "production"` で throw）。

### M-9. `components/app/sidebar.tsx:77 / 123` — `path?.startsWith(item.href + "/")` の判定が不安定
```ts
const active = path === item.href || path?.startsWith(item.href + "/");
```
- `path` は `usePathname()` で `string | null`。null 時は `path === item.href` が false、`path?.startsWith(...)` が undefined。`active` が `string | undefined | boolean`。`aria-current={active ? "page" : undefined}` で `string` を渡すと aria spec 上は `"true"|"false"|"page"|"step"|"location"|"date"|"time"` のため **本来 boolean 文字列以外不可**。
- **MEDIUM**: TS では型は通ってしまうが、a11y 上 `aria-current="true"` 等の意図しない値が出る恐れ。
- 推奨: `Boolean(active)` で確実に boolean にしてから `? "page" : undefined`。

### M-10. `components/dashboard/recent-campaigns.tsx:18` — `icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>` 型が緩い
- Lucide Icon は `LucideIcon` 型がある。狭く強く型付けるなら `LucideIcon` を使うべき。`"aria-hidden"?: boolean` は HTML 属性的には文字列 "true" / "false" でないと invalid。
- 同件 `app/login/page.tsx:105` の `Trust` も同じ。
- 推奨: `LucideIcon` を使い、`aria-hidden` は React の `aria-hidden?: Booleanish` に任せる。

### M-11. Tailwind v4 alpha の `[color:var(--color-ink-500)]` 多用
- v4 では `text-ink-500` のような任意色クラスはテーマ変数から生成されるため、**ベーステーマで定義済み**なら `text-ink-500` だけで足りる。`[color:var(--color-ink-500)]` を二重がけしているのは v3 時代の保険的書き方であり、v4 では DRY 違反。
- 推奨: 1 ルール `text-ink-500` に統一して、`@theme` で定義した CSS 変数に依存。

### M-12. `app/login/page.tsx:73` — `new Date().getFullYear()` が SSR/CSR で食い違う可能性
- 年末年始の日替わりタイミング（UTC vs JST）で **hydration mismatch** が出る稀なケース。
- 推奨: build 時に固定する or サーバ側で渡す。

---

## LOW（コード匂い / 改善提案）

### L-1. `components/ui/button.tsx` — `loading=true` のとき children が左側に並ばない / focus 時 outline 完全消去
- `focus-visible:outline-none` が指定されているが、`globals.css:111` の `:focus-visible { box-shadow: 0 0 0 3px ... }` でカバーしている。
- ただし `disabled:opacity-50` 状態で focus した時に opacity 50% の上に半透明 box-shadow が重なり視認性が下がる。

### L-2. `lib/supabase/client.ts` — 関数が呼ばれるたびに `createBrowserClient` 新規生成
- React 18+ では Provider 化または module-singleton にすべき。

### L-3. `state-machine.ts:78-91` — `tone` の Tailwind class が CSS 変数二重指定
- `text-info-700 [color:var(--color-info-700)]` のように `text-info-700` だけで効くはず（v4）。

### L-4. `db/schema.ts:202` — `dailyMetrics` の主キーが `uniqueIndex` だけで実 PRIMARY KEY 無し
- `(orgId, day)` を **primary key** で宣言するのが意図のはず。`uniqueIndex` のみだと `UPSERT ... ON CONFLICT (org_id, day)` の指定で衝突管理は可能だが、PK ではない。
- 推奨: `pgTable(..., (t) => ({ pk: primaryKey({ columns: [t.orgId, t.day] }) }))`。

### L-5. `lib/state-machine.ts:5-21` — Lucide icon を **14個** 全て eager import
- Tree-shaking が効くとはいえ、Server Component で 14 アイコン分の chunk が生まれる。`StateChip` でしか使わないなら同コンポーネント側で import して **lazy 化** が望ましい。

### L-6. `app/(app)/dashboard/page.tsx:15-16`
```ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
```
- 両方指定は冗長。`force-dynamic` を指定した時点で `revalidate` 設定は無視される。

### L-7. `components/ui/skeleton.tsx:5` — `aria-hidden` を boolean ではなく文字列で
- TS / React は受け付けるが、HTML 属性レベルでは `aria-hidden="true"` を期待する。`aria-hidden` のみだと暗黙 "true"。問題ないが eslint-plugin-jsx-a11y の strict mode で警告になる可能性。

### L-8. import 順 — ESLint で組まれていない
- 例: `kpi-card.tsx` は lucide → ui/card → formatters → utils。一方 `nsm-hero.tsx` は lucide → formatters のみ。プロジェクト全体で `eslint-plugin-import/order` を導入していない。
- 推奨: `simple-import-sort` か `import/order` を `eslint-config-next` に上乗せ。

### L-9. `components/app/header.tsx` — `Cmd+K` 表記なのに OS 判定がない
- macOS は ⌘、Windows/Linux は Ctrl。アクセシビリティ的に `aria-label="検索 (Cmd+K)"` 固定はミスリード。
- 推奨: navigator.platform / userAgentData で出し分け（クライアントなのでヒドレ後の差替えで OK）。

### L-10. `lib/formatters.ts:26-29` — `fmtRelative` の `addSuffix` で「未来日付」が来ないか
- LinkedIn 自動営業の文脈で「将来の予約送信」を表示する可能性がある。`addSuffix: true` で `〜後` が出るので機能上は OK だが、同関数を「過去のみ」と思って使うと混乱する。

### L-11. IME / 日本語入力ガード不足
- `app/login/page.tsx:40` の email input は OK。だが今後 textarea / 検索ボックス（`header.tsx:21-31`）を追加するときに `compositionstart` / `compositionend` ガードがない設計になっている。今回の差分には textarea が無いので **LOW** 扱い。

### L-12. `components/dashboard/activity-chart.tsx:91-107` — `i % Math.max(1, Math.floor(data.length / 7))` の偏り
- `data.length=30` のとき `floor(30/7)=4` → `i % 4 === 0` の `0,4,8,12,16,20,24,28` で 8 ラベル表示。意図と違って端 (`29`) が出ない。
- 推奨: 最後の点を必ず描画するロジックを追加。

### L-13. `db/schema.ts` — `email`, `unipile_account_id` は `varchar` だが Postgres 的には `citext` が良い
- email の case-insensitive uniqueness を強制したいなら `citext` か `lower(email) unique`。

### L-14. `globals.css:148` — `data:image/svg+xml;utf8,<svg ...>` を mix-blend-mode multiply で重ねる
- 機能 OK だが、印刷時 / forced-colors mode で見えなくなる可能性。`@media (forced-colors: active)` で no-op に。

### L-15. `components/ui/badge.tsx:22-30` — `border` のみ指定で `border-current` がない
- `toneClass.success` 等は `border-[#A7F3D0]` のように直接 hex を埋め込んでおり、テーマ変数とのズレ。

---

## 良い点（3つ）

1. **State machine の三重表現が秀逸**
   `lib/state-machine.ts` で「アイコン + 色 + 日本語ラベル」が一元化されており、`StateChip` での `role="status"` / `aria-label` も自動付与される。色覚多様性とスクリーンリーダーの双方に配慮した模範実装。

2. **`server-only` の境界制御**
   `db/client.ts` と `lib/supabase/server.ts` に `import "server-only"` を置き、Server Component / Server Action のみで利用される境界を **物理的に強制** している。クライアントから誤って import すれば即ビルドエラーになる安全弁。

3. **Drizzle スキーマの multi-tenant 設計が一貫**
   全テーブルが `orgId` を持ち、`onDelete: "cascade"` でテナント隔離を担保。`audit_log` の `prevHash` / `hash` chain も hash chain audit の意図が型に表れており、設計書 §21.x との対応が読み取れる。`role` enum / `plan` enum / `lead_state` enum が DB 側でも型レベルでも閉じている。

---

## 95+ 到達のための残ブロッカー（Top 10、優先度順）

1. **H-2 / H-7**: `@types/react` を React 19 RC 系に揃え、`signInWithMagicLink` を `useActionState` 互換シグネチャに作り直す。**最大級のコンパイル / ランタイム時限爆弾**。
2. **H-1**: `skeleton.tsx` に `import * as React from "react"` を追加。`tsc --noEmit` で即落ちる。
3. **H-4**: `@supabase/ssr@0.5` の `getAll` / `setAll` API に書き換え。session 永続化が壊れている可能性。
4. **H-8**: `middleware.ts` を作成し `(app)` 配下を Supabase Auth で保護。**現在は誰でも /dashboard にアクセス可**。
5. **H-3**: `experimental.typedRoutes` を活かすため `as never` を撤廃し `Route` 型で配線。
6. **H-9**: 内部リンク（KpiCard / AttentionList / RecentCampaigns / NsmHero）を `next/link` の `Link` に統一。SPA 性能・prefetch が復活。
7. **H-5 / H-6**: `mode: "date"` カラムの取り扱いを統一し、`as unknown as string` を削除。日次集計の Off-by-1 を消す。
8. **H-10**: `@date-fns/tz` を導入し `Asia/Tokyo` 固定で `format`。サーバ TZ 依存の表示ズレを解消。
9. **M-3**: SVG `linearGradient` の id を `useId()` ベースに置換。同値 KPI が並んだ時の塗り消失を防止。
10. **M-1 + L-3**: `state-machine.ts` を単一情報源として `funnelLabels` を撤去 + Tailwind v4 任意セレクタ (color の var 形式) の二重指定を `text-ink-XXX` に整理。設計書 §3.3 との同期コストを下げる。

これらを潰せば、5 軸合計で 18+/20 × 5 ≒ **95 / 100** に到達する見込み。

---

## 補足: 想定 `tsc --noEmit` 即時エラー候補

| ファイル | 行 | エラー想定 |
| --- | --- | --- |
| `components/ui/skeleton.tsx` | 3 | `Cannot find namespace 'React'.` |
| `app/login/page.tsx` | 30 | `Type '(formData: FormData) => Promise<{ ok: false, error: string }>' is not assignable to '(formData: FormData) => void \| Promise<void>'`（React 19 types 移行後） |
| `components/app/sidebar.tsx` | 82, 127 | `typedRoutes` 有効時、`href={item.href as never}` は `as` cast を経由してしまうため警告は出ないが lint で叩ける |
| `server/queries/dashboard.ts` | 127 | `as unknown as string` は通るが、本来 `r.day: Date` の前提が崩れている。実行時 TZ ズレ |
| `db/client.ts` | 8 | `var __pg__` の global 拡張は通るが、`@types/node@22` の `globalThis` 型と相互作用に注意 |

---

レビュー終了。コード変更は行っていない。
