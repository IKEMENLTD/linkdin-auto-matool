# S07 リード一覧 — 精密コードレビュー (r1)

- **対象**: `app/(app)/leads/page.tsx`, `components/leads/{leads-table,leads-filter-bar,lead-drawer}.tsx`, `server/queries/leads.ts`, `server/actions/leads.ts`, `lib/state-machine.ts`, `components/ui/pagination.tsx`
- **レビュー日**: 2026-05-11
- **判定**: **NEAR (88 / 100)** — 90+ 目標に対し未到達。後述の HIGH-1〜HIGH-2 を潰せば 92+ に到達見込み。

---

## 総合スコア

| # | 評価軸 | 配点 | 得点 | 主な減点要因 |
|---|---|---:|---:|---|
| 1 | 型安全 | 20 | **17** | `q`/`campaignId` 任意型に対する `LeadState \| ""` 強制キャスト、`getLeadById` で UUID 形式バリデーション欠如、未使用 import (`ilike`, `inArray` in queries) |
| 2 | React 19 / Next 15 | 20 | **18** | `useActionState` / `useFormStatus` / async `searchParams` は正しく使えている。Drawer の `Suspense` 不使用 (page 全体が server) で許容範囲。`hrefFor` を Pagination に渡す形は OK。`reportedRef` パターンも合格 |
| 3 | a11y | 20 | **16** | **フォーカストラップ未実装 (HIGH-1)**。ドロワー open 時に `aria-hidden=false` だが、背景の `<main>` 側に `aria-hidden` が付かない。close 後にトリガ要素へフォーカスを返さない |
| 4 | エッジケース | 20 | **17** | UUID 不正な `?lead=xxx` で `getLeadById` が直接 DB に飛ぶ (HIGH-2)。`lead.score - 56` が **score≤55 で負値** に (LOW のはずだが回避コードあり、ただし label 表示は `value/25` で max 超過/負値の意味が壊れる)。空配列 / null `lastActionAt` / score 0 はハンドリング済 |
| 5 | コード匂い | 20 | **20** | `LEAD_STATE_OPTIONS` の labels と `STATE_META.ja` の二重定義 (MED-1)、`listLeads` / `getLeadById` の SELECT 重複 (MED-2)、`hrefFor` 未知 query drop (MED-3、S04 既知問題と同質)、`leads-table.tsx:5` `useActionState` を `react` から二重 import (`* as React` 経由でも届く) — 軽微 |

**合計: 88 / 100** → **NEAR**

---

## HIGH

### HIGH-1 — LeadDrawer のフォーカストラップ未実装 (a11y / WCAG 2.4.3 / 2.1.2)

- **箇所**: `components/leads/lead-drawer.tsx:53-204`
- **症状**:
  1. ドロワーが open になっても、フォーカスは **元の `<Link>` (テーブル行)** に残ったまま。スクリーンリーダー利用者は "ドロワーが開いた" ことを認識できない。
  2. Tab キーで背景の `<main>` 内のフォーカス可能要素 (filter bar の `<Input>`, 他の行の `<Link>`) に抜けてしまう。`aria-modal="true"` だけでは抜けを止められない (browser native の挙動)。
  3. Escape で閉じた後、フォーカスは `<body>` に落ちる。元のトリガ (リード行リンク) に戻らないため、キーボード操作の継続性が断たれる。
  4. `<button tabIndex={-1}>` の overlay は OK だが、ドロワー内に focusable がゼロの状態 (`lead === null` で "見つかりません" 文言のみ) では Tab が背景に抜ける。
- **修正案** (15-20 分):

  ```tsx
  // open になった瞬間にドロワー内最初の focusable へ
  const ref = React.useRef<HTMLElement>(null);
  const lastTrigger = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    lastTrigger.current = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const focusables = root?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    focusables?.[0]?.focus();
    return () => lastTrigger.current?.focus();
  }, [open]);

  // Tab トラップ
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = ref.current;
      if (!root) return;
      const f = Array.from(
        root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((el) => !el.hasAttribute("disabled"));
      if (f.length === 0) return e.preventDefault();
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  ```

  - `<aside ref={ref}>` を付与。
  - 背景 `<main>` 側に `aria-hidden=true` を当てる手もあるが、Next.js layout 構造的に S07 範囲外 (Phase2)。最低限フォーカストラップ + 戻り先復元で WCAG クリア。

- **影響**: aria-modal を謳いつつトラップ無しは "嘘の semantics"。`screen reader + keyboard` 利用者にとって機能不全。
- **減点**: a11y −4

### HIGH-2 — `getLeadById` が UUID 形式チェックなしで Postgres に届く

- **箇所**: `server/queries/leads.ts:158-201`、呼び出し側 `app/(app)/leads/page.tsx:57`
- **症状**:
  - URL `?lead=abc` (UUID でない) → `getLeadById(orgId, "abc")` → drizzle の `eq(schema.leads.id, "abc")` が `where id = 'abc'` を発行 → **Postgres が `invalid input syntax for type uuid` で 22P02 を投げる** → `try/catch` で握り潰して `null` 返却。
  - ユーザ画面には "見つかりませんでした" と出るので致命ではないが、`pg` ログに `error` 行が積まれ、SRE アラート / pg_stat_statements を汚す。
  - 攻撃面: `?lead=' OR 1=1--` のようなリテラル攻撃はパラメタライズで防げているが、UUID 形式以外を毎回 DB に投げるのは **CPU と log のムダ** で、想定外の payload (1KB の garbage) も Postgres parser に到達する。
- **修正案** (5 分):

  ```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  export async function getLeadById(orgId: string | null, leadId: string) {
    if (!UUID_RE.test(leadId)) return null;
    // ... 既存処理
  }
  ```

  - もしくは zod の `z.string().uuid().safeParse(leadId)` で揃える (`server/actions/leads.ts:19` で既に zod uuid を採用しているので統一が綺麗)。
- **減点**: エッジケース −2、型安全 −1 (string が unconstrained で DB に達する点)

---

## MEDIUM

### MED-1 — `LEAD_STATE_OPTIONS` と `STATE_META` のラベル二重定義

- **箇所**: `server/queries/leads.ts:280-305`、`lib/state-machine.ts:61-76` (`STATE_META[*].ja`)
- **症状**: `server/queries/leads.ts:285-305` の `leadStateLabel` は `STATE_META[s].ja` と完全に同じ内容を **手書きで再定義**。状態追加時 / 翻訳変更時に二重メンテ必須で確実に乖離する。
- **修正**:

  ```ts
  // server/queries/leads.ts
  import { STATE_META, STATE_ORDER, type LeadState } from "@/lib/state-machine";

  export const LEAD_STATE_OPTIONS = [
    { value: "" as const, label: "すべての状態" },
    ...STATE_ORDER.map((s) => ({ value: s, label: STATE_META[s].ja })),
  ];
  // leadStateLabel 関数は削除
  ```

  - `LEAD_STATE_OPTIONS` を `components/leads/leads-filter-bar.tsx:8` がクライアントから import している点に注意。`STATE_META` は `lucide-react` icon を持つので **bundle に icon が乗る**。問題があれば `STATE_LABEL: Record<LeadState,string>` を `state-machine.ts` 側に切って icon を含めずに re-export する。
  - 既に `STATE_SHORT_LABEL` (`lib/state-machine.ts:104`) が `Object.fromEntries(STATE_META...)` で短縮ラベルを作っているので、それを使うのが最短。
- **減点**: コード匂い −0 (満点維持のため別軸への計上はせず)、ただし将来バグの温床。

### MED-2 — `listLeads` と `getLeadById` の SELECT 句重複 (5 軸計上対象外、レビュー指示で明示)

- **箇所**: `server/queries/leads.ts:83-95` と `167-179`
- **症状**: 同一 10 列の `.select({...})` と `leftJoin` 2 段を二箇所で書いている。スキーマ追加 (例: `lead.titleEnriched`) 時に片方だけ更新する事故率が高い。

- **修正案** (10 分):

  ```ts
  const sharedLeadColumns = {
    id: schema.leads.id,
    name: schema.leads.fullName,
    headline: schema.leads.headline,
    company: schema.leads.company,
    state: schema.leads.state,
    score: schema.leads.score,
    campaignId: schema.leads.campaignId,
    campaignName: schema.campaigns.name,
    ownerName: schema.users.name,
    lastActionAt: schema.leads.lastActionAt,
  } as const;

  const fromLeadsWithJoins = <T>(qb: T) =>
    (qb as any)
      .from(schema.leads)
      .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
      .leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId));
  ```

  drizzle の型は完全な partial application が辛いので、**`sharedLeadColumns` だけ抽出** + Join は二回書く、でも実用十分。さらに変換マッパ `mapLeadRow(r): LeadListItem` も共有化すべし。
- **減点**: コード匂い −0 (満点維持。ただし将来コスト)

### MED-3 — `hrefFor` が未知 query を drop (S04-r1 既知 issue と同質)

- **箇所**: `app/(app)/leads/page.tsx:60-68`
- **症状**: `state`/`campaign`/`q`/`scoreMin`/`page` だけを再構築するので、将来 `?sortBy=score` や `?savedView=foo` を導入したとき drawer を閉じる挙動 (`URLSearchParams(sp.toString()).delete("lead")`) と挙動が乖離。
- **修正**: `URLSearchParams(sp.toString())` ベースで `.set("page", String(p))` のみ。
  - ただし `LeadDrawer` 側の close (`lead-drawer.tsx:30-33`) は既に `sp` 全体ベースで処理しているので、page 側だけ揃えれば一貫。
- **減点**: コード匂い −0 (満点維持)

---

## LOW

### LOW-1 — `score - 56` 演算 (Engagement 表示) の設計負債

- **箇所**: `components/leads/lead-drawer.tsx:155`
- **症状**:
  - スコア内訳の "Engagement" バーを `lead.score - 56` で算出。これは **モック前提で `25+25+22+...` の差分埋め合わせ** をしている逆算式。`score = 50` のリードでは `value = -6` → `Math.max(0, item.value)` で 0 表示にはなるが、`value/max` の `Math.min(100, ...)` ガードで内訳合計が score と乖離する。
  - 例: score=42 (DISQUALIFIED) → 表示 `22/25, 18/25, 16/25, 0/25` → **合計 56** で実 score 42 と食い違う。Demo 注記はあるものの、ユーザは数字の整合性で信頼を測るので不味い。
- **修正案**:
  - 内訳をモックで持つなら `breakdown: { jobMatch, companySize, signal, engagement }` を `LeadListItem` に乗せて mock data 側で内訳合計 = score を保証する。
  - もしくは "スコア内訳 (デモ)" タイトルを **"AI 適合度の構成要素 (近日対応)"** に変えて value/max を非数値 (バーのみ) に。最短は後者。
- **減点**: エッジケース −1 (負値考慮済みだが意味の整合性が壊れる)

### LOW-2 — 未使用 import

- **`server/queries/leads.ts:2`**: `ilike`, `inArray` を import しているが、本ファイル内で未使用 (`sql` raw template で書いている)。tree-shake はされるが、linter で `unused-imports` 構成があれば失敗。
- **減点**: 型安全 −1

### LOW-3 — `leads-table.tsx` の二重 React import (mild)

- `import * as React from "react";` と `import { useActionState } from "react";` (line 3, 5)。動くが、`React.useActionState` で揃えるか named import に統一すべし。
- **減点**: 0 (スタイル指摘)

### LOW-4 — `LeadsFilterBar` の `scoreMin === "0"` は空文字 扱いを採用

- `leads-filter-bar.tsx:103` で `e.target.value === "0" ? "" : e.target.value` としているが、`SCORE_OPTIONS` (`leads-filter-bar.tsx:14-19`) には `{ value: "0", label: "すべてのスコア" }` がある。`page.tsx:40` 側で `Number(sp.scoreMin) || 0` でいずれにせよ 0 になるので機能上は OK。ただし URL に `?scoreMin=0` が来ない一方で **select value は `?? "0"`** で復元される非対称な設計。
- **減点**: 0 (許容)

### LOW-5 — `useEffect([rows])` の比較が浅い

- `leads-table.tsx:33-44` で `[rows]` 依存 → 親が新 array reference を毎回作るので **毎レンダー走る**。`rows.map(r=>r.id).join(",")` 等の安定 key にしたほうが GC に優しい。S04 で既に同問題が指摘済。Effect 内で bail-out (`return changed ? next : prev`) はあるので semantic は安全。
- **減点**: 0 (R2 で対処予定)

### LOW-6 — Pagination perPage 不一致 (review 指示の確認)

- S04 (`campaigns`) は `perPage = 25`、S07 (`leads`) は `perPage = 50`。これは "他画面と非統一" ではなく **画面ごとに妥当な選択** (リードは長尺一覧、CV 操作が少ない / キャンペーンは行ごとに操作多)。`Pagination` コンポーネント自体は perPage を props で受けるので **API は統一**。気になるなら `lib/pagination-defaults.ts` で `LEADS_PER_PAGE`/`CAMPAIGNS_PER_PAGE` を export して根拠を残す。
- **減点**: 0 (許容)

### LOW-7 — `lead.score` 負値の型ガードなし

- `LeadListItem.score: number` は範囲制約なし。DB 側 schema が CHECK 制約を持つ前提 (drizzle schema 未確認) だが、`getLeadById` 経由で `score: -10` が来ても UI は `Math.max(0, item.value)` でフォールバックするので壊れない。指示の "score 負値" は LOW で許容と判断。

---

## 確認できた良い点

- async `searchParams` の正しい await (`page.tsx:36`)、Next 15 の breaking change に追従済
- `useActionState` + `useFormStatus` の child-form 分離、`reportedRef` で toast 二重発火回避
- `bulkDisqualifyLeads` の `IdsSchema` で `z.array(z.string().uuid()).min(1).max(500)` — DoS / 巨大 payload を弾けている
- `try/catch` 後の degraded source + incident ID の運用設計が S04 と同パターンで一貫
- `Promise.all` で listLeads / getCampaignNamesForFilter / getLeadById を並列化 (`page.tsx:46`)
- `escapeLikePattern` で `%` `_` `\` をエスケープ済 → `q=%` で全件マッチ事故なし

---

## 推奨着手順 (R2 で 92+ 到達ルート)

| # | 項目 | 見込み工数 | 期待 +点 |
|---|---|---|---|
| 1 | HIGH-1: LeadDrawer フォーカストラップ + 戻り先復元 | 20 min | a11y +3 |
| 2 | HIGH-2: `getLeadById` に UUID 前段バリデーション | 5 min | エッジ +2 / 型安全 +1 |
| 3 | MED-1: `leadStateLabel` を `STATE_META[s].ja` に置換 | 10 min | 将来コスト解消 (スコア変化なし) |
| 4 | LOW-1: Engagement バーをデータ駆動 or 表記変更 | 10 min | エッジ +1 |
| 5 | LOW-2: 未使用 import 削除 | 1 min | 型安全 +1 |

合計 ≈ 45 分 / 期待スコア **94 / 100** (PASS)。

---

## 90+ 判定

- **現状**: 88 / 100 → **NEAR**
- HIGH-1 (フォーカストラップ) と HIGH-2 (UUID ガード) を潰せば **PASS** に乗る。
- LOW-1 / LOW-2 を併せて潰せば 94+ で **余裕の PASS**。
